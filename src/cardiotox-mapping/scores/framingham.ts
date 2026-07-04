// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * EPA Bienestar IA — Cardio-Oncología Marie Curie
 * Score Framingham 2008 — riesgo de ECV general a 10 años.
 *
 * Fuente: D'Agostino RB Sr, Vasan RS, Pencina MJ, et al. "General cardiovascular
 * risk profile for use in primary care: the Framingham Heart Study."
 * Circulation. 2008;117:743-753.
 * Coeficientes verificados en framingham.test.ts contra el caso de test de la
 * implementación de referencia CVrisk (vcastro/CVrisk): hombre 55a, TA 140,
 * HDL 50, CT 213 → 13,53 %.
 *
 * Modelo con laboratorio (lipídico). Colesterol/HDL en mg/dL.
 */

import type { Reference, RiskAssessment } from '@medplum/fhirtypes';
import { riskMethodConcept } from '../data-dictionary';
import { pct } from './common';

export const FRAMINGHAM_MIN_AGE = 30;
export const FRAMINGHAM_MAX_AGE = 74;

export type FraminghamSex = 'female' | 'male';

export interface FraminghamInput {
  age: number; // años (30–74)
  sex: FraminghamSex;
  totalCholesterol: number; // mg/dL
  hdl: number; // mg/dL
  systolicBP: number; // mmHg
  bpTreated: boolean; // tratamiento antihipertensivo
  smoking: boolean; // fumador actual
  diabetes: boolean;
}

export type FraminghamCategory = 'low' | 'intermediate' | 'high';

export interface FraminghamResult {
  risk10yr: number; // proporción 0..1
  category: FraminghamCategory;
}

interface FrsCoef {
  lnAge: number;
  lnTotChol: number;
  lnHdl: number;
  lnTreatedSbp: number;
  lnUntreatedSbp: number;
  smoker: number;
  diabetes: number;
  groupMean: number;
  baselineSurvival: number;
}

// D'Agostino 2008, Tabla 2 (modelo con lípidos).
const FRS_COEF: Record<FraminghamSex, FrsCoef> = {
  male: {
    lnAge: 3.06117, lnTotChol: 1.1237, lnHdl: -0.93263,
    lnTreatedSbp: 1.99881, lnUntreatedSbp: 1.93303,
    smoker: 0.65451, diabetes: 0.57367,
    groupMean: 23.9802, baselineSurvival: 0.88936,
  },
  female: {
    lnAge: 2.32888, lnTotChol: 1.20904, lnHdl: -0.70833,
    lnTreatedSbp: 2.82263, lnUntreatedSbp: 2.76157,
    smoker: 0.52873, diabetes: 0.69154,
    groupMean: 26.1931, baselineSurvival: 0.95012,
  },
};

/** Categoría de riesgo Framingham ECV a 10 años: bajo <10%, intermedio 10–20%, alto ≥20%. */
export function framinghamCategory(risk10yrPercent: number): FraminghamCategory {
  if (risk10yrPercent < 10) return 'low';
  if (risk10yrPercent < 20) return 'intermediate';
  return 'high';
}

/**
 * Calcula el riesgo Framingham 2008 de ECV general a 10 años.
 * @param p - Datos del paciente (colesterol/HDL en mg/dL).
 * @returns Proporción 0..1 y categoría.
 */
export function computeFramingham(p: FraminghamInput): FraminghamResult {
  if (p.age < FRAMINGHAM_MIN_AGE || p.age > FRAMINGHAM_MAX_AGE) {
    throw new Error(
      `Framingham válido para edades ${FRAMINGHAM_MIN_AGE}–${FRAMINGHAM_MAX_AGE} años (recibido: ${p.age}).`
    );
  }
  const c = FRS_COEF[p.sex];
  const sum =
    Math.log(p.age) * c.lnAge +
    Math.log(p.totalCholesterol) * c.lnTotChol +
    Math.log(p.hdl) * c.lnHdl +
    Math.log(p.systolicBP) * (p.bpTreated ? c.lnTreatedSbp : c.lnUntreatedSbp) +
    (p.smoking ? 1 : 0) * c.smoker +
    (p.diabetes ? 1 : 0) * c.diabetes;

  const risk = 1 - Math.pow(c.baselineSurvival, Math.exp(sum - c.groupMean));
  return { risk10yr: risk, category: framinghamCategory(risk * 100) };
}

const CATEGORY_LABEL: Record<FraminghamCategory, string> = {
  low: 'Bajo (<10%)',
  intermediate: 'Intermedio (10–20%)',
  high: 'Alto (≥20%)',
};

/**
 * Construye un `RiskAssessment` FHIR a partir del resultado Framingham.
 * @param result - Salida de `computeFramingham`.
 * @param subject - Referencia al Patient.
 * @param basis - Observations/Conditions de entrada (trazabilidad).
 * @returns RiskAssessment (method FRAMINGHAM).
 */
export function buildFraminghamRiskAssessment(
  result: FraminghamResult,
  subject: RiskAssessment['subject'],
  basis: Reference[] = []
): RiskAssessment {
  return {
    resourceType: 'RiskAssessment',
    status: 'final',
    subject,
    occurrenceDateTime: new Date().toISOString(),
    method: riskMethodConcept('FRAMINGHAM'),
    basis: basis.length > 0 ? basis : undefined,
    prediction: [
      {
        outcome: { text: 'ECV general a 10 años (Framingham 2008)' },
        probabilityDecimal: pct(result.risk10yr),
        qualitativeRisk: { text: CATEGORY_LABEL[result.category] },
        whenRange: { high: { value: 10, unit: 'a', system: 'http://unitsofmeasure.org', code: 'a' } },
      },
    ],
    note: [
      {
        text:
          `Framingham 2008 (ECV general). Riesgo a 10 años: ${pct(result.risk10yr)}% — ` +
          `${CATEGORY_LABEL[result.category]}. Calculado por el motor de scores Cardio-Onco.`,
      },
    ],
  };
}
