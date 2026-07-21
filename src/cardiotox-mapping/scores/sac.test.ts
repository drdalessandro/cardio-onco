// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * Tests de SAC-DVATC (riesgo de cardiotoxicidad, Consenso SAC).
 *
 * Caso testigo real: mujer en antraciclinas, sin otros factores → 1 pt paciente
 * (género femenino) + 2 pts tratamiento (default provisional) = 3 = Intermedio,
 * reproduciendo el "Riesgo INTERMEDIO" de la planilla.
 *
 * NB: los puntos de tratamiento son PROVISIONALES; los factores del paciente
 * (Tabla 2) y los umbrales sí son de fuente.
 */
import { describe, expect, it } from 'vitest';
import { computeSac, sacCategory, buildSacRiskAssessment } from './sac';

describe('computeSac — caso testigo (antraciclinas, mujer)', () => {
  const r = computeSac({ treatment: 'anthracycline', female: true });
  it('1 pt paciente + 2 pts tratamiento = 3 → Intermedio', () => {
    expect(r.patientPoints).toBe(1);
    expect(r.treatmentPoints).toBe(2);
    expect(r.total).toBe(3);
    expect(r.category).toBe('intermediate');
  });
  it('marca el resultado como provisional (default de tratamiento)', () => {
    expect(r.provisional).toBe(true);
  });
  it('lista el factor presente', () => {
    expect(r.factorsPresent).toContain('género femenino');
  });
});

describe('computeSac — aplicabilidad de factores por tratamiento (Tabla 2)', () => {
  it('género femenino cuenta en antraciclinas', () => {
    expect(computeSac({ treatment: 'anthracycline', female: true }).patientPoints).toBe(1);
  });
  it('género femenino NO cuenta en anti-HER2', () => {
    expect(computeSac({ treatment: 'anti-her2', female: true }).patientPoints).toBe(0);
  });
  it('IMC>30 cuenta en anti-HER2 pero no en antraciclinas', () => {
    expect(computeSac({ treatment: 'anti-her2', obesity: true }).patientPoints).toBe(1);
    expect(computeSac({ treatment: 'anthracycline', obesity: true }).patientPoints).toBe(0);
  });
  it('HTA cuenta en los tres tratamientos', () => {
    expect(computeSac({ treatment: 'anthracycline', hypertension: true }).patientPoints).toBe(1);
    expect(computeSac({ treatment: 'anti-her2', hypertension: true }).patientPoints).toBe(1);
    expect(computeSac({ treatment: 'anti-vegf', hypertension: true }).patientPoints).toBe(1);
  });
});

describe('computeSac — con puntos de tratamiento explícitos (no provisional)', () => {
  const r = computeSac({
    treatment: 'anthracycline',
    hypertension: true, coronaryDisease: true, previousDVATC: true,
    treatmentPoints: 3,
  });
  it('3 pts paciente + 3 pts tratamiento = 6 → Alto', () => {
    expect(r.patientPoints).toBe(3);
    expect(r.total).toBe(6);
    expect(r.category).toBe('high');
  });
  it('no marca provisional cuando se pasan los puntos', () => {
    expect(r.provisional).toBe(false);
  });
});

describe('sacCategory — umbrales del Consenso', () => {
  it('bajo <3', () => {
    expect(sacCategory(0)).toBe('low');
    expect(sacCategory(2)).toBe('low');
  });
  it('intermedio 3–4', () => {
    expect(sacCategory(3)).toBe('intermediate');
    expect(sacCategory(4)).toBe('intermediate');
  });
  it('alto 5–6', () => {
    expect(sacCategory(5)).toBe('high');
    expect(sacCategory(6)).toBe('high');
  });
  it('muy alto >6', () => expect(sacCategory(7)).toBe('very-high'));
});

describe('computeSac — clamp de puntos de tratamiento a 0–4', () => {
  it('nunca supera 4', () => {
    expect(computeSac({ treatment: 'anthracycline', treatmentPoints: 9 }).treatmentPoints).toBe(4);
  });
  it('nunca baja de 0', () => {
    expect(computeSac({ treatment: 'anthracycline', treatmentPoints: -2 }).treatmentPoints).toBe(0);
  });
});

describe('buildSacRiskAssessment', () => {
  const r = computeSac({ treatment: 'anthracycline', female: true });
  const ra = buildSacRiskAssessment(r, { reference: 'Patient/1' });
  it('method SAC-DVATC con categoría cualitativa', () => {
    expect(ra.method?.coding?.[0]?.code).toBe('SAC-DVATC');
    expect(ra.prediction?.[0]?.qualitativeRisk?.text).toBe('Intermedio');
  });
  it('marca la extensión risk-source como provisional', () => {
    expect(ra.extension?.[0]?.valueCode).toBe('computed-provisional');
  });
});
