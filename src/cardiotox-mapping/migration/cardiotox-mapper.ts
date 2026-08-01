// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * EPA Bienestar IA — Cardio-Oncología Marie Curie
 * Migrador Cardiotox → FHIR: mapper puro de una fila de la hoja "Cardiotox".
 *
 * Función pura (fila → BundleEntry[]) → testeable. La idempotencia se logra con
 * un `identifier` estable por recurso y `request.method = PUT` condicional por
 * identifier (re-ejecutar la migración actualiza en vez de duplicar).
 *
 * Cubre la hoja "spine" (Cardiotox): Patient, antropometría/labs/ECG/eco
 * (Observation), antecedentes y cáncer (Condition), tabaquismo (Observation),
 * quimioterapia (MedicationStatement) y scores cargados a mano (RiskAssessment
 * manual). Las series temporales (Ecocardiogramas_control, Estudios_
 * Complementarios) y la capa CKM (FRCV) se unen por DNI en un paso posterior.
 */

import type {
  BundleEntry, Coding, Condition, MedicationStatement, Observation, Patient, Reference, Resource, RiskAssessment,
} from '@medplum/fhirtypes';
import { CHEMO_FAMILIES, CONDITION_CODES, OBSERVATION_CODES, SYSTEMS, riskMethodConcept } from '../data-dictionary';
import type { ChemoFamily, ConditionCode, ObsCode, RiskScoreMethod } from '../data-dictionary';
import { MIG_SYS, OBS_CAT_SYS, loincMeasure, measureObsEntry, patientFullUrl, putEntry } from './entry-builders';
import { birthDateFromAge, dniValue, isYes, num, partialDate, slug, text } from './parsers';

export type CardiotoxRow = Record<string, string>;

export interface MapResult {
  entries: BundleEntry[];
  dni?: string;
  warnings: string[];
}

const DNI_SYS = SYSTEMS.dniArgentina;
const LOINC = SYSTEMS.loinc;

const enc = encodeURIComponent;

// ─── Columnas de Observation (código en el diccionario + categoría FHIR) ──────
const OBS_COLUMNS: Array<{ col: string; key: keyof typeof OBSERVATION_CODES; category: string }> = [
  { col: 'Peso (kg)', key: 'weight', category: 'vital-signs' },
  { col: 'Altura (m)', key: 'height', category: 'vital-signs' },
  { col: 'IMC', key: 'bmi', category: 'vital-signs' },
  { col: 'Peri Abd (cm)', key: 'waistCircumference', category: 'vital-signs' },
  { col: 'TAS', key: 'systolicBP', category: 'vital-signs' },
  { col: 'FC', key: 'heartRate', category: 'vital-signs' },
  { col: 'FEY', key: 'lvef', category: 'imaging' },
  { col: 'IMVI', key: 'lvMassIndex', category: 'imaging' },
  { col: 'PSAP', key: 'pasp', category: 'imaging' },
  { col: 'Vol AI', key: 'laVolume', category: 'imaging' },
  { col: 'PR (mseg)', key: 'prInterval', category: 'procedure' },
  { col: 'QRS', key: 'qrsDuration', category: 'procedure' },
  { col: 'QT (mseg)', key: 'qtInterval', category: 'procedure' },
  { col: 'QTc', key: 'qtcInterval', category: 'procedure' },
  { col: 'Trop inicial', key: 'troponinHs', category: 'laboratory' },
  { col: 'Pro BNP basal', key: 'ntProBNP', category: 'laboratory' },
  { col: 'Cr', key: 'creatinine', category: 'laboratory' },
  { col: 'HB', key: 'hemoglobin', category: 'laboratory' },
  { col: 'Col T', key: 'cholesterolTotal', category: 'laboratory' },
  { col: 'HDL', key: 'hdl', category: 'laboratory' },
  { col: 'LDL', key: 'ldl', category: 'laboratory' },
  { col: 'Trig', key: 'triglycerides', category: 'laboratory' },
  { col: 'LPa', key: 'lipoproteinA', category: 'laboratory' },
  { col: 'HbA1c', key: 'hba1c', category: 'laboratory' },
  { col: 'eritro', key: 'esr', category: 'laboratory' },
  { col: 'Glu', key: 'glucose', category: 'laboratory' },
  { col: 'Clcr cal', key: 'egfr', category: 'laboratory' },
  { col: 'Microalb', key: 'microalbumin', category: 'laboratory' },
  { col: 'ECOG', key: 'ecog', category: 'survey' },
];

// ─── Scores cargados a mano (categoría) → RiskAssessment manual ───────────────
const MANUAL_SCORE_COLUMNS: Array<{ col: string; method: RiskScoreMethod }> = [
  { col: 'SAC', method: 'SAC-DVATC' },
  { col: 'ESC', method: 'ESC-SCORE2' },
  { col: 'OPS', method: 'OPS-PAHO' },
  { col: 'Framingham', method: 'FRAMINGHAM' },
  { col: 'PREVENT (bajo <5, inter 5-7.5, modera 7.5 -10, alto > 10)', method: 'PREVENT-AHA-2023' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function mapGender(v: string | undefined): Patient['gender'] {
  const t = (v ?? '').trim().toLowerCase();
  if (t.startsWith('f')) return 'female';
  if (t.startsWith('m')) return 'male';
  return t ? 'other' : undefined;
}

function obsEntry(subject: Reference<Patient>, dni: string, code: ObsCode, category: string, value: number, date?: string): BundleEntry {
  return measureObsEntry(subject, dni, loincMeasure(code, category), value, date);
}

function condEntry(subject: Reference<Patient>, dni: string, c: ConditionCode, date?: string): BundleEntry {
  const idValue = `${dni}-cond-${c.icd10}`;
  const coding: Coding[] = [{ system: SYSTEMS.icd10, code: c.icd10, display: c.display }];
  if (c.snomed) {
    coding.push({ system: SYSTEMS.snomed, code: c.snomed, display: c.display });
  }
  const cond: Condition = {
    resourceType: 'Condition',
    identifier: [{ system: MIG_SYS, value: idValue }],
    clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }] },
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-category', code: 'problem-list-item' }] }],
    code: { coding, text: c.display },
    subject,
    onsetDateTime: date,
  };
  return putEntry(cond, 'Condition', idValue);
}

function medEntry(subject: Reference<Patient>, dni: string, fam: ChemoFamily, type?: string): BundleEntry {
  const idValue = `${dni}-med-${slug(fam.source)}`;
  const med: MedicationStatement = {
    resourceType: 'MedicationStatement',
    identifier: [{ system: MIG_SYS, value: idValue }],
    status: 'active',
    medicationCodeableConcept: {
      coding: [{ system: SYSTEMS.atc, code: fam.atc, display: fam.display }],
      text: type ?? fam.display,
    },
    subject,
  };
  return putEntry(med, 'MedicationStatement', idValue);
}

function manualRiskEntry(subject: Reference<Patient>, dni: string, method: RiskScoreMethod, categoryText: string): BundleEntry {
  const idValue = `${dni}-risk-${method}-manual`;
  const ra: RiskAssessment = {
    resourceType: 'RiskAssessment',
    identifier: [{ system: MIG_SYS, value: idValue }],
    status: 'final',
    method: riskMethodConcept(method),
    subject,
    prediction: [{ outcome: { text: categoryText }, qualitativeRisk: { text: categoryText } }],
    extension: [{ url: SYSTEMS.riskSourceExt, valueCode: 'manual' }],
  };
  return putEntry(ra, 'RiskAssessment', idValue);
}

// ─── Mapper principal ─────────────────────────────────────────────────────────
/**
 * Mapea una fila de la hoja Cardiotox a recursos FHIR (BundleEntry idempotentes).
 * @param row - Objeto {encabezado: valor}. Los encabezados deben coincidir con
 *   los de la planilla (recortados).
 * @returns Entries listos para un Bundle transaccional, DNI y advertencias.
 */
export function mapCardiotoxRow(row: CardiotoxRow): MapResult {
  const warnings: string[] = [];
  const dni = dniValue(row['DNI']);
  if (!dni) {
    return { entries: [], warnings: ['Fila sin DNI — se omite'] };
  }

  const patFullUrl = patientFullUrl(dni);
  const subject: Reference<Patient> = { reference: patFullUrl };
  const date = partialDate(row['Inicio seguimiento']); // fecha basal si está
  const entries: BundleEntry[] = [];

  // Patient
  const given = text(row['Nombre']);
  const family = text(row['Apellido']);
  const phone = text(row['Telefono']);
  const patient: Patient = {
    resourceType: 'Patient',
    identifier: [{ system: DNI_SYS, value: dni, use: 'official' }],
    name: given || family ? [{ family, given: given ? [given] : undefined, text: [given, family].filter(Boolean).join(' ') }] : undefined,
    gender: mapGender(row['Sexo']),
    birthDate: birthDateFromAge(num(row['Edad'])),
    telecom: phone ? [{ system: 'phone', value: phone }] : undefined,
    deceasedBoolean: isYes(row['Muerte']) ? true : undefined,
  };
  entries.push({
    fullUrl: patFullUrl,
    resource: patient,
    request: { method: 'PUT', url: `Patient?identifier=${enc(DNI_SYS)}|${enc(dni)}` },
  });

  // Observations (vital-signs / lab / imaging / ecg / survey)
  for (const o of OBS_COLUMNS) {
    const value = num(row[o.col]);
    if (value === undefined) continue;
    entries.push(obsEntry(subject, dni, OBSERVATION_CODES[o.key], o.category, value, date));
  }

  // Tabaquismo (Observation social-history 72166-2)
  const currentSmoker = isYes(row['TBQ']);
  const formerSmoker = isYes(row['EX TBQ']);
  if (currentSmoker || formerSmoker) {
    const idValue = `${dni}-obs-smoking`;
    const val = currentSmoker
      ? { code: '77176002', display: 'Fumador actual' }
      : { code: '8517006', display: 'Ex fumador' };
    const obs: Observation = {
      resourceType: 'Observation',
      identifier: [{ system: MIG_SYS, value: idValue }],
      status: 'final',
      category: [{ coding: [{ system: OBS_CAT_SYS, code: 'social-history' }] }],
      code: { coding: [{ system: LOINC, code: '72166-2', display: 'Tobacco smoking status' }] },
      subject,
      effectiveDateTime: date,
      valueCodeableConcept: { coding: [{ system: SYSTEMS.snomed, code: val.code, display: val.display }] },
    };
    entries.push(putEntry(obs, 'Observation', idValue));
  }

  // Conditions (antecedentes)
  for (const c of CONDITION_CODES) {
    if (isYes(row[c.source])) {
      entries.push(condEntry(subject, dni, c, date));
    }
  }

  // Cáncer (Condition)
  const cancer = text(row['Tipo de cancer']);
  if (cancer) {
    const idValue = `${dni}-cond-cancer`;
    const grupo = text(row['Grupo']);
    const sub = text(row['Sub grupo']);
    const cond: Condition = {
      resourceType: 'Condition',
      identifier: [{ system: MIG_SYS, value: idValue }],
      clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }] },
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-category', code: 'encounter-diagnosis' }] }],
      code: { text: [cancer, grupo, sub].filter(Boolean).join(' · ') },
      subject,
      onsetDateTime: date,
    };
    entries.push(putEntry(cond, 'Condition', idValue));
  }

  // Quimioterapia (MedicationStatement por familia)
  for (const fam of CHEMO_FAMILIES) {
    if (isYes(row[fam.source])) {
      const type = fam.typeField ? text(row[fam.typeField]) : undefined;
      entries.push(medEntry(subject, dni, fam, type));
    }
  }

  // Scores cargados a mano (RiskAssessment manual)
  for (const rs of MANUAL_SCORE_COLUMNS) {
    const cat = text(row[rs.col]);
    if (cat) {
      entries.push(manualRiskEntry(subject, dni, rs.method, cat));
    }
  }

  return { entries, dni, warnings };
}
