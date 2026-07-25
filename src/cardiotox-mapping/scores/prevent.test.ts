// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * Tests del motor PREVENT 2023.
 *
 * Caso ancla EXTERNO: el ejemplo publicado por la implementación de referencia
 * (martingmayer/preventr): mujer 50 años, SBP 160 (tratada), CT 200, HDL 45,
 * DM, no fumadora, eGFR 90, IMC 35 → modelo base:
 *   10 años: ECV total 0,147 · ASCVD 0,092
 *   30 años: ECV total 0,530 · ASCVD 0,354
 * El resto de los casos golden se computaron con la fórmula verificada + los
 * coeficientes autoritativos.
 */
import { describe, expect, it } from 'vitest';
import { computePrevent, preventCategory, preventCategoryAlt, buildPreventRiskAssessment } from './prevent';
import type { PreventInput } from './prevent';

const readmeCase: PreventInput = {
  age: 50, sex: 'female', systolicBP: 160, bpTreated: true,
  totalCholesterol: 200, hdl: 45, statin: false, diabetes: true,
  smoking: false, egfr: 90, bmi: 35,
};

describe('computePrevent — caso publicado de referencia (base, mujer)', () => {
  const r = computePrevent(readmeCase);

  it('usa el modelo base cuando no hay HbA1c ni UACR', () => {
    expect(r.model).toBe('base');
  });

  it('coincide con los valores publicados redondeados a 3 decimales', () => {
    expect(Math.round(r.tenYear.totalCvd * 1000) / 1000).toBe(0.147);
    expect(Math.round(r.tenYear.ascvd * 1000) / 1000).toBe(0.092);
    expect(Math.round(r.thirtyYear.totalCvd * 1000) / 1000).toBe(0.53);
    expect(Math.round(r.thirtyYear.ascvd * 1000) / 1000).toBe(0.354);
  });

  it('coincide con alta precisión', () => {
    expect(r.tenYear.totalCvd).toBeCloseTo(0.146829, 4);
    expect(r.tenYear.ascvd).toBeCloseTo(0.091943, 4);
    expect(r.thirtyYear.totalCvd).toBeCloseTo(0.529829, 4);
    expect(r.thirtyYear.ascvd).toBeCloseTo(0.354232, 4);
  });

  it('categoriza el ASCVD 9,2% como intermedio (banda ASCVD 7,5–19,9%)', () => {
    expect(r.category).toBe('intermediate');
  });
  it('banda alternativa: ASCVD 9,2% → moderado (7,5–10%)', () => {
    expect(r.categoryAlt).toBe('moderate');
  });
});

describe('computePrevent — caso masculino (base)', () => {
  const r = computePrevent({
    age: 60, sex: 'male', systolicBP: 140, bpTreated: false,
    totalCholesterol: 220, hdl: 40, statin: false, diabetes: false,
    smoking: true, egfr: 75, bmi: 28,
  });
  it('ECV total y ASCVD a 10 y 30 años', () => {
    expect(r.tenYear.totalCvd).toBeCloseTo(0.123112, 4);
    expect(r.tenYear.ascvd).toBeCloseTo(0.08517, 4);
    expect(r.thirtyYear.totalCvd).toBeCloseTo(0.383035, 4);
    expect(r.thirtyYear.ascvd).toBeCloseTo(0.268199, 4);
  });
});

describe('computePrevent — modelo CKM con HbA1c (mujer, DM)', () => {
  const r = computePrevent({
    age: 55, sex: 'female', systolicBP: 135, bpTreated: true,
    totalCholesterol: 190, hdl: 50, statin: true, diabetes: true,
    smoking: false, egfr: 80, bmi: 32, hba1c: 8.0,
  });
  it('selecciona el modelo hba1c', () => {
    expect(r.model).toBe('hba1c');
  });
  it('coincide con los valores golden', () => {
    expect(r.tenYear.totalCvd).toBeCloseTo(0.106558, 4);
    expect(r.tenYear.ascvd).toBeCloseTo(0.064457, 4);
    expect(r.thirtyYear.totalCvd).toBeCloseTo(0.419487, 4);
    expect(r.thirtyYear.ascvd).toBeCloseTo(0.256929, 4);
  });
});

describe('computePrevent — modelo CKM con UACR (hombre)', () => {
  const r = computePrevent({
    age: 65, sex: 'male', systolicBP: 150, bpTreated: true,
    totalCholesterol: 180, hdl: 42, statin: true, diabetes: true,
    smoking: false, egfr: 55, bmi: 27, uacr: 30.0,
  });
  it('selecciona el modelo uacr', () => {
    expect(r.model).toBe('uacr');
  });
  it('coincide con los valores golden', () => {
    expect(r.tenYear.totalCvd).toBeCloseTo(0.236901, 4);
    expect(r.tenYear.ascvd).toBeCloseTo(0.149945, 4);
    expect(r.thirtyYear.totalCvd).toBeCloseTo(0.49935, 4);
    expect(r.thirtyYear.ascvd).toBeCloseTo(0.339497, 4);
  });
});

describe('preventCategory — banda ASCVD estándar (primaria)', () => {
  it('bajo <5', () => expect(preventCategory(4.9)).toBe('low'));
  it('límite 5–7,4', () => {
    expect(preventCategory(5)).toBe('borderline');
    expect(preventCategory(7.4)).toBe('borderline');
  });
  it('intermedio 7,5–19,9', () => {
    expect(preventCategory(7.5)).toBe('intermediate');
    expect(preventCategory(19.9)).toBe('intermediate');
  });
  it('alto ≥20', () => expect(preventCategory(20)).toBe('high'));
});

describe('preventCategoryAlt — banda alternativa (>10 = alto)', () => {
  it('bajo <5', () => expect(preventCategoryAlt(4.9)).toBe('low'));
  it('intermedio 5–7,5', () => expect(preventCategoryAlt(7.4)).toBe('intermediate'));
  it('moderado 7,5–10', () => {
    expect(preventCategoryAlt(7.5)).toBe('moderate');
    expect(preventCategoryAlt(10)).toBe('moderate');
  });
  it('alto >10', () => expect(preventCategoryAlt(10.1)).toBe('high'));
});

describe('computePrevent — validación de rango etario', () => {
  it('rechaza edad < 30', () => {
    expect(() => computePrevent({ ...readmeCase, age: 29 })).toThrow();
  });
  it('rechaza edad > 79', () => {
    expect(() => computePrevent({ ...readmeCase, age: 80 })).toThrow();
  });
});

describe('buildPreventRiskAssessment', () => {
  const result = computePrevent(readmeCase);
  const ra = buildPreventRiskAssessment(result, { reference: 'Patient/123' }, [
    { reference: 'Observation/chol-1' },
  ]);

  it('es un RiskAssessment con method PREVENT-AHA-2023', () => {
    expect(ra.resourceType).toBe('RiskAssessment');
    expect(ra.method?.coding?.[0]?.code).toBe('PREVENT-AHA-2023');
    expect(ra.subject.reference).toBe('Patient/123');
  });

  it('incluye 4 predicciones; la 1ª es ASCVD 10a con la categoría', () => {
    expect(ra.prediction).toHaveLength(4);
    expect(ra.prediction?.[0]?.outcome?.text).toContain('ASCVD a 10');
    expect(ra.prediction?.[0]?.probabilityDecimal).toBe(9.2);
    expect(ra.prediction?.[0]?.qualitativeRisk?.text).toContain('Intermedio');
  });

  it('propaga el basis para trazabilidad', () => {
    expect(ra.basis?.[0]?.reference).toBe('Observation/chol-1');
  });
});
