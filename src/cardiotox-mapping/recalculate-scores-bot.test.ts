// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * Tests del bot de recálculo — lógica pura de orquestación.
 *
 * Se testea `buildScoresForInputs` directamente (sin Medplum): decide qué
 * scores calcular según los datos disponibles y el rango etario. El wrapper
 * `handler` (I/O: buscar Observations → llamar esta función → upsert) es fino.
 */
import type { RiskAssessment } from '@medplum/fhirtypes';
import { describe, expect, it } from 'vitest';
import { buildScoresForInputs } from './recalculate-scores-bot';
import type { RawInputs } from './recalculate-scores-bot';

const subject: RiskAssessment['subject'] = { reference: 'Patient/123' };

const full: RawInputs = {
  age: 60, sex: 'male', totalChol: 193, hdl: 45, sbp: 140,
  egfr: 90, bmi: 27, diabetes: false, smoking: false,
};

function methods(ras: RiskAssessment[]): string[] {
  return ras.map((r) => r.method?.coding?.[0]?.code ?? '?').sort();
}

describe('buildScoresForInputs', () => {
  it('con datos completos calcula los 4 scores de riesgo CV', () => {
    expect(methods(buildScoresForInputs(full, subject))).toEqual([
      'ESC-SCORE2', 'FRAMINGHAM', 'GLOBORISK', 'PREVENT-AHA-2023',
    ]);
  });

  it('sin eGFR ni IMC: omite PREVENT, mantiene Framingham/SCORE2/Globorisk', () => {
    const { egfr: _e, bmi: _b, ...noEgfr } = full;
    expect(methods(buildScoresForInputs(noEgfr as RawInputs, subject))).toEqual([
      'ESC-SCORE2', 'FRAMINGHAM', 'GLOBORISK',
    ]);
  });

  it('sin HDL: solo Globorisk (no requiere HDL)', () => {
    const { hdl: _h, egfr: _e, bmi: _b, ...noHdl } = full;
    expect(methods(buildScoresForInputs(noHdl as RawInputs, subject))).toEqual(['GLOBORISK']);
  });

  it('sin colesterol: ningún score', () => {
    const { totalChol: _c, ...noChol } = full;
    expect(buildScoresForInputs(noChol as RawInputs, subject)).toHaveLength(0);
  });

  it('sin edad: ningún score', () => {
    expect(buildScoresForInputs({ ...full, age: undefined }, subject)).toHaveLength(0);
  });

  it('edad 82 (fuera de rango de PREVENT/Framingham/Globorisk): solo SCORE2-OP', () => {
    const ras = buildScoresForInputs({ ...full, age: 82 }, subject);
    expect(methods(ras)).toEqual(['ESC-SCORE2']);
  });

  it('propaga el basis de trazabilidad a los RiskAssessment', () => {
    const basis = [{ reference: 'Observation/chol-1' }];
    const ras = buildScoresForInputs(full, subject, basis);
    expect(ras.every((r) => r.basis?.[0]?.reference === 'Observation/chol-1')).toBe(true);
  });
});

describe('Sin sexo registrado no se calcula ningún score', () => {
  // Los 25 pacientes que entran con --include-orphans llegan sólo con DNI:
  // sin sexo. Todas las ecuaciones son sexo-específicas, así que asumir uno
  // produce un riesgo plausible e inventado.
  const inputsCompletos = {
    age: 60,
    totalChol: 200, hdl: 50, sbp: 130, egfr: 90, bmi: 27,
    smoking: false, diabetes: false, antihypertensiveTx: false, statinTx: false,
  };

  it('con sexo se calculan scores', () => {
    const out = buildScoresForInputs({ ...inputsCompletos, sex: 'female' }, { reference: 'Patient/1' });
    expect(out.length).toBeGreaterThan(0);
  });

  it('sin sexo NO se calcula ninguno (no se asume varón)', () => {
    const out = buildScoresForInputs({ ...inputsCompletos, sex: undefined }, { reference: 'Patient/1' });
    expect(out).toEqual([]);
  });

  it('sin edad tampoco', () => {
    const out = buildScoresForInputs({ ...inputsCompletos, age: undefined, sex: 'female' }, { reference: 'Patient/1' });
    expect(out).toEqual([]);
  });
});
