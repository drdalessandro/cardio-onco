// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * Tests de ESC SCORE2 / SCORE2-OP.
 *
 * Valores golden portados verbatim de la implementación de referencia CRAN
 * RiskScorescvd (R/11_SCORE2_func.R), que implementa el material suplementario
 * de SCORE2/SCORE2-OP (Eur Heart J 2021). Colesterol/HDL en mmol/L.
 */
import { describe, expect, it } from 'vitest';
import { computeScore2, score2Category, mgDlToMmolChol, buildScore2RiskAssessment } from './score2';
import type { Score2Input, Score2Region } from './score2';

describe('computeScore2 — casos golden (SCORE2 <70 y SCORE2-OP ≥70)', () => {
  const cases: Array<[string, Score2Input, Score2Region, number, string]> = [
    ['m50 fumador Low', { age: 50, sex: 'male', smoking: true, systolicBP: 140, diabetes: false, totalCholesterol: 6.3, hdl: 1.4 }, 'Low', 6.3143, 'SCORE2'],
    ['f50 fumadora Low', { age: 50, sex: 'female', smoking: true, systolicBP: 140, diabetes: false, totalCholesterol: 6.3, hdl: 1.4 }, 'Low', 4.3319, 'SCORE2'],
    ['m60 no fum Moderate', { age: 60, sex: 'male', smoking: false, systolicBP: 130, diabetes: false, totalCholesterol: 5.5, hdl: 1.3 }, 'Moderate', 6.6543, 'SCORE2'],
    ['OP m75 Low', { age: 75, sex: 'male', smoking: false, systolicBP: 150, diabetes: false, totalCholesterol: 5.5, hdl: 1.4 }, 'Low', 14.0996, 'SCORE2-OP'],
    ['OP f72 fum DBT High', { age: 72, sex: 'female', smoking: true, systolicBP: 160, diabetes: true, totalCholesterol: 6.0, hdl: 1.2 }, 'High', 54.985, 'SCORE2-OP'],
  ];
  it.each(cases)('%s', (_name, input, region, expectedPct, model) => {
    const r = computeScore2(input, region);
    expect(r.risk10yr * 100).toBeCloseTo(expectedPct, 3);
    expect(r.model).toBe(model);
  });
});

describe('score2Category — umbrales dependientes de la edad', () => {
  it('<50 años: bajo <2.5, moderado 2.5–7.5, alto ≥7.5', () => {
    expect(score2Category(45, 2.4)).toBe('low');
    expect(score2Category(45, 5)).toBe('moderate');
    expect(score2Category(45, 7.5)).toBe('high');
  });
  it('50–69 años: bajo <5, moderado 5–10, alto ≥10', () => {
    expect(score2Category(60, 4.9)).toBe('low');
    expect(score2Category(60, 9.9)).toBe('moderate');
    expect(score2Category(60, 10)).toBe('high');
  });
  it('≥70 años: bajo <7.5, moderado 7.5–15, alto ≥15', () => {
    expect(score2Category(75, 7.4)).toBe('low');
    expect(score2Category(75, 14.9)).toBe('moderate');
    expect(score2Category(75, 15)).toBe('high');
  });
});

describe('mgDlToMmolChol', () => {
  it('convierte ~243.6 mg/dL a ~6.3 mmol/L', () => {
    expect(mgDlToMmolChol(243.6)).toBeCloseTo(6.3, 2);
  });
});

describe('computeScore2 — rango etario', () => {
  const base: Score2Input = { age: 55, sex: 'male', smoking: false, systolicBP: 130, diabetes: false, totalCholesterol: 5.5, hdl: 1.3 };
  it('rechaza < 40', () => expect(() => computeScore2({ ...base, age: 39 })).toThrow());
  it('rechaza > 89', () => expect(() => computeScore2({ ...base, age: 90 })).toThrow());
});

describe('buildScore2RiskAssessment', () => {
  const result = computeScore2(
    { age: 50, sex: 'male', smoking: true, systolicBP: 140, diabetes: false, totalCholesterol: 6.3, hdl: 1.4 },
    'Low'
  );
  const ra = buildScore2RiskAssessment(result, { reference: 'Patient/1' });
  it('method ESC-SCORE2 con una predicción', () => {
    expect(ra.method?.coding?.[0]?.code).toBe('ESC-SCORE2');
    expect(ra.prediction).toHaveLength(1);
    expect(ra.prediction?.[0]?.probabilityDecimal).toBeCloseTo(6.3, 1);
  });
});
