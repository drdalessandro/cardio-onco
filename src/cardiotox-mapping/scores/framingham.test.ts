// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * Tests del score Framingham 2008.
 *
 * Caso ancla EXTERNO (test de la implementación de referencia CVrisk):
 *   hombre 55 años, TA 140 (no tratada), HDL 50, CT 213, no fumador, sin DBT
 *   → 13,53 % a 10 años.
 * El resto son casos golden computados con la fórmula verificada.
 */
import { describe, expect, it } from 'vitest';
import { computeFramingham, framinghamCategory, buildFraminghamRiskAssessment } from './framingham';
import type { FraminghamInput } from './framingham';

describe('computeFramingham — caso ancla de referencia (hombre)', () => {
  const r = computeFramingham({
    age: 55, sex: 'male', totalCholesterol: 213, hdl: 50,
    systolicBP: 140, bpTreated: false, smoking: false, diabetes: false,
  });
  it('coincide con el 13,53 % publicado', () => {
    expect(r.risk10yr * 100).toBeCloseTo(13.53, 2);
  });
  it('categoriza como intermedio (10–20%)', () => {
    expect(r.category).toBe('intermediate');
  });
});

describe('computeFramingham — casos golden', () => {
  const cases: Array<[string, FraminghamInput, number]> = [
    ['female_45', { age: 45, sex: 'female', totalCholesterol: 200, hdl: 50, systolicBP: 125, bpTreated: true, smoking: false, diabetes: false }, 4.6842],
    ['female_dm_smk', { age: 60, sex: 'female', totalCholesterol: 250, hdl: 40, systolicBP: 160, bpTreated: true, smoking: true, diabetes: true }, 62.3957],
    ['male_smk', { age: 60, sex: 'male', totalCholesterol: 220, hdl: 45, systolicBP: 130, bpTreated: false, smoking: true, diabetes: false }, 30.3765],
  ];
  it.each(cases)('%s', (_name, input, expectedPct) => {
    expect(computeFramingham(input).risk10yr * 100).toBeCloseTo(expectedPct, 3);
  });
});

describe('framinghamCategory — umbrales estándar ECV', () => {
  it('bajo <10', () => expect(framinghamCategory(9.9)).toBe('low'));
  it('intermedio 10–20', () => {
    expect(framinghamCategory(10)).toBe('intermediate');
    expect(framinghamCategory(19.9)).toBe('intermediate');
  });
  it('alto ≥20', () => expect(framinghamCategory(20)).toBe('high'));
});

describe('computeFramingham — rango etario', () => {
  const base: FraminghamInput = {
    age: 50, sex: 'male', totalCholesterol: 200, hdl: 50,
    systolicBP: 130, bpTreated: false, smoking: false, diabetes: false,
  };
  it('rechaza < 30', () => expect(() => computeFramingham({ ...base, age: 29 })).toThrow());
  it('rechaza > 74', () => expect(() => computeFramingham({ ...base, age: 75 })).toThrow());
});

describe('buildFraminghamRiskAssessment', () => {
  const result = computeFramingham({
    age: 55, sex: 'male', totalCholesterol: 213, hdl: 50,
    systolicBP: 140, bpTreated: false, smoking: false, diabetes: false,
  });
  const ra = buildFraminghamRiskAssessment(result, { reference: 'Patient/1' }, [{ reference: 'Observation/x' }]);
  it('method FRAMINGHAM y una predicción a 10 años', () => {
    expect(ra.method?.coding?.[0]?.code).toBe('FRAMINGHAM');
    expect(ra.prediction).toHaveLength(1);
    expect(ra.prediction?.[0]?.probabilityDecimal).toBeCloseTo(13.5, 1);
  });
});
