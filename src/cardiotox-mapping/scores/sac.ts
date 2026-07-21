// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * EPA Bienestar IA — Cardio-Oncología Marie Curie
 * Score SAC-DVATC — riesgo de cardiotoxicidad (disfunción ventricular asociada
 * al tratamiento del cáncer) según el Consenso de Cardio-Oncología de la SAC.
 *
 * Modelo: puntaje = factores del paciente (Tabla 2, 1 pt c/u según el tipo de
 * tratamiento) + puntos del tratamiento oncológico (0–4). Umbrales del Consenso:
 *   bajo <3 · intermedio 3–4 · alto 5–6 · muy alto >6.
 *
 * ⚠️ PROVISIONAL: la asignación de **puntos de tratamiento (0–4)** por droga no
 * figura en la planilla ni la tuvimos de la cita textual del Consenso. Se usa un
 * default explícito (SAC_DEFAULT_TREATMENT_POINTS = 2 por agente cardiotóxico),
 * calibrado para reproducir el caso testigo real (mujer en antraciclinas, sin
 * otros factores → 1 + 2 = 3 = Intermedio). Reemplazar por la regla exacta cuando
 * se consiga la cita (pág. ~34 del Consenso). Los factores del paciente y los
 * umbrales SÍ son de fuente (Tabla 2 + texto del Consenso).
 *
 * Etiquetas de categoría del value-set de la planilla: Bajo · Medio(=Intermedio) · Alto.
 */

import type { Reference, RiskAssessment } from '@medplum/fhirtypes';
import { SYSTEMS, riskMethodConcept } from '../data-dictionary';

export type SacTreatment = 'anthracycline' | 'anti-her2' | 'anti-vegf';
export type SacCategory = 'low' | 'intermediate' | 'high' | 'very-high';

/** Factores del paciente de la Tabla 2 del Consenso SAC (1 punto c/u cuando aplican). */
export interface SacPatientFactors {
  genetic?: boolean;
  ageUnder15OrOver65?: boolean;
  female?: boolean;
  hypertension?: boolean;
  coronaryDisease?: boolean;
  ckd?: boolean; // IRC
  obesity?: boolean; // IMC > 30
  lvefBaseline50to55?: boolean; // FEVI basal 50–55 %
  previousDVATC?: boolean; // DVATC / cardiopatía / ICC previa
  concomitantChemoOrRT?: boolean; // uso concomitante o previo de otras QT o RT
  highCumulativeDose?: boolean; // dosis acumulada alta
}

export interface SacInput extends SacPatientFactors {
  treatment: SacTreatment;
  /** Puntos de tratamiento (0–4). PROVISIONAL — si se omite, se usa el default. */
  treatmentPoints?: number;
}

/** Punto de tratamiento por defecto (PROVISIONAL) para un agente cardiotóxico. */
export const SAC_DEFAULT_TREATMENT_POINTS = 2;

// Tabla 2: qué factores del paciente cuentan (1 pt) para cada tipo de tratamiento.
// `true` = "Sí" en la Tabla 2; "No", "No establecido" y celdas vacías → no cuenta.
const APPLIES: Record<keyof SacPatientFactors, Record<SacTreatment, boolean>> = {
  genetic: { 'anthracycline': true, 'anti-her2': false, 'anti-vegf': false },
  ageUnder15OrOver65: { 'anthracycline': true, 'anti-her2': true, 'anti-vegf': false },
  female: { 'anthracycline': true, 'anti-her2': false, 'anti-vegf': false },
  hypertension: { 'anthracycline': true, 'anti-her2': true, 'anti-vegf': true },
  coronaryDisease: { 'anthracycline': true, 'anti-her2': true, 'anti-vegf': true },
  ckd: { 'anthracycline': true, 'anti-her2': false, 'anti-vegf': false },
  obesity: { 'anthracycline': false, 'anti-her2': true, 'anti-vegf': false },
  lvefBaseline50to55: { 'anthracycline': true, 'anti-her2': true, 'anti-vegf': false },
  previousDVATC: { 'anthracycline': true, 'anti-her2': true, 'anti-vegf': true },
  concomitantChemoOrRT: { 'anthracycline': true, 'anti-her2': true, 'anti-vegf': true },
  highCumulativeDose: { 'anthracycline': true, 'anti-her2': false, 'anti-vegf': false },
};

const FACTOR_LABEL: Record<keyof SacPatientFactors, string> = {
  genetic: 'genéticos',
  ageUnder15OrOver65: 'edad <15 o >65',
  female: 'género femenino',
  hypertension: 'HTA',
  coronaryDisease: 'enfermedad coronaria',
  ckd: 'IRC',
  obesity: 'IMC >30',
  lvefBaseline50to55: 'FEVI basal 50–55%',
  previousDVATC: 'DVATC/cardiopatía/ICC previa',
  concomitantChemoOrRT: 'QT/RT concomitante o previa',
  highCumulativeDose: 'dosis acumulada',
};

export interface SacResult {
  patientPoints: number;
  treatmentPoints: number;
  total: number;
  category: SacCategory;
  factorsPresent: string[];
  /** `true` si los puntos de tratamiento salieron del default provisional. */
  provisional: boolean;
}

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

/** Categoría SAC-DVATC: bajo <3 · intermedio 3–4 · alto 5–6 · muy alto >6. */
export function sacCategory(total: number): SacCategory {
  if (total < 3) return 'low';
  if (total <= 4) return 'intermediate';
  if (total <= 6) return 'high';
  return 'very-high';
}

/**
 * Calcula el score SAC-DVATC (riesgo de cardiotoxicidad).
 * @param input - Tipo de tratamiento + factores del paciente. `treatmentPoints`
 *   opcional (si se omite, se usa el default provisional).
 * @returns Puntaje desglosado y categoría.
 */
export function computeSac(input: SacInput): SacResult {
  const keys = Object.keys(APPLIES) as (keyof SacPatientFactors)[];
  let patientPoints = 0;
  const factorsPresent: string[] = [];
  for (const k of keys) {
    if (input[k] && APPLIES[k][input.treatment]) {
      patientPoints++;
      factorsPresent.push(FACTOR_LABEL[k]);
    }
  }
  const treatmentPoints = clamp(input.treatmentPoints ?? SAC_DEFAULT_TREATMENT_POINTS, 0, 4);
  const total = patientPoints + treatmentPoints;
  return {
    patientPoints,
    treatmentPoints,
    total,
    category: sacCategory(total),
    factorsPresent,
    provisional: input.treatmentPoints === undefined,
  };
}

const CATEGORY_LABEL: Record<SacCategory, string> = {
  low: 'Bajo',
  intermediate: 'Intermedio', // "Medio" en el value-set de la planilla
  high: 'Alto',
  'very-high': 'Muy alto',
};

/**
 * Construye un `RiskAssessment` FHIR a partir del resultado SAC-DVATC.
 * @param result - Salida de `computeSac`.
 * @param subject - Referencia al Patient.
 * @param basis - Conditions/Observations/MedicationStatement de entrada.
 * @returns RiskAssessment (method SAC-DVATC).
 */
export function buildSacRiskAssessment(
  result: SacResult,
  subject: RiskAssessment['subject'],
  basis: Reference[] = []
): RiskAssessment {
  return {
    resourceType: 'RiskAssessment',
    status: 'final',
    subject,
    occurrenceDateTime: new Date().toISOString(),
    method: riskMethodConcept('SAC-DVATC'),
    basis: basis.length > 0 ? basis : undefined,
    prediction: [
      {
        outcome: { text: 'Riesgo de cardiotoxicidad (DVATC) — Consenso SAC' },
        qualitativeRisk: { text: CATEGORY_LABEL[result.category] },
      },
    ],
    extension: result.provisional
      ? [{ url: SYSTEMS.riskSourceExt, valueCode: 'computed-provisional' }]
      : undefined,
    note: [
      {
        text:
          `SAC-DVATC: ${result.total} pts (paciente ${result.patientPoints} + tratamiento ${result.treatmentPoints}) ` +
          `→ ${CATEGORY_LABEL[result.category]}. ` +
          (result.provisional ? '⚠ Puntos de tratamiento PROVISIONALES (pendiente cita del Consenso). ' : '') +
          `Factores del paciente: ${result.factorsPresent.join(', ') || 'ninguno'}. ` +
          `Calculado por el motor de scores Cardio-Onco.`,
      },
    ],
  };
}
