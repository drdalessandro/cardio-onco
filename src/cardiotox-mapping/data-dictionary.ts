// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * EPA Bienestar IA — Cardio-Oncología Marie Curie
 * Diccionario de datos: tabla "Cardiotox" (160 campos) → FHIR R4
 *
 * Versión machine-readable del documento `docs/fhir-mapping-cardiotox.md`.
 *
 * Reglas:
 *  1. Todo dato se persiste como recurso FHIR estándar (interoperable, FHIR R4).
 *  2. El dato se adapta al estándar FHIR (no al revés): los campos derivados NO
 *     se almacenan; donde existe código estándar (LOINC/SNOMED/ICD-10/ATC/UCUM)
 *     se usa ese código; donde no, se usa un CodeSystem local del proyecto.
 *
 * Este módulo es de SOLO DATOS y SOLO TIPOS (sin dependencias de runtime), por
 * lo que puede importarse desde el frontend, scripts de ingesta y —inlineado—
 * desde Bots Medplum (que requieren un único archivo autocontenido).
 */

import type { CodeableConcept } from '@medplum/fhirtypes';

// ─── Namespaces del proyecto ─────────────────────────────────────────────────

export const PROJECT_FHIR_BASE = 'https://api.epa-bienestar.com.ar/fhir';

export const SYSTEMS = {
  loinc: 'http://loinc.org',
  snomed: 'http://snomed.info/sct',
  icd10: 'http://hl7.org/fhir/sid/icd-10',
  rxnorm: 'http://www.nlm.nih.gov/research/umls/rxnorm',
  atc: 'http://www.whocc.no/atc',
  ucum: 'http://unitsofmeasure.org',
  dniArgentina: 'https://www.argentina.gob.ar/dni',
  riskProbability: 'http://terminology.hl7.org/CodeSystem/risk-probability',
  // CodeSystems locales del proyecto
  riskScoreMethod: `${PROJECT_FHIR_BASE}/CodeSystem/risk-score-method`,
  cardiotoxRecordId: `${PROJECT_FHIR_BASE}/CodeSystem/cardiotox-record-id`,
  echoMeasures: `${PROJECT_FHIR_BASE}/CodeSystem/echo-measures`,
  vascularDoppler: `${PROJECT_FHIR_BASE}/CodeSystem/vascular-doppler`,
  riskSourceExt: `${PROJECT_FHIR_BASE}/StructureDefinition/risk-source`,
} as const;

// ─── Tipos del diccionario ───────────────────────────────────────────────────

export type FhirResourceType =
  | 'Patient'
  | 'Coverage'
  | 'EpisodeOfCare'
  | 'Condition'
  | 'Observation'
  | 'DiagnosticReport'
  | 'Procedure'
  | 'MedicationStatement'
  | 'FamilyMemberHistory'
  | 'RiskAssessment'
  | 'Appointment';

export type CodeSystemKey = keyof typeof SYSTEMS;

/** Un campo de la tabla Cardiotox y su destino FHIR. */
export interface FieldMapping {
  /** Encabezado exacto en la tabla origen. */
  source: string;
  resource: FhirResourceType;
  /** FHIRPath aproximado dentro del recurso (documentación). */
  path?: string;
  system?: CodeSystemKey;
  code?: string;
  display?: string;
  /** Unidad UCUM cuando aplica. */
  unit?: string;
  /** `true` si es un valor derivado que NO se persiste (se calcula en lectura). */
  derived?: boolean;
  /** Código que requiere confirmación de un terminólogo. */
  unverified?: boolean;
  notes?: string;
}

// ─── Observations codificadas (LOINC + UCUM) ─────────────────────────────────
// Codes que el motor de scores y la ingesta consumen directamente.

export interface ObsCode {
  code: string;
  display: string;
  unit?: string;
  unverified?: boolean;
}

export const OBSERVATION_CODES = {
  // Antropometría / signos vitales
  weight: { code: '29463-7', display: 'Body weight', unit: 'kg' },
  height: { code: '8302-2', display: 'Body height', unit: 'm' },
  bmi: { code: '39156-5', display: 'Body mass index', unit: 'kg/m2' },
  waistCircumference: { code: '8280-0', display: 'Waist circumference', unit: 'cm' },
  systolicBP: { code: '8480-6', display: 'Systolic blood pressure', unit: 'mm[Hg]' },
  diastolicBP: { code: '8462-4', display: 'Diastolic blood pressure', unit: 'mm[Hg]' },
  heartRate: { code: '8867-4', display: 'Heart rate', unit: '/min' },
  smokingStatus: { code: '72166-2', display: 'Tobacco smoking status', unit: undefined },

  // Ecocardiograma
  lvef: { code: '8806-2', display: 'Left ventricular Ejection fraction', unit: '%' },
  lvMassIndex: { code: '90049-4', display: 'LV mass index', unit: 'g/m2', unverified: true },
  pasp: { code: '8403-8', display: 'Pulmonary artery systolic pressure', unit: 'mm[Hg]', unverified: true },
  laVolume: { code: '90069-2', display: 'Left atrial volume', unit: 'mL', unverified: true },

  // ECG
  prInterval: { code: '8625-6', display: 'P-R interval', unit: 'ms' },
  qrsDuration: { code: '8633-0', display: 'QRS duration', unit: 'ms' },
  qtInterval: { code: '8634-8', display: 'QT interval', unit: 'ms' },
  qtcInterval: { code: '8636-3', display: 'QTc interval', unit: 'ms' },

  // Laboratorio
  troponinHs: { code: '89579-7', display: 'Troponin I.cardiac (hs)', unit: 'ng/L' },
  ntProBNP: { code: '33762-6', display: 'NT-proBNP', unit: 'pg/mL' },
  creatinine: { code: '2160-0', display: 'Creatinine', unit: 'mg/dL' },
  hemoglobin: { code: '718-7', display: 'Hemoglobin', unit: 'g/dL' },
  cholesterolTotal: { code: '2093-3', display: 'Cholesterol total', unit: 'mg/dL' },
  hdl: { code: '2085-9', display: 'HDL cholesterol', unit: 'mg/dL' },
  ldl: { code: '13457-7', display: 'LDL cholesterol (calc)', unit: 'mg/dL' },
  triglycerides: { code: '2571-8', display: 'Triglycerides', unit: 'mg/dL' },
  lipoproteinA: { code: '10835-7', display: 'Lipoprotein(a)', unit: 'mg/dL' },
  hba1c: { code: '4548-4', display: 'Hemoglobin A1c', unit: '%' },
  esr: { code: '30341-2', display: 'Erythrocyte sedimentation rate', unit: 'mm/h' },
  glucose: { code: '2345-7', display: 'Glucose', unit: 'mg/dL' },
  egfr: { code: '98979-8', display: 'eGFR CKD-EPI 2021', unit: 'mL/min/{1.73_m2}', unverified: true },
  microalbumin: { code: '14957-5', display: 'Microalbumin (urine)', unit: 'mg/L' },

  // Clases funcionales (junto a scores pero NO son RiskAssessment)
  ecog: { code: '89247-1', display: 'ECOG performance status', unverified: true },
} as const satisfies Record<string, ObsCode>;

/** Códigos LOINC de los `DiagnosticReport` que agrupan Observations. */
export const REPORT_CODES = {
  echo: { code: '59063-1', display: 'US Cardiac study' },
  ecg: { code: '11524-6', display: 'EKG study' },
  spectPerfusion: { code: '39184-9', display: 'Myocardial perfusion study' },
} as const satisfies Record<string, ObsCode>;

// ─── Antecedentes → Condition (ICD-10) ───────────────────────────────────────

export interface ConditionCode {
  source: string;
  icd10: string;
  display: string;
  snomed?: string;
  unverified?: boolean;
}

export const CONDITION_CODES: ConditionCode[] = [
  { source: 'HTA', icd10: 'I10', display: 'Hipertensión esencial', snomed: '38341003' },
  { source: 'DBT', icd10: 'E11.9', display: 'Diabetes mellitus tipo 2', snomed: '44054006' },
  { source: 'Obesidad', icd10: 'E66.9', display: 'Obesidad', snomed: '414916001' },
  { source: 'DLP', icd10: 'E78.5', display: 'Dislipemia', snomed: '370992007' },
  { source: 'IC FEy pre', icd10: 'I50.32', display: 'IC con FE preservada (HFpEF)', snomed: '446221000' },
  { source: 'IC FEy red', icd10: 'I50.22', display: 'IC con FE reducida (HFrEF)', snomed: '703272007' },
  { source: 'IAM/ cardipatia isq', icd10: 'I25.10', display: 'Cardiopatía isquémica crónica', snomed: '414545008' },
  { source: 'ACV', icd10: 'I63.9', display: 'ACV isquémico', snomed: '230690007' },
  { source: 'Enfer arterial', icd10: 'I73.9', display: 'Enfermedad arterial periférica', snomed: '399957001' },
  { source: 'HP', icd10: 'I27.20', display: 'Hipertensión pulmonar', snomed: '70995007' },
  { source: 'TVP TEP', icd10: 'I82.40', display: 'Trombosis venosa profunda / TEP', snomed: '128053003' },
  { source: 'FA/AA', icd10: 'I48.91', display: 'Fibrilación auricular', snomed: '49436004' },
  { source: 'Arritmia ventricular', icd10: 'I47.2', display: 'Taquicardia ventricular', snomed: '25569003' },
  { source: 'BAV', icd10: 'I44.30', display: 'Bloqueo auriculoventricular', snomed: '233916004' },
];

// ─── Quimioterapia → Medication* (familia ATC) ───────────────────────────────

export interface ChemoFamily {
  source: string;
  typeField?: string;
  atc: string;
  display: string;
  highCardiotoxRisk?: boolean;
}

export const CHEMO_FAMILIES: ChemoFamily[] = [
  { source: 'Antraciclinas', typeField: 'Tipo de Antraciclina', atc: 'L01DB', display: 'Antraciclinas', highCardiotoxRisk: true },
  { source: 'Taxanos', typeField: 'Tipo de Taxano', atc: 'L01CD', display: 'Taxanos' },
  { source: 'Alcaloides Vinca', typeField: 'Tipo de Alcaloides Vinca', atc: 'L01CA', display: 'Alcaloides de la vinca' },
  { source: 'Monoclonales', typeField: 'Tipo de monoclonal', atc: 'L01FD', display: 'Anticuerpos monoclonales', highCardiotoxRisk: true },
  { source: 'Antimetabolitos', typeField: 'Tipo de Antimetabolito', atc: 'L01B', display: 'Antimetabolitos' },
  { source: 'Alquilantes', typeField: 'Tipo de Alquilante', atc: 'L01A', display: 'Agentes alquilantes' },
  { source: 'Inhibidores quinasa', typeField: 'Tipo de inh quinasa', atc: 'L01E', display: 'Inhibidores de quinasa' },
  { source: 'Inh check point', typeField: 'Tipo de inh check point', atc: 'L01FF', display: 'Inhibidores de checkpoint inmune', highCardiotoxRisk: true },
];

/** Dosis acumulada de antraciclinas — dato crítico de cardiotoxicidad. */
export const CUMULATIVE_ANTHRACYCLINE_DOSE = {
  system: SYSTEMS.echoMeasures, // CodeSystem local
  code: 'cumulative-anthracycline-dose',
  display: 'Dosis acumulada de antraciclinas (equiv. doxorrubicina)',
  unit: 'mg/m2',
} as const;

// ─── Scores de riesgo → RiskAssessment.method ────────────────────────────────

export type RiskScoreMethod =
  | 'PREVENT-AHA-2023'
  | 'SAC'
  | 'ESC-SCORE2'
  | 'OPS-PAHO'
  | 'FRAMINGHAM'
  | 'HFA-ICOS-ESC-2022';

export interface RiskScoreDef {
  method: RiskScoreMethod;
  display: string;
  sourceFields: string[];
  /** Umbrales de categoría sobre el % calculado (cuando aplica). */
  thresholds?: { low: number; intermediate?: number; moderate?: number; high: number };
  /** LOINC/Observation/Condition inputs que el algoritmo consume (`basis`). */
  inputs: string[];
}

export const RISK_SCORES: Record<RiskScoreMethod, RiskScoreDef> = {
  'PREVENT-AHA-2023': {
    method: 'PREVENT-AHA-2023',
    display: 'AHA PREVENT 2023 — modelo completo (riesgo CV total a 10 y 30 años)',
    sourceFields: ['PREVENT (bajo <5, inter 5-7.5, modera 7.5 -10, alto > 10)', 'Prevent calculado'],
    thresholds: { low: 5, intermediate: 7.5, moderate: 10, high: 10 },
    // Modelo completo: base + HbA1c + UACR (Microalb) + índice de deprivación social (SDI) + uso de estatina.
    inputs: [
      'age', 'sex', 'cholesterolTotal', 'hdl', 'systolicBP', 'antihypertensiveTx',
      'smokingStatus', 'diabetes', 'egfr', 'hba1c', 'uacr', 'statinTx', 'sdi',
    ],
  },
  SAC: {
    method: 'SAC',
    display: 'Score Sociedad Argentina de Cardiología',
    sourceFields: ['SAC', 'SAC calculado'],
    inputs: ['age', 'sex', 'cholesterolTotal', 'hdl', 'systolicBP', 'smokingStatus', 'diabetes'],
  },
  'ESC-SCORE2': {
    method: 'ESC-SCORE2',
    display: 'ESC SCORE2 / SCORE2-OP',
    sourceFields: ['ESC'],
    inputs: ['age', 'sex', 'nonHdlCholesterol', 'systolicBP', 'smokingStatus'],
  },
  'OPS-PAHO': {
    method: 'OPS-PAHO',
    display: 'Tablas OPS/OMS — región AMR',
    sourceFields: ['OPS', 'OPS calculado'],
    inputs: ['age', 'sex', 'systolicBP', 'smokingStatus', 'diabetes', 'cholesterolTotal'],
  },
  FRAMINGHAM: {
    method: 'FRAMINGHAM',
    display: 'Framingham Risk Score',
    sourceFields: ['Framingham', 'Framingham calculado'],
    inputs: ['age', 'sex', 'cholesterolTotal', 'hdl', 'systolicBP', 'antihypertensiveTx', 'smokingStatus', 'diabetes'],
  },
  'HFA-ICOS-ESC-2022': {
    method: 'HFA-ICOS-ESC-2022',
    display: 'HFA-ICOS ESC 2022 (riesgo CTRCD)',
    sourceFields: [],
    inputs: ['preexistingCVD', 'lvefBaseline', 'anthracyclineDose', 'mediastinalRT', 'cvRiskFactors'],
  },
};

/** CodeableConcept del método para un RiskAssessment. */
export function riskMethodConcept(method: RiskScoreMethod): CodeableConcept {
  return {
    coding: [{ system: SYSTEMS.riskScoreMethod, code: method, display: RISK_SCORES[method].display }],
    text: RISK_SCORES[method].display,
  };
}

// ─── Campos derivados — NO se almacenan ──────────────────────────────────────

export const DERIVED_FIELDS: string[] = [
  'Edad', // ← Patient.birthDate
  'Día en estudio', // ← EpisodeOfCare.period.start
  'IMC', // se persiste como Observation 39156-5 pero se deriva de peso/altura
  'QTC >480', // ← umbral sobre Observation 8636-3
  'Indice cintura/altura', // ← 8280-0 / 8302-2
  'PREVENT riesgo bajo...', // ← salida RiskAssessment
  'Prevent calculado',
  'SAC calculado',
  'OPS calculado',
  'Framingham calculado',
];
