// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * EPA Bienestar IA — Cardio-Oncología Marie Curie
 * Score Globorisk — riesgo de ECV (fatal + no fatal) a 10 años, recalibrado para
 * Argentina. Es el motor sobre el que se construyen las cartas OPS/OMS.
 *
 * Fuente: Ueda P, Woodward M, Lu Y, et al. "Laboratory-Based and Office-Based
 * Risk Scores and Charts to Predict 10-Year Risk of Cardiovascular Disease in
 * 182 Countries." Lancet Diabetes Endocrinol. 2017;5(3):196-213.
 * Algoritmo y datos (coeficientes, medias poblacionales y tasas basales de ECV
 * para Argentina) portados verbatim de la implementación de referencia
 * boyercb/globorisk. Verificado en globorisk.test.ts.
 *
 * ⚠️ Unidades: colesterol total en **mmol/L** (usar `mgDlToMmolChol()` de score2).
 * ⚠️ Esta es la variante **por país (Argentina)** de Globorisk; puede diferir
 *    levemente de la variante regional AMR-B que usa la app oficial de la OPS.
 *    Para validación absoluta vs. la app oficial, contrastar un caso testigo.
 */

import type { Reference, RiskAssessment } from '@medplum/fhirtypes';
import { riskMethodConcept } from '../data-dictionary';
import { pct } from './common';
import {
  GLOBORISK_BASELINE_YEAR, GLOBORISK_COEF_LAB_LAC, GLOBORISK_COEF_LAB_NONLAC,
  GLOBORISK_CVDR_AR_2020, GLOBORISK_RF_AR,
} from './globorisk-data-ar';
import type { GloboriskLabCoef } from './globorisk-data-ar';

export const GLOBORISK_MIN_AGE = 40;
export const GLOBORISK_MAX_AGE = 80;

export type GloboriskSex = 'female' | 'male';

export interface GloboriskInput {
  age: number; // 40–80
  sex: GloboriskSex;
  systolicBP: number; // mmHg
  totalCholesterol: number; // mmol/L
  diabetes: boolean;
  smoking: boolean;
}

export type GloboriskCategory = 'low' | 'moderate' | 'high' | 'very-high';

export interface GloboriskResult {
  risk10yr: number; // proporción 0..1
  category: GloboriskCategory;
  updatedLac: boolean;
  baselineYear: number;
}

/** Categorías de las cartas OPS/OMS: <10% bajo, 10–20% moderado, 20–30% alto, ≥30% muy alto. */
export function globoriskCategory(riskPercent: number): GloboriskCategory {
  if (riskPercent < 10) return 'low';
  if (riskPercent < 20) return 'moderate';
  if (riskPercent < 30) return 'high';
  return 'very-high';
}

/**
 * Calcula Globorisk (ECV a 10 años) para Argentina, modelo de laboratorio.
 * @param p - Datos del paciente (colesterol en mmol/L).
 * @param updatedLac - Usar ecuaciones actualizadas para América Latina (default true).
 * @returns Proporción 0..1 y categoría.
 */
export function computeGloborisk(p: GloboriskInput, updatedLac = true): GloboriskResult {
  if (p.age < GLOBORISK_MIN_AGE || p.age > GLOBORISK_MAX_AGE) {
    throw new Error(`Globorisk válido para edades ${GLOBORISK_MIN_AGE}–${GLOBORISK_MAX_AGE} años (recibido: ${p.age}).`);
  }
  const sex = p.sex === 'female' ? 1 : 0; // 0 = hombre, 1 = mujer
  const age = Math.trunc(p.age);
  const agec = age < 85 ? Math.trunc(age / 5) - 7 : 10;

  const means = GLOBORISK_RF_AR[`${sex}_${agec}`];
  const cvd = GLOBORISK_CVDR_AR_2020[`${sex}_${age}`];
  if (!means || !cvd) {
    throw new Error('Globorisk: sin datos de calibración de Argentina para esa edad/sexo.');
  }

  const sbpC = p.systolicBP / 10 - means.mean_sbp;
  const tcC = p.totalCholesterol - means.mean_tc;
  const dmC = (p.diabetes ? 1 : 0) - means.mean_dm;
  const smkC = (p.smoking ? 1 : 0) - means.mean_smk;

  const c: GloboriskLabCoef = updatedLac ? GLOBORISK_COEF_LAB_LAC : GLOBORISK_COEF_LAB_NONLAC;

  let totalSurvival = 1;
  for (let t = 0; t <= 9; t++) {
    let lp =
      sbpC * c.main_sbpc +
      tcC * c.main_tcc +
      dmC * c.main_dm +
      smkC * c.main_smok +
      sex * dmC * c.main_sexdm +
      sex * smkC * c.main_sexsmok +
      (age + t) * sbpC * c.tvc_sbpc;
    if (!updatedLac) {
      lp +=
        (age + t) * tcC * (c.tvc_tcc as number) +
        (age + t) * dmC * (c.tvc_dm as number) +
        (age + t) * smkC * (c.tvc_smok as number);
    }
    const hazard = Math.exp(lp) * cvd[t];
    totalSurvival *= Math.exp(-hazard);
  }

  const risk = 1 - totalSurvival;
  return { risk10yr: risk, category: globoriskCategory(risk * 100), updatedLac, baselineYear: GLOBORISK_BASELINE_YEAR };
}

const CATEGORY_LABEL: Record<GloboriskCategory, string> = {
  low: 'Bajo (<10%)',
  moderate: 'Moderado (10–20%)',
  high: 'Alto (20–30%)',
  'very-high': 'Muy alto (≥30%)',
};

/**
 * Construye un `RiskAssessment` FHIR a partir del resultado Globorisk.
 * @param result - Salida de `computeGloborisk`.
 * @param subject - Referencia al Patient.
 * @param basis - Observations/Conditions de entrada (trazabilidad).
 * @returns RiskAssessment (method GLOBORISK).
 */
export function buildGloboriskRiskAssessment(
  result: GloboriskResult,
  subject: RiskAssessment['subject'],
  basis: Reference[] = []
): RiskAssessment {
  return {
    resourceType: 'RiskAssessment',
    status: 'final',
    subject,
    occurrenceDateTime: new Date().toISOString(),
    method: riskMethodConcept('GLOBORISK'),
    basis: basis.length > 0 ? basis : undefined,
    prediction: [
      {
        outcome: { text: 'ECV (fatal + no fatal) a 10 años (Globorisk, Argentina)' },
        probabilityDecimal: pct(result.risk10yr),
        qualitativeRisk: { text: CATEGORY_LABEL[result.category] },
        whenRange: { high: { value: 10, unit: 'a', system: 'http://unitsofmeasure.org', code: 'a' } },
      },
    ],
    note: [
      {
        text:
          `Globorisk (motor de las cartas OPS/OMS), recalibrado Argentina, año base ${result.baselineYear}` +
          `${result.updatedLac ? ', ecuaciones LAC actualizadas' : ''}. ` +
          `Riesgo a 10 años: ${pct(result.risk10yr)}% — ${CATEGORY_LABEL[result.category]}. ` +
          `Variante por país; puede diferir de la regional AMR-B de la app oficial OPS. ` +
          `Calculado por el motor de scores Cardio-Onco.`,
      },
    ],
  };
}
