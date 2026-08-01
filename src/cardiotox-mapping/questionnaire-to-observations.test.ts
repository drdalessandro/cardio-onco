// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * Tests del mapeo `QuestionnaireResponse` → `Observation[]` dirigido por recurso.
 *
 * Lo que se prueba no es sólo que traduzca bien, sino la propiedad de diseño:
 * **el significado clínico vive en el Questionnaire, no en el código**. Por eso
 * hay un test que agrega una medición nueva sin tocar el mapper.
 *
 * El Questionnaire real se carga desde `data/core/` para que los tests fallen
 * si alguien le saca un código a un item.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import type { Bundle, Questionnaire, QuestionnaireResponse } from '@medplum/fhirtypes';
import { questionnaireResponseToObservations } from './questionnaire-to-observations';

const bundle = JSON.parse(
  readFileSync('data/core/questionnaire-checkin-cardio-onco.json', 'utf-8')
) as Bundle;
const checkin = bundle.entry![0].resource as Questionnaire;

const subject = { reference: 'Patient/abc' } as const;

const response: QuestionnaireResponse = {
  resourceType: 'QuestionnaireResponse',
  id: 'qr-1',
  status: 'completed',
  authored: '2026-03-15T10:00:00Z',
  item: [
    {
      linkId: 'vitales',
      item: [
        { linkId: 'peso', answer: [{ valueQuantity: { value: 68.5, unit: 'kg', system: 'http://unitsofmeasure.org', code: 'kg' } }] },
        { linkId: 'tas', answer: [{ valueInteger: 145 }] },
        { linkId: 'fc', answer: [{ valueInteger: 88 }] },
      ],
    },
    {
      linkId: 'sintomas',
      item: [
        { linkId: 'disnea', answer: [{ valueBoolean: true }] },
        { linkId: 'edemas', answer: [{ valueBoolean: false }] },
      ],
    },
    {
      linkId: 'capacidad-funcional',
      answer: [{ valueCoding: { system: 'http://snomed.info/sct', code: '421704003', display: 'NYHA II — limitación leve' } }],
    },
    { linkId: 'comentario', answer: [{ valueString: 'Me canso subiendo la escalera' }] },
  ],
};

describe('El Questionnaire declara el significado; el mapper sólo traduce', () => {
  const r = questionnaireResponseToObservations(checkin, response, { subject });

  it('mapea cada respuesta codificada a una Observation', () => {
    // 3 vitales + 2 síntomas + capacidad funcional = 6 (el comentario no tiene código)
    expect(r.observations).toHaveLength(6);
  });

  it('toma el LOINC del recurso, no de constantes del código', () => {
    const peso = r.observations.find((o) => o.code?.coding?.[0]?.code === '29463-7')!;
    expect(peso.valueQuantity).toMatchObject({ value: 68.5, unit: 'kg' });
  });

  it('aplica la unidad UCUM declarada en el item a las respuestas numéricas', () => {
    const tas = r.observations.find((o) => o.code?.coding?.[0]?.code === '8480-6')!;
    // el paciente respondió un entero pelado; la unidad la puso el recurso
    expect(tas.valueQuantity).toMatchObject({
      value: 145,
      unit: 'mm[Hg]',
      system: 'http://unitsofmeasure.org',
      code: 'mm[Hg]',
    });
  });

  it('conserva booleanos, incluido el "no" (ausencia de síntoma es dato)', () => {
    const disnea = r.observations.find((o) => o.code?.coding?.[0]?.code === '267036007')!;
    const edemas = r.observations.find((o) => o.code?.coding?.[0]?.code === '267038008')!;
    expect(disnea.valueBoolean).toBe(true);
    expect(edemas.valueBoolean).toBe(false);
  });

  it('mapea choice a valueCodeableConcept (NYHA II)', () => {
    const nyha = r.observations.find((o) => o.code?.coding?.[0]?.code === '89247-1')!;
    expect(nyha.valueCodeableConcept?.coding?.[0]?.code).toBe('421704003');
  });

  it('reporta las preguntas sin código en vez de inventarles una', () => {
    expect(r.uncoded).toEqual(['comentario']);
    expect(r.warnings).toEqual([]);
  });
});

describe('Procedencia — separar autorreporte de dato clínico verificado', () => {
  const r = questionnaireResponseToObservations(checkin, response, { subject });
  const obs = r.observations[0];

  it('marca performer = Patient', () => {
    expect(obs.performer?.[0]).toEqual(subject);
  });

  it('categoriza como survey (no como vital-signs medido en consultorio)', () => {
    expect(obs.category?.[0]?.coding?.[0]?.code).toBe('survey');
  });

  it('enlaza a la respuesta de origen (trazabilidad)', () => {
    expect(obs.derivedFrom?.[0]?.reference).toBe('QuestionnaireResponse/qr-1');
  });

  it('con patientReported=false no marca performer y usa vital-signs', () => {
    const clin = questionnaireResponseToObservations(checkin, response, { subject, patientReported: false });
    expect(clin.observations[0].performer).toBeUndefined();
    expect(clin.observations[0].category?.[0]?.coding?.[0]?.code).toBe('vital-signs');
  });

  it('identifier estable por respuesta+pregunta → idempotente', () => {
    expect(obs.identifier?.[0]?.value).toBe('qr-1-peso');
  });
});

describe('Propiedad de diseño: agregar una medición NO requiere tocar código', () => {
  it('un item nuevo con code se mapea solo', () => {
    // Simula editar el Questionnaire en el servidor: se agrega saturometría.
    const ampliado: Questionnaire = {
      ...checkin,
      item: [
        ...(checkin.item ?? []),
        {
          linkId: 'spo2',
          text: 'Saturación de oxígeno',
          type: 'quantity',
          code: [{ system: 'http://loinc.org', code: '2708-6', display: 'Oxygen saturation' }],
          extension: [
            {
              url: 'http://hl7.org/fhir/StructureDefinition/questionnaire-unit',
              valueCoding: { system: 'http://unitsofmeasure.org', code: '%', display: '%' },
            },
          ],
        },
      ],
    };
    const conSpo2: QuestionnaireResponse = {
      ...response,
      item: [...(response.item ?? []), { linkId: 'spo2', answer: [{ valueInteger: 96 }] }],
    };

    const r = questionnaireResponseToObservations(ampliado, conSpo2, { subject });
    const spo2 = r.observations.find((o) => o.code?.coding?.[0]?.code === '2708-6')!;
    expect(spo2.valueQuantity).toMatchObject({ value: 96, unit: '%' });
  });
});

describe('Robustez', () => {
  it('una respuesta a una pregunta inexistente se advierte, no rompe', () => {
    const r = questionnaireResponseToObservations(
      checkin,
      { ...response, item: [{ linkId: 'no-existe', answer: [{ valueBoolean: true }] }] },
      { subject }
    );
    expect(r.observations).toHaveLength(0);
    expect(r.warnings[0]).toContain('no-existe');
  });

  it('una respuesta vacía no genera Observation', () => {
    const r = questionnaireResponseToObservations(
      checkin,
      { resourceType: 'QuestionnaireResponse', status: 'in-progress', item: [{ linkId: 'peso' }] },
      { subject }
    );
    expect(r.observations).toHaveLength(0);
  });
});

describe('El recurso publicado en data/core es válido para el motor de scores', () => {
  it('todos los items medibles declaran código', () => {
    const sinCodigo: string[] = [];
    const walk = (items: Questionnaire['item']): void => {
      for (const i of items ?? []) {
        if (i.type !== 'group' && i.type !== 'text' && !i.code?.length) sinCodigo.push(i.linkId!);
        if (i.item) walk(i.item);
      }
    };
    walk(checkin.item);
    expect(sinCodigo).toEqual([]);
  });

  it('incluye TAS (8480-6), input directo de PREVENT', () => {
    const codes: string[] = [];
    const walk = (items: Questionnaire['item']): void => {
      for (const i of items ?? []) {
        i.code?.forEach((c) => codes.push(c.code!));
        if (i.item) walk(i.item);
      }
    };
    walk(checkin.item);
    expect(codes).toContain('8480-6');
    expect(codes).toContain('72166-2'); // tabaquismo, también input de los scores
  });
});
