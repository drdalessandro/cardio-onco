// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * EPA Bienestar IA — Cardio-Oncología Marie Curie
 * Score ESC SCORE2 (2021) y SCORE2-OP (≥70 años) — riesgo de ECV fatal y no
 * fatal a 10 años.
 *
 * Fuente: SCORE2 working group & ESC Cardiovascular risk collaboration.
 * "SCORE2 risk prediction algorithms: new models to estimate 10-year risk of
 * cardiovascular disease in Europe." Eur Heart J. 2021;42(25):2439-2454.
 * "SCORE2-OP" Eur Heart J. 2021;42(25):2455-2467.
 * Coeficientes, escalas de recalibración y fórmula portados verbatim de la
 * implementación de referencia CRAN RiskScorescvd (dvicencio/RiskScorescvd,
 * R/11_SCORE2_func.R) y verificados en score2.test.ts.
 *
 * ⚠️ Unidades: colesterol total y HDL en **mmol/L** (SCORE2 es un score europeo
 *    definido en mmol/L). Usar `mgDlToMmolChol()` para convertir desde mg/dL.
 * ⚠️ Región: SCORE2 requiere una región de riesgo (Low/Moderate/High/Very high),
 *    calibrada para países europeos. Argentina NO tiene clasificación oficial;
 *    la elección es un juicio clínico (por defecto 'Low').
 */

import type { Reference, RiskAssessment } from '@medplum/fhirtypes';
import { riskMethodConcept } from '../data-dictionary';
import { pct } from './common';

export const SCORE2_MIN_AGE = 40;
export const SCORE2_MAX_AGE = 89;

export type Score2Region = 'Low' | 'Moderate' | 'High' | 'Very high';
export type Score2Sex = 'female' | 'male';

export interface Score2Input {
  age: number; // 40–89
  sex: Score2Sex;
  smoking: boolean;
  systolicBP: number; // mmHg
  diabetes: boolean;
  totalCholesterol: number; // mmol/L
  hdl: number; // mmol/L
}

export type Score2Category = 'low' | 'moderate' | 'high';

export interface Score2Result {
  model: 'SCORE2' | 'SCORE2-OP';
  region: Score2Region;
  risk10yr: number; // proporción 0..1
  category: Score2Category;
}

// Escalas de recalibración por región (scale1, scale2), por sexo y banda etaria.
const SCALE: Record<string, [number, number]> = {
  'Low_male_<70': [-0.5699, 0.7476], 'Low_female_<70': [-0.738, 0.7019],
  'Moderate_male_<70': [-0.1565, 0.8009], 'Moderate_female_<70': [-0.3143, 0.7701],
  'High_male_<70': [0.3207, 0.936], 'High_female_<70': [0.571, 0.9369],
  'Very high_male_<70': [0.5836, 0.8294], 'Very high_female_<70': [0.9412, 0.8329],
  'Low_male_>=70': [-0.34, 1.19], 'Low_female_>=70': [-0.52, 1.01],
  'Moderate_male_>=70': [0.01, 1.25], 'Moderate_female_>=70': [-0.1, 1.1],
  'High_male_>=70': [0.08, 1.15], 'High_female_>=70': [0.38, 1.09],
  'Very high_male_>=70': [0.05, 0.7], 'Very high_female_>=70': [0.38, 0.69],
};

/** Convierte colesterol de mg/dL a mmol/L (factor colesterol). */
export function mgDlToMmolChol(mgdl: number): number {
  return mgdl / 38.66976;
}

/** Categoría SCORE2 (dependiente de la edad), según ESC. */
export function score2Category(age: number, riskPercent: number): Score2Category {
  let modHigh: [number, number];
  if (age < 50) modHigh = [2.5, 7.5];
  else if (age < 70) modHigh = [5, 10];
  else modHigh = [7.5, 15];
  if (riskPercent < modHigh[0]) return 'low';
  if (riskPercent < modHigh[1]) return 'moderate';
  return 'high';
}

/**
 * Calcula SCORE2 / SCORE2-OP (riesgo de ECV a 10 años).
 * @param p - Datos del paciente (colesterol/HDL en mmol/L).
 * @param region - Región de riesgo ESC. Por defecto 'Low' (ver nota sobre Argentina).
 * @returns Proporción 0..1, modelo usado y categoría.
 */
export function computeScore2(p: Score2Input, region: Score2Region = 'Low'): Score2Result {
  if (p.age < SCORE2_MIN_AGE || p.age > SCORE2_MAX_AGE) {
    throw new Error(`SCORE2 válido para edades ${SCORE2_MIN_AGE}–${SCORE2_MAX_AGE} años (recibido: ${p.age}).`);
  }
  const smk = p.smoking ? 1 : 0;
  const dm = p.diabetes ? 1 : 0;
  const band = p.age < 70 ? '<70' : '>=70';
  const [scale1, scale2] = SCALE[`${region}_${p.sex}_${band}`];

  let uncalibrated: number;

  if (p.age < 70) {
    const cage = (p.age - 60) / 5;
    const csbp = (p.systolicBP - 120) / 20;
    const cchol = (p.totalCholesterol - 6) / 1;
    const chdl = (p.hdl - 1.3) / 0.5;
    const c =
      p.sex === 'male'
        ? { age: 0.3742, smk: 0.6012, sbp: 0.2777, dm: 0.6457, chol: 0.1458, hdl: -0.2698,
            aSmk: -0.0755, aSbp: -0.0255, aChol: -0.0281, aHdl: 0.0426, aDm: -0.0983, s0: 0.9605 }
        : { age: 0.4648, smk: 0.7744, sbp: 0.3131, dm: 0.8096, chol: 0.1002, hdl: -0.2606,
            aSmk: -0.1088, aSbp: -0.0277, aChol: -0.0226, aHdl: 0.0613, aDm: -0.1272, s0: 0.9776 };
    const x =
      c.age * cage + c.smk * smk + c.sbp * csbp + c.dm * dm + c.chol * cchol + c.hdl * chdl +
      c.aSmk * cage * smk + c.aSbp * cage * csbp + c.aChol * cage * cchol + c.aHdl * cage * chdl + c.aDm * cage * dm;
    uncalibrated = 1 - Math.pow(c.s0, Math.exp(x));
  } else {
    const a = p.age - 73;
    const csbp = p.systolicBP - 150;
    const cchol = p.totalCholesterol - 6;
    const chdl = p.hdl - 1.4;
    const c =
      p.sex === 'male'
        ? { age: 0.0634, dm: 0.4245, smk: 0.3524, sbp: 0.0094, chol: 0.085, hdl: -0.3564,
            aDm: -0.0174, aSmk: -0.0247, aSbp: -0.0005, aChol: 0.0073, aHdl: 0.0091, s0: 0.7576, adj: 0.0929 }
        : { age: 0.0789, dm: 0.601, smk: 0.4921, sbp: 0.0102, chol: 0.0605, hdl: -0.304,
            aDm: -0.0107, aSmk: -0.0255, aSbp: -0.0004, aChol: -0.0009, aHdl: 0.0154, s0: 0.8082, adj: 0.229 };
    const x =
      c.age * a + c.dm * dm + c.smk * smk + c.sbp * csbp + c.chol * cchol + c.hdl * chdl +
      c.aDm * a * dm + c.aSmk * a * smk + c.aSbp * a * csbp + c.aChol * a * cchol + c.aHdl * a * chdl;
    uncalibrated = 1 - Math.pow(c.s0, Math.exp(x - c.adj));
  }

  const risk = 1 - Math.exp(-Math.exp(scale1 + scale2 * Math.log(-Math.log(1 - uncalibrated))));
  return {
    model: p.age < 70 ? 'SCORE2' : 'SCORE2-OP',
    region,
    risk10yr: risk,
    category: score2Category(p.age, risk * 100),
  };
}

const CATEGORY_LABEL: Record<Score2Category, string> = {
  low: 'Bajo',
  moderate: 'Moderado',
  high: 'Alto',
};

/**
 * Construye un `RiskAssessment` FHIR a partir del resultado SCORE2.
 * @param result - Salida de `computeScore2`.
 * @param subject - Referencia al Patient.
 * @param basis - Observations/Conditions de entrada (trazabilidad).
 * @returns RiskAssessment (method ESC-SCORE2).
 */
export function buildScore2RiskAssessment(
  result: Score2Result,
  subject: RiskAssessment['subject'],
  basis: Reference[] = []
): RiskAssessment {
  return {
    resourceType: 'RiskAssessment',
    status: 'final',
    subject,
    occurrenceDateTime: new Date().toISOString(),
    method: riskMethodConcept('ESC-SCORE2'),
    basis: basis.length > 0 ? basis : undefined,
    prediction: [
      {
        outcome: { text: `ECV fatal y no fatal a 10 años (${result.model}, región ${result.region})` },
        probabilityDecimal: pct(result.risk10yr),
        qualitativeRisk: { text: CATEGORY_LABEL[result.category] },
        whenRange: { high: { value: 10, unit: 'a', system: 'http://unitsofmeasure.org', code: 'a' } },
      },
    ],
    note: [
      {
        text:
          `${result.model} (región ${result.region}). Riesgo a 10 años: ${pct(result.risk10yr)}% — ` +
          `${CATEGORY_LABEL[result.category]}. Región no oficial para Argentina (elección clínica). ` +
          `Calculado por el motor de scores Cardio-Onco.`,
      },
    ],
  };
}
