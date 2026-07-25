// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * Tests del mapper Cardiotox → FHIR.
 *
 * Fila testigo de-identificada: mujer 56 años, linfoma B, esquema R-CHOP
 * (Rituximab = monoclonal, Ciclofosfamida = alquilante, Doxorrubicina =
 * antraciclina, Vincristina = alcaloide de la vinca, Prednisona = corticoide
 * fuera de las familias con seguimiento). Ex tabaquista, HTA. SAC = Intermedio.
 *
 * Se controla EXACTAMENTE qué columnas se pueblan para que los conteos de
 * recursos sean deterministas y las celdas vacías se salteen.
 */
import { describe, expect, it } from 'vitest';
import type { BundleEntry, Condition, MedicationStatement, Observation, Patient, RiskAssessment } from '@medplum/fhirtypes';
import { mapCardiotoxRow } from './cardiotox-mapper';
import { SYSTEMS } from '../data-dictionary';

const MIG_SYS = SYSTEMS.cardiotoxRecordId;

/** Fila de-identificada con un set acotado y determinista de columnas. */
const row: Record<string, string> = {
  DNI: '11222333',
  Nombre: 'Testigo',
  Apellido: 'De-identificada',
  Sexo: 'F',
  Edad: '56',
  Muerte: 'No',
  'Inicio seguimiento': '3/24',
  // Antropometría / signos vitales
  'Peso (kg)': '72',
  'Altura (m)': '1.57',
  IMC: '29.2',
  'Peri Abd (cm)': '95',
  TAS: '130',
  FC: '72',
  // Eco
  FEY: '60',
  // Labs
  Cr: '0.8',
  HB: '13',
  'Col T': '190',
  HDL: '55',
  LDL: '110',
  Glu: '95',
  // Tabaquismo
  TBQ: 'No',
  'EX TBQ': 'Sí',
  // Antecedentes
  HTA: 'Sí',
  DBT: 'No',
  // Cáncer
  'Tipo de cancer': 'Linfoma no Hodgkin B',
  Grupo: 'Hematológico',
  'Sub grupo': 'Linfoma',
  // Quimioterapia (R-CHOP)
  Monoclonales: 'Sí',
  'Tipo de monoclonal': 'Rituximab',
  Alquilantes: 'Sí',
  'Tipo de Alquilante': 'Ciclofosfamida',
  Antraciclinas: 'Sí',
  'Tipo de Antraciclina': 'Doxorrubicina',
  'Alcaloides Vinca': 'Sí',
  'Tipo de Alcaloides Vinca': 'Vincristina',
  Taxanos: 'No',
  // Scores cargados a mano (dos presentes, el resto vacío → se saltean)
  SAC: 'Intermedio',
  'PREVENT (bajo <5, inter 5-7.5, modera 7.5 -10, alto > 10)': 'Bajo',
  ESC: '',
  OPS: '',
  Framingham: '',
};

const byType = (entries: BundleEntry[], t: string): BundleEntry[] =>
  entries.filter((e) => e.resource?.resourceType === t);

describe('mapCardiotoxRow — fila testigo de-identificada', () => {
  const { entries, dni, warnings } = mapCardiotoxRow(row);

  it('devuelve el DNI y sin advertencias', () => {
    expect(dni).toBe('11222333');
    expect(warnings).toEqual([]);
  });

  it('crea el Patient con identifier de DNI, sexo, edad→nacimiento y no fallecido', () => {
    const pat = byType(entries, 'Patient')[0].resource as Patient;
    expect(pat.identifier?.[0]).toMatchObject({ system: SYSTEMS.dniArgentina, value: '11222333', use: 'official' });
    expect(pat.gender).toBe('female');
    expect(pat.birthDate).toBe(`${new Date().getFullYear() - 56}-01-01`);
    expect(pat.deceasedBoolean).toBeUndefined();
    expect(pat.name?.[0]?.text).toBe('Testigo De-identificada');
  });

  it('mapea 13 mediciones numéricas + 1 de tabaquismo = 14 Observations', () => {
    expect(byType(entries, 'Observation')).toHaveLength(14);
  });

  it('codifica el peso con LOINC + UCUM, categoría y fecha basal', () => {
    const obs = byType(entries, 'Observation')
      .map((e) => e.resource as Observation)
      .find((o) => o.code?.coding?.[0]?.code === '29463-7')!;
    expect(obs.valueQuantity).toMatchObject({ value: 72, unit: 'kg', system: SYSTEMS.ucum, code: 'kg' });
    expect(obs.category?.[0]?.coding?.[0]?.code).toBe('vital-signs');
    expect(obs.effectiveDateTime).toBe('2024-03');
    expect(obs.identifier?.[0]?.system).toBe(MIG_SYS);
  });

  it('registra ex-tabaquismo (SNOMED 8517006), no fumador actual', () => {
    const smoking = byType(entries, 'Observation')
      .map((e) => e.resource as Observation)
      .find((o) => o.code?.coding?.[0]?.code === '72166-2')!;
    expect(smoking.valueCodeableConcept?.coding?.[0]?.code).toBe('8517006');
    expect(smoking.category?.[0]?.coding?.[0]?.code).toBe('social-history');
  });

  it('crea 2 Conditions: antecedente HTA (ICD-10 + SNOMED) y cáncer', () => {
    const conds = byType(entries, 'Condition').map((e) => e.resource as Condition);
    expect(conds).toHaveLength(2);
    const hta = conds.find((c) => c.code?.coding?.some((co) => co.code === 'I10'))!;
    expect(hta.code?.coding?.map((c) => c.system)).toEqual([SYSTEMS.icd10, SYSTEMS.snomed]);
    expect(hta.category?.[0]?.coding?.[0]?.code).toBe('problem-list-item');
    const cancer = conds.find((c) => c.category?.[0]?.coding?.[0]?.code === 'encounter-diagnosis')!;
    expect(cancer.code?.text).toContain('Linfoma no Hodgkin B');
  });

  it('crea 4 MedicationStatement (R-CHOP) con ATC y el tipo específico', () => {
    const meds = byType(entries, 'MedicationStatement').map((e) => e.resource as MedicationStatement);
    expect(meds).toHaveLength(4);
    const antra = meds.find((m) => m.medicationCodeableConcept?.coding?.[0]?.code === 'L01DB')!;
    expect(antra.medicationCodeableConcept?.text).toBe('Doxorrubicina');
    expect(meds.map((m) => m.medicationCodeableConcept?.coding?.[0]?.code).sort()).toEqual(
      ['L01A', 'L01CA', 'L01DB', 'L01FD']
    );
  });

  it('crea 2 RiskAssessment manuales (SAC, PREVENT); saltea los vacíos', () => {
    const ras = byType(entries, 'RiskAssessment').map((e) => e.resource as RiskAssessment);
    expect(ras).toHaveLength(2);
    const sac = ras.find((r) => r.method?.coding?.[0]?.code === 'SAC-DVATC')!;
    expect(sac.prediction?.[0]?.qualitativeRisk?.text).toBe('Intermedio');
    expect(sac.extension?.[0]?.valueCode).toBe('manual');
  });

  it('todas las entradas son PUT idempotente por identifier', () => {
    for (const e of entries) {
      expect(e.request?.method).toBe('PUT');
      expect(e.request?.url).toContain('identifier=');
    }
  });

  it('re-ejecutar produce los mismos fullUrl e identifiers (idempotencia)', () => {
    const again = mapCardiotoxRow(row);
    expect(again.entries.map((e) => e.fullUrl)).toEqual(entries.map((e) => e.fullUrl));
    expect(again.entries.map((e) => e.request?.url)).toEqual(entries.map((e) => e.request?.url));
  });
});

describe('mapCardiotoxRow — fila sin DNI', () => {
  it('se omite con advertencia y sin entries', () => {
    const r = mapCardiotoxRow({ Nombre: 'Sin', Apellido: 'DNI' });
    expect(r.entries).toEqual([]);
    expect(r.warnings).toEqual(['Fila sin DNI — se omite']);
    expect(r.dni).toBeUndefined();
  });
});

describe('mapCardiotoxRow — fallecido y fumador actual', () => {
  const r = mapCardiotoxRow({ DNI: '999', Sexo: 'M', Muerte: 'Sí', TBQ: 'Sí' });
  it('marca deceasedBoolean y fumador actual (SNOMED 77176002)', () => {
    const pat = r.entries.find((e) => e.resource?.resourceType === 'Patient')!.resource as Patient;
    expect(pat.deceasedBoolean).toBe(true);
    expect(pat.gender).toBe('male');
    const smoking = r.entries
      .map((e) => e.resource)
      .find((res) => res?.resourceType === 'Observation') as Observation;
    expect(smoking.valueCodeableConcept?.coding?.[0]?.code).toBe('77176002');
  });
});
