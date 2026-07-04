// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * Tests de Globorisk (Argentina, modelo laboratorio).
 *
 * Valores golden portados verbatim del algoritmo + datos de la implementación de
 * referencia boyercb/globorisk (Ueda et al., Lancet D&E 2017). Colesterol en mmol/L.
 *
 * Chequeo de plausibilidad: hombre 60, TA 140, colesterol 5,0 mmol/L, fumador,
 * SIN diabetes → 11,6 % (clínicamente coherente con las cartas OPS/OMS ~10–20%).
 */
import { describe, expect, it } from 'vitest';
import { computeGloborisk, globoriskCategory, buildGloboriskRiskAssessment } from './globorisk';
import type { GloboriskInput } from './globorisk';

describe('computeGloborisk — casos golden (Argentina, LAC actualizado)', () => {
  const cases: Array<[string, GloboriskInput, boolean, number]> = [
    ['m60 fumador', { age: 60, sex: 'male', systolicBP: 140, totalCholesterol: 5.0, diabetes: false, smoking: true }, true, 11.6397],
    ['m60 DBT fum HTA', { age: 60, sex: 'male', systolicBP: 160, totalCholesterol: 5.0, diabetes: true, smoking: true }, true, 30.2135],
    ['f65 DBT fum', { age: 65, sex: 'female', systolicBP: 170, totalCholesterol: 5.0, diabetes: true, smoking: true }, true, 40.8494],
    ['f52 DBT', { age: 52, sex: 'female', systolicBP: 140, totalCholesterol: 4.5, diabetes: true, smoking: false }, true, 7.6336],
    ['m60 fumador (no-LAC)', { age: 60, sex: 'male', systolicBP: 140, totalCholesterol: 5.0, diabetes: false, smoking: true }, false, 12.4898],
  ];
  it.each(cases)('%s', (_name, input, lac, expectedPct) => {
    expect(computeGloborisk(input, lac).risk10yr * 100).toBeCloseTo(expectedPct, 3);
  });

  it('plausibilidad: hombre 60 fumador no diabético ≈ 11–12% (no 63%)', () => {
    const r = computeGloborisk({ age: 60, sex: 'male', systolicBP: 140, totalCholesterol: 5.0, diabetes: false, smoking: true });
    expect(r.risk10yr * 100).toBeLessThan(20);
    expect(r.risk10yr * 100).toBeGreaterThan(5);
  });
});

describe('globoriskCategory — bandas OPS/OMS', () => {
  it('bajo <10', () => expect(globoriskCategory(9.9)).toBe('low'));
  it('moderado 10–20', () => expect(globoriskCategory(15)).toBe('moderate'));
  it('alto 20–30', () => expect(globoriskCategory(25)).toBe('high'));
  it('muy alto ≥30', () => expect(globoriskCategory(30)).toBe('very-high'));
});

describe('computeGloborisk — rango etario', () => {
  const base: GloboriskInput = { age: 60, sex: 'male', systolicBP: 140, totalCholesterol: 5.0, diabetes: false, smoking: false };
  it('rechaza < 40', () => expect(() => computeGloborisk({ ...base, age: 39 })).toThrow());
  it('rechaza > 80', () => expect(() => computeGloborisk({ ...base, age: 81 })).toThrow());
});

describe('buildGloboriskRiskAssessment', () => {
  const result = computeGloborisk({ age: 60, sex: 'male', systolicBP: 140, totalCholesterol: 5.0, diabetes: false, smoking: true });
  const ra = buildGloboriskRiskAssessment(result, { reference: 'Patient/1' });
  it('method GLOBORISK con una predicción', () => {
    expect(ra.method?.coding?.[0]?.code).toBe('GLOBORISK');
    expect(ra.prediction).toHaveLength(1);
    expect(ra.prediction?.[0]?.probabilityDecimal).toBeCloseTo(11.6, 1);
  });
});
