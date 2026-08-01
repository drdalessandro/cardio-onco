// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * EPA Bienestar IA — Cardio-Oncología Marie Curie
 * `QuestionnaireResponse` → `Observation[]`, **dirigido por el recurso**.
 *
 * Backend-first: el código clínico (LOINC/SNOMED) y la unidad UCUM viven en el
 * `Questionnaire.item.code`, NO en este archivo. Este módulo sólo sabe *cómo*
 * traducir una respuesta a una Observation; *qué* significa cada pregunta lo
 * declara el recurso.
 *
 * Consecuencia práctica: agregar o cambiar una medición del check-in es editar
 * un `Questionnaire` en el servidor — sin tocar código ni redeployar nada. Un
 * único bot sirve para todos los cuestionarios del proyecto.
 *
 * Contrasta con `src/bots/core/*-encounter-note.ts`, donde el LOINC está
 * hardcodeado en TypeScript y se matchea por `linkId`.
 *
 * Procedencia: todo lo que carga el paciente sale con
 * `performer = [Patient]` y `Observation.category = survey`, de modo que la
 * investigación pueda distinguir dato autorreportado de dato clínico verificado.
 */

import type {
  Coding, Observation, Questionnaire, QuestionnaireItem,
  QuestionnaireResponse, QuestionnaireResponseItem, Reference, Patient,
} from '@medplum/fhirtypes';

const OBS_CAT_SYS = 'http://terminology.hl7.org/CodeSystem/observation-category';
const UCUM = 'http://unitsofmeasure.org';

/** Extensión FHIR estándar que declara la unidad esperada de un item `quantity`. */
const UNIT_EXT = 'http://hl7.org/fhir/StructureDefinition/questionnaire-unit';

export interface QrMapOptions {
  /** Paciente sujeto de las Observations. */
  subject: Reference<Patient>;
  /**
   * `true` cuando la carga la hizo el propio paciente: agrega `performer` y
   * marca la categoría `survey`. Por defecto `true` (el uso previsto es el
   * check-in del paciente).
   */
  patientReported?: boolean;
  /** Fecha del registro; por defecto la `authored` de la respuesta. */
  effectiveDateTime?: string;
  /** Identificador estable para idempotencia (p. ej. el id de la respuesta). */
  responseId?: string;
}

export interface QrMapResult {
  observations: Observation[];
  /** Preguntas respondidas cuyo item no declara `code` — no se pueden mapear. */
  uncoded: string[];
  warnings: string[];
}

/** Aplana los items del Questionnaire por `linkId` (incluye grupos anidados). */
function indexItems(items: QuestionnaireItem[] | undefined, into = new Map<string, QuestionnaireItem>()): Map<string, QuestionnaireItem> {
  for (const item of items ?? []) {
    if (item.linkId) into.set(item.linkId, item);
    if (item.item) indexItems(item.item, into);
  }
  return into;
}

/** Aplana las respuestas por `linkId`. */
function indexAnswers(
  items: QuestionnaireResponseItem[] | undefined,
  into = new Map<string, QuestionnaireResponseItem>()
): Map<string, QuestionnaireResponseItem> {
  for (const item of items ?? []) {
    if (item.linkId && item.answer?.length) into.set(item.linkId, item);
    if (item.item) indexAnswers(item.item, into);
  }
  return into;
}

/** Unidad UCUM declarada en el item, si la hay. */
function declaredUnit(item: QuestionnaireItem): Coding | undefined {
  const ext = item.extension?.find((e) => e.url === UNIT_EXT);
  return ext?.valueCoding;
}

/**
 * Traduce una respuesta a `Observation[]` usando los códigos declarados en el
 * `Questionnaire`.
 *
 * @param questionnaire - Define QUÉ significa cada pregunta (`item.code`).
 * @param response - Las respuestas del paciente.
 * @returns Observations listas para persistir, más las preguntas sin código.
 */
export function questionnaireResponseToObservations(
  questionnaire: Questionnaire,
  response: QuestionnaireResponse,
  options: QrMapOptions
): QrMapResult {
  const { subject, patientReported = true } = options;
  const observations: Observation[] = [];
  const uncoded: string[] = [];
  const warnings: string[] = [];

  const items = indexItems(questionnaire.item);
  const answers = indexAnswers(response.item);
  const effective = options.effectiveDateTime ?? response.authored;
  const responseId = options.responseId ?? response.id;

  for (const [linkId, answered] of answers) {
    const item = items.get(linkId);
    if (!item) {
      warnings.push(`Respuesta "${linkId}" no existe en el Questionnaire — se omite`);
      continue;
    }

    // El recurso manda: sin `item.code` no hay Observation (no se inventa).
    const code = item.code?.[0];
    if (!code) {
      uncoded.push(linkId);
      continue;
    }

    const answer = answered.answer?.[0];
    if (!answer) continue;

    const obs: Observation = {
      resourceType: 'Observation',
      status: 'final',
      category: [
        {
          coding: [
            { system: OBS_CAT_SYS, code: patientReported ? 'survey' : 'vital-signs' },
          ],
        },
      ],
      code: { coding: item.code, text: item.text },
      subject,
      effectiveDateTime: effective,
      derivedFrom: response.id ? [{ reference: `QuestionnaireResponse/${response.id}` }] : undefined,
    };

    if (patientReported) {
      // Procedencia: quién generó el dato. Clave para separar autorreporte de
      // dato clínico verificado a la hora de investigar.
      obs.performer = [subject as Reference<Patient>];
    }

    if (responseId) {
      obs.identifier = [
        { system: 'https://api.epa-bienestar.com.ar/fhir/CodeSystem/qr-observation', value: `${responseId}-${linkId}` },
      ];
    }

    if (answer.valueQuantity !== undefined) {
      obs.valueQuantity = answer.valueQuantity;
    } else if (answer.valueDecimal !== undefined || answer.valueInteger !== undefined) {
      const unit = declaredUnit(item);
      const value = answer.valueDecimal ?? answer.valueInteger;
      obs.valueQuantity = unit
        ? { value, unit: unit.code, system: unit.system ?? UCUM, code: unit.code }
        : { value };
    } else if (answer.valueBoolean !== undefined) {
      obs.valueBoolean = answer.valueBoolean;
    } else if (answer.valueCoding) {
      obs.valueCodeableConcept = { coding: [answer.valueCoding], text: answer.valueCoding.display };
    } else if (answer.valueString !== undefined) {
      obs.valueString = answer.valueString;
    } else {
      warnings.push(`Respuesta "${linkId}" con un tipo de valor no soportado — se omite`);
      continue;
    }

    observations.push(obs);
  }

  return { observations, uncoded, warnings };
}
