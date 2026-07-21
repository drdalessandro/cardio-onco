// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * EPA Bienestar IA — Cardio-Oncología Marie Curie
 * Motor de score AHA PREVENT 2023 (modelo completo: base + HbA1c + UACR).
 *
 * Función pura + builder de FHIR `RiskAssessment`. Sin dependencias de runtime
 * más allá del diccionario de códigos → usable desde frontend, scripts y (inline)
 * Bots Medplum.
 *
 * Fuente de las ecuaciones y coeficientes:
 *   Khan SS, Matsushita K, Sang Y, et al. "Development and Validation of the
 *   American Heart Association's PREVENT Equations." Circulation. 2024;149:430-449.
 * Coeficientes verificados en prevent.test.ts contra el caso publicado de la
 * implementación de referencia (martingmayer/preventr).
 *
 * Alcance: modelos `base`, `hba1c` y `uacr`. El modelo `full`/SDI usa el Social
 * Deprivation Index por código postal de EE.UU. y NO es aplicable a Argentina.
 */

import type { Reference, RiskAssessment } from '@medplum/fhirtypes';
import { SYSTEMS, riskMethodConcept } from '../data-dictionary';
import { pct } from './common';
import { PREVENT_COEFFS } from './prevent-coefficients';
import type { PreventModel, PreventSex } from './prevent-coefficients';

/** mg/dL por mmol/L para colesterol (factor de conversión PREVENT). */
const MMOL_PER_MGDL = 38.66976;

/** Rango etario validado de PREVENT. */
export const PREVENT_MIN_AGE = 30;
export const PREVENT_MAX_AGE = 79;

export interface PreventInput {
  age: number; // años
  sex: PreventSex; // sexo biológico
  totalCholesterol: number; // mg/dL
  hdl: number; // mg/dL
  systolicBP: number; // mmHg
  bpTreated: boolean; // tratamiento antihipertensivo actual
  statin: boolean; // uso de estatina
  diabetes: boolean;
  smoking: boolean; // fumador actual
  egfr: number; // mL/min/1.73m² (CKD-EPI 2021)
  bmi: number; // kg/m²
  hba1c?: number; // % — opcional, activa el modelo CKM con HbA1c
  uacr?: number; // mg/g — opcional (cociente albúmina/creatinina), activa modelo CKM con UACR
}

/** Probabilidades (0..1) de un horizonte. */
export interface PreventRisk {
  totalCvd: number; // ECV total (ASCVD + IC) — número principal de PREVENT
  ascvd: number; // enfermedad cardiovascular aterosclerótica
}

/** Categoría ASCVD estándar (ACC/AHA) — banda primaria. */
export type PreventCategory = 'low' | 'borderline' | 'intermediate' | 'high';
/** Banda alternativa (más agresiva, >10 % = alto). */
export type PreventCategoryAlt = 'low' | 'intermediate' | 'moderate' | 'high';

export interface PreventResult {
  model: PreventModel; // modelo efectivamente usado
  tenYear: PreventRisk;
  thirtyYear: PreventRisk;
  /** Categoría ASCVD estándar (primaria) sobre el riesgo **ASCVD** a 10 años (%). */
  category: PreventCategory;
  /** Banda alternativa (bajo <5 · inter 5–7,5 · moderado 7,5–10 · alto >10) sobre ASCVD a 10 años. */
  categoryAlt: PreventCategoryAlt;
}

/** Redondeo "half up" (aleja de cero en el empate), como la implementación de referencia. */
function roundHalfUp(x: number, digits = 3): number {
  const f = 10 ** digits;
  return (Math.sign(x) * Math.round(Math.abs(x) * f)) / f;
}

/**
 * Categoría ASCVD estándar ACC/AHA (banda primaria, confirmada por el autor):
 * bajo <5 % · límite 5–7,4 % · intermedio 7,5–19,9 % · alto ≥20 %.
 * Se aplica al riesgo **ASCVD** a 10 años.
 */
export function preventCategory(ascvdPercent: number): PreventCategory {
  if (ascvdPercent < 5) return 'low';
  if (ascvdPercent < 7.5) return 'borderline';
  if (ascvdPercent < 20) return 'intermediate';
  return 'high';
}

/**
 * Banda alternativa (más agresiva) sobre el mismo % ASCVD:
 * bajo <5 · inter 5–7,5 · moderado 7,5–10 · alto >10.
 */
export function preventCategoryAlt(ascvdPercent: number): PreventCategoryAlt {
  if (ascvdPercent < 5) return 'low';
  if (ascvdPercent < 7.5) return 'intermediate';
  if (ascvdPercent <= 10) return 'moderate';
  return 'high';
}

/** Selecciona el modelo automáticamente según qué factores CKM haya. */
function autoModel(input: PreventInput): PreventModel {
  const hasUacr = input.uacr !== undefined && input.uacr !== null;
  const hasHba1c = input.hba1c !== undefined && input.hba1c !== null;
  // Combinar HbA1c + UACR requiere el modelo `full` (dependiente de SDI, no disponible en AR).
  if (hasUacr) return 'uacr';
  if (hasHba1c) return 'hba1c';
  return 'base';
}

/** Valores de cada predictor canónico (centrados/spline como PREVENT). */
function predictorValues(p: PreventInput): Record<string, number> {
  const ageC = (p.age - 55) / 10;
  const nonHdl = (p.totalCholesterol - p.hdl) / MMOL_PER_MGDL - 3.5;
  const hdl = (p.hdl / MMOL_PER_MGDL - 1.3) / 0.3;
  const sbpLt = (Math.min(p.systolicBP, 110) - 110) / 20;
  const sbpGe = (Math.max(p.systolicBP, 110) - 130) / 20;
  const bmiLt = (Math.min(p.bmi, 30) - 25) / 5;
  const bmiGe = (Math.max(p.bmi, 30) - 30) / 5;
  const egfrLt = (Math.min(p.egfr, 60) - 60) / -15;
  const egfrGe = (Math.max(p.egfr, 60) - 90) / -15;
  const dm = p.diabetes ? 1 : 0;
  const smk = p.smoking ? 1 : 0;
  const bptx = p.bpTreated ? 1 : 0;
  const statin = p.statin ? 1 : 0;
  const hasHba1c = p.hba1c !== undefined && p.hba1c !== null;
  const hasUacr = p.uacr !== undefined && p.uacr !== null;

  return {
    age: ageC,
    age_squared: ageC * ageC,
    non_hdl: nonHdl,
    hdl,
    sbp_lt110: sbpLt,
    sbp_ge110: sbpGe,
    diabetes: dm,
    smoking: smk,
    bmi_lt30: bmiLt,
    bmi_ge30: bmiGe,
    egfr_lt60: egfrLt,
    egfr_ge60: egfrGe,
    antihtn: bptx,
    statin,
    treated_sbp_ge110: bptx * sbpGe,
    treated_non_hdl: statin * nonHdl,
    age_x_non_hdl: ageC * nonHdl,
    age_x_hdl: ageC * hdl,
    age_x_sbp_ge110: ageC * sbpGe,
    age_x_diabetes: ageC * dm,
    age_x_smoking: ageC * smk,
    age_x_bmi_ge30: ageC * bmiGe,
    age_x_egfr_lt60: ageC * egfrLt,
    hba1c_dm: hasHba1c && dm === 1 ? (p.hba1c as number) - 5.3 : 0,
    hba1c_no_dm: hasHba1c && dm === 0 ? (p.hba1c as number) - 5.3 : 0,
    missing_hba1c: hasHba1c ? 0 : 1,
    ln_uacr: hasUacr ? Math.log(p.uacr as number) : 0,
    missing_uacr: hasUacr ? 0 : 1,
    constant: 1,
  };
}

function computeOne(tableKey: string, sexOutcome: string, values: Record<string, number>): number {
  const table = PREVENT_COEFFS[tableKey];
  const coeffs = table.coeffs[sexOutcome];
  if (!coeffs) {
    throw new Error(`PREVENT: no hay coeficientes para ${tableKey} / ${sexOutcome}`);
  }
  let lp = 0;
  for (let i = 0; i < table.keys.length; i++) {
    const v = roundHalfUp(values[table.keys[i]] ?? 0, 3);
    lp += coeffs[i] * v;
  }
  const odds = Math.exp(lp);
  return odds / (1 + odds);
}

/**
 * Calcula el riesgo PREVENT 2023 (ECV total y ASCVD, a 10 y 30 años).
 * @param input - Datos del paciente. Colesterol/HDL en mg/dL.
 * @param modelOverride - Forzar un modelo (`base`|`hba1c`|`uacr`).
 * @returns Probabilidades (0..1) y categoría.
 */
export function computePrevent(input: PreventInput, modelOverride?: PreventModel): PreventResult {
  if (input.age < PREVENT_MIN_AGE || input.age > PREVENT_MAX_AGE) {
    throw new Error(`PREVENT válido para edades ${PREVENT_MIN_AGE}–${PREVENT_MAX_AGE} años (recibido: ${input.age}).`);
  }
  const values = predictorValues(input);
  const model = modelOverride ?? autoModel(input);
  const sex = input.sex;

  const tenYear: PreventRisk = {
    totalCvd: computeOne(`${model}_10yr`, `${sex}_total_cvd`, values),
    ascvd: computeOne(`${model}_10yr`, `${sex}_ascvd`, values),
  };
  const thirtyYear: PreventRisk = {
    totalCvd: computeOne(`${model}_30yr`, `${sex}_total_cvd`, values),
    ascvd: computeOne(`${model}_30yr`, `${sex}_ascvd`, values),
  };

  return {
    model,
    tenYear,
    thirtyYear,
    category: preventCategory(tenYear.ascvd * 100),
    categoryAlt: preventCategoryAlt(tenYear.ascvd * 100),
  };
}

const CATEGORY_LABEL: Record<PreventCategory, string> = {
  low: 'Bajo (<5%)',
  borderline: 'Límite (5–7,4%)',
  intermediate: 'Intermedio (7,5–19,9%)',
  high: 'Alto (≥20%)',
};

/**
 * Construye un `RiskAssessment` FHIR a partir del resultado PREVENT.
 * @param result - Salida de `computePrevent`.
 * @param subject - Referencia al Patient.
 * @param basis - Observations/Conditions de entrada (trazabilidad).
 * @returns Recurso RiskAssessment (method PREVENT-AHA-2023).
 */
export function buildPreventRiskAssessment(
  result: PreventResult,
  subject: RiskAssessment['subject'],
  basis: Reference[] = []
): RiskAssessment {
  return {
    resourceType: 'RiskAssessment',
    status: 'final',
    subject,
    occurrenceDateTime: new Date().toISOString(),
    method: riskMethodConcept('PREVENT-AHA-2023'),
    basis: basis.length > 0 ? basis : undefined,
    prediction: [
      {
        // La categoría (banda ASCVD estándar) se ancla a la predicción ASCVD a 10 años.
        outcome: { text: 'ASCVD a 10 años' },
        probabilityDecimal: pct(result.tenYear.ascvd),
        qualitativeRisk: {
          coding: [{ system: SYSTEMS.riskScoreMethod, code: `prevent-ascvd-${result.category}` }],
          text: CATEGORY_LABEL[result.category],
        },
        whenRange: { high: { value: 10, unit: 'a', system: SYSTEMS.ucum, code: 'a' } },
      },
      {
        outcome: { text: 'ECV total a 10 años' },
        probabilityDecimal: pct(result.tenYear.totalCvd),
        whenRange: { high: { value: 10, unit: 'a', system: SYSTEMS.ucum, code: 'a' } },
      },
      {
        outcome: { text: 'ASCVD a 30 años' },
        probabilityDecimal: pct(result.thirtyYear.ascvd),
        whenRange: { high: { value: 30, unit: 'a', system: SYSTEMS.ucum, code: 'a' } },
      },
      {
        outcome: { text: 'ECV total a 30 años' },
        probabilityDecimal: pct(result.thirtyYear.totalCvd),
        whenRange: { high: { value: 30, unit: 'a', system: SYSTEMS.ucum, code: 'a' } },
      },
    ],
    note: [
      {
        text:
          `AHA PREVENT 2023 (modelo ${result.model}). ` +
          `ASCVD 10a: ${pct(result.tenYear.ascvd)}% — ${CATEGORY_LABEL[result.category]} (banda ASCVD estándar). ` +
          `ECV total 10a: ${pct(result.tenYear.totalCvd)}% · ASCVD 30a: ${pct(result.thirtyYear.ascvd)}%. ` +
          `Calculado por el motor de scores Cardio-Onco.`,
      },
    ],
  };
}
