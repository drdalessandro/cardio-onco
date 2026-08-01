// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * Tests de las columnas cualitativas y de la capa CKM, calibrados con los
 * VALORES REALES del libro (verificados con `migrate.ts --inspect`):
 *
 *   Valvulopatia leve      → 'IT', 'IT IM', 'IM IT', 'IM', '0'
 *   Disf Diasto            → '0' / '1'
 *   RS / FA / Trast rep    → 'Si' / 'No'
 *   Daño de organo blanco  → 'HVI', 'HVI + IR', 'RAC'
 *   IECA / Betabloquentes  → 'si' / 'no'  (en minúscula)
 */
import { describe, expect, it } from 'vitest';
import type { Condition, Goal, MedicationStatement, Observation, RiskAssessment } from '@medplum/fhirtypes';
import { mapSerialRow, ECHO_CATALOG, ECHO_QUALITATIVE, ECG_CATALOG, ECG_QUALITATIVE } from './serial-sheets';
import { mapFrcvRow } from './frcv-mapper';
import { patientRef } from './entry-builders';
import { dniValue } from './parsers';

const subject = patientRef('11222333');
const dni = '11222333';

const resources = <T>(entries: { resource?: unknown }[], type: string): T[] =>
  entries.map((e) => e.resource as { resourceType: string }).filter((r) => r.resourceType === type) as T[];

describe('dniValue — el DNI viene como número de planilla', () => {
  it('quita el sufijo .0 de los floats', () => {
    expect(dniValue('10547059.0')).toBe('10547059');
  });
  it('quita puntos de miles', () => {
    expect(dniValue('10.547.059')).toBe('10547059');
  });
  it('deja pasar un DNI normal', () => expect(dniValue('26522668')).toBe('26522668'));
  it('una fila de encabezado repetida no es un DNI', () => {
    expect(dniValue('DNI')).toBeUndefined();
  });
  it('vacío → undefined', () => expect(dniValue('')).toBeUndefined());
});

describe('Valvulopatías — el valor dice la válvula, la columna la severidad', () => {
  const row = {
    DNI: dni,
    'Fecha eco inicial': '3/24',
    'Valvulopatia leve': 'IT IM',
    'Valvulopatia moderada': '0',
    'Valvulopatia severa': '0',
  };
  const r = mapSerialRow(row, ECHO_CATALOG, dni, subject, undefined, ECHO_QUALITATIVE);
  const conds = resources<Condition>(r.entries, 'Condition');

  it('"IT IM" genera DOS Conditions, una por válvula', () => {
    expect(conds).toHaveLength(2);
    const codes = conds.map((c) => c.code?.coding?.[0]?.code).sort();
    expect(codes).toEqual(['I34.0', 'I36.1']); // insuf. mitral + insuf. tricuspídea
  });

  it('la severidad de la columna va a Condition.severity (SNOMED)', () => {
    expect(conds[0].severity?.coding?.[0]).toMatchObject({ code: '255604002', display: 'Leve' });
  });

  it('codifica con ICD-10 + SNOMED y fecha del eco', () => {
    const it = conds.find((c) => c.code?.coding?.[0]?.code === 'I36.1')!;
    expect(it.code?.coding?.map((c) => c.code)).toEqual(['I36.1', '111287006']);
    expect(it.onsetDateTime).toBe('2024-03');
  });

  it('"0" (sin valvulopatía) no genera Condition', () => {
    const sinLesion = mapSerialRow(
      { DNI: dni, 'Valvulopatia leve': '0', 'Valvulopatia moderada': '0' },
      ECHO_CATALOG, dni, subject, undefined, ECHO_QUALITATIVE
    );
    expect(resources<Condition>(sinLesion.entries, 'Condition')).toHaveLength(0);
  });

  it('una sigla desconocida se advierte, no se inventa', () => {
    const raro = mapSerialRow(
      { DNI: dni, 'Valvulopatia leve': 'XYZ' }, ECHO_CATALOG, dni, subject, undefined, ECHO_QUALITATIVE
    );
    expect(resources<Condition>(raro.entries, 'Condition')).toHaveLength(0);
    expect(raro.warnings.join(' ')).toContain('XYZ');
  });

  it('la progresión leve→moderada de la MISMA válvula no se pisa', () => {
    const prog = mapSerialRow(
      {
        DNI: dni,
        'Fecha eco inicial': '3/24', 'Valvulopatia leve': 'IT',
        'Fecha eco control': '3/25', 'Valvulopatia moderada 2': 'IT',
      },
      ECHO_CATALOG, dni, subject, undefined, ECHO_QUALITATIVE
    );
    const ids = prog.entries.map((e) => e.request?.url);
    expect(new Set(ids).size).toBe(2); // dos Conditions distintas, no una pisando a la otra
  });
});

describe('Hallazgos 0/1 del eco', () => {
  it('1 genera Condition; 0 no', () => {
    const con = mapSerialRow({ DNI: dni, 'Disf Diasto': '1' }, ECHO_CATALOG, dni, subject, undefined, ECHO_QUALITATIVE);
    expect(resources<Condition>(con.entries, 'Condition')).toHaveLength(1);
    const sin = mapSerialRow({ DNI: dni, 'Disf Diasto': '0' }, ECHO_CATALOG, dni, subject, undefined, ECHO_QUALITATIVE);
    expect(resources<Condition>(sin.entries, 'Condition')).toHaveLength(0);
  });
});

describe('ECG cualitativo Sí/No', () => {
  const row = { DNI: dni, RS: 'Si', FA: 'No', 'Trast rep': 'Si', BAV: 'No' };
  const r = mapSerialRow(row, ECG_CATALOG, dni, subject, '2024-09', ECG_QUALITATIVE);

  it('los diagnósticos presentes son Condition; los ausentes no se crean', () => {
    const conds = resources<Condition>(r.entries, 'Condition');
    expect(conds).toHaveLength(0); // FA=No y BAV=No
  });

  it('los hallazgos observacionales guardan también el "No" (es informativo)', () => {
    const obs = resources<Observation>(r.entries, 'Observation');
    const rs = obs.find((o) => o.code?.coding?.[0]?.code === '251150004')!;
    expect(rs.valueBoolean).toBe(true); // ritmo sinusal presente
    expect(rs.effectiveDateTime).toBe('2024-09');
  });

  it('FA = Si sí genera la Condition de fibrilación auricular', () => {
    const conFA = mapSerialRow({ DNI: dni, FA: 'Si' }, ECG_CATALOG, dni, subject, undefined, ECG_QUALITATIVE);
    const c = resources<Condition>(conFA.entries, 'Condition')[0];
    expect(c.code?.coding?.[0]?.code).toBe('I48.91');
  });
});

describe('FRCV — nombres de columna REALES del libro', () => {
  const row = {
    DNI: dni,
    IECA: 'si',
    'ARA 2': 'no',
    Betabloquentes: 'si', // typo real de la planilla
    'Bloq calcicos': 'si',
    'Diuretico tiazidico': 'si',
    'Antag Mineralocort': 'no',
    Gliflozinas: 'si',
    'antag GLP 1': 'si',
    Estatinas: 'si',
    'Ac. bempedoico': 'no',
    'Cumple objetivos de tratamiento': 'si',
    'Daño de organo blanco': 'HVI + IR',
    'Pack year': '20',
    'Ex TBQ': 'si',
    'Score OPS': 'alto',
    PREVENT: 'no corresponde',
    Si: '1', // columna auxiliar
    'Column 1': 'No corresponde',
  };
  const r = mapFrcvRow(row, dni, subject);
  const meds = resources<MedicationStatement>(r.entries, 'MedicationStatement');
  const atcs = meds.map((m) => m.medicationCodeableConcept?.coding?.[0]?.code).sort();

  it('reconoce las familias con los encabezados reales (incluido el typo)', () => {
    expect(atcs).toEqual(['A10BJ', 'A10BK', 'C03A', 'C07', 'C08', 'C09A', 'C10AA']);
  });

  it('las insignia CKM quedan con su ATC correcto', () => {
    expect(atcs).toContain('A10BK'); // gliflozinas
    expect(atcs).toContain('A10BJ'); // "antag GLP 1"
  });

  it('"no" no genera MedicationStatement', () => {
    expect(atcs).not.toContain('C09C'); // ARA 2 = no
    expect(atcs).not.toContain('C10AX15'); // Ac. bempedoico = no
  });

  it('"Cumple objetivos" → Goal con achievementStatus', () => {
    const goal = resources<Goal>(r.entries, 'Goal')[0];
    expect(goal.achievementStatus?.coding?.[0]?.code).toBe('achieved');
  });

  it('"HVI + IR" → dos Conditions de daño de órgano blanco', () => {
    const conds = resources<Condition>(r.entries, 'Condition');
    expect(conds.map((c) => c.code?.coding?.[0]?.code).sort()).toEqual(['I51.7', 'N18.9']);
  });

  it('Pack year → Observation de carga tabáquica', () => {
    const obs = resources<Observation>(r.entries, 'Observation');
    const py = obs.find((o) => o.code?.coding?.[0]?.code === '8664-5')!;
    expect(py.valueQuantity?.value).toBe(20);
  });

  it('Ex TBQ reusa el identifier de la spine (deduplica, no duplica)', () => {
    const smoking = r.entries.find((e) => e.request?.url?.includes('obs-smoking'));
    expect(smoking).toBeDefined();
  });

  it('un score cargado genera RiskAssessment; "no corresponde" no', () => {
    const ras = resources<RiskAssessment>(r.entries, 'RiskAssessment');
    expect(ras).toHaveLength(1);
    expect(ras[0].method?.coding?.[0]?.code).toBe('OPS-PAHO');
    expect(ras[0].prediction?.[0]?.qualitativeRisk?.text).toBe('alto');
  });

  it('las columnas auxiliares no ensucian el reporte de cobertura', () => {
    expect(r.ignored).not.toContain('Si');
    expect(r.ignored).not.toContain('Column 1');
  });
});
