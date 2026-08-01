// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * Consistencia entre el catálogo de mediciones del front del paciente y el
 * diccionario de datos del backend.
 *
 * Es un acoplamiento invisible y silencioso: si el front grafica un LOINC que
 * el backend no escribe, la trayectoria aparece **vacía** — sin error, sin
 * warning, sin nada. El paciente ve un gráfico en blanco y nadie se entera.
 *
 * Este test lo hace ruidoso. Lee el catálogo del overlay como texto (no se
 * importa: vive fuera de `src/` y pertenece a otra app) y verifica que cada
 * código exista en `OBSERVATION_CODES`.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { OBSERVATION_CODES } from './data-dictionary';

const CATALOG = 'apps/programas/overlay/src/pages/health-record/Measurement.data.ts';

/**
 * Códigos LOINC declarados en el catálogo del front.
 *
 * Se parte por los marcadores `id: '<slug>'`: cada entrada va desde su `id`
 * hasta el `id` siguiente, así los códigos no se mezclan entre entradas.
 */
function frontCatalogCodes(): { id: string; codes: string[] }[] {
  const src = readFileSync(CATALOG, 'utf-8');
  const marks = [...src.matchAll(/^\s*id: '([^']+)',$/gm)];
  return marks.map((mark, i) => {
    const from = mark.index!;
    const to = i + 1 < marks.length ? marks[i + 1].index! : src.length;
    const block = src.slice(from, to);
    const codes = [...block.matchAll(/code: '([0-9]{3,5}-[0-9])'/g)].map((m) => m[1]);
    return { id: mark[1], codes: [...new Set(codes)] };
  });
}

/** Todos los códigos que el backend sabe escribir. */
const BACKEND_CODES = new Set<string>(Object.values(OBSERVATION_CODES).map((c) => c.code));

describe('El catálogo del front del paciente existe', () => {
  it('el overlay está en el repo', () => {
    expect(existsSync(CATALOG)).toBe(true);
  });
});

describe('Cada medición del front tiene un código que el backend escribe', () => {
  const entries = frontCatalogCodes();

  it('se parsearon las entradas del catálogo', () => {
    expect(entries.length).toBeGreaterThanOrEqual(9);
  });

  it('las mediciones cardio-oncológicas están presentes', () => {
    const ids = entries.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(['fevi', 'nt-probnp', 'troponina']));
  });

  it.each(['fevi', 'nt-probnp', 'troponina', 'presion-arterial', 'peso', 'frecuencia-cardiaca'])(
    '«%s» usa códigos que el diccionario del backend conoce',
    (id) => {
      const entry = frontCatalogCodes().find((e) => e.id === id)!;
      expect(entry, `falta la entrada ${id} en el catálogo del front`).toBeDefined();
      const desconocidos = entry.codes.filter((c) => !BACKEND_CODES.has(c));
      expect(desconocidos, `${id}: el backend nunca escribe estos códigos`).toEqual([]);
    }
  );

  it('FEVI usa el mismo LOINC que el migrador y el motor de scores', () => {
    const fevi = frontCatalogCodes().find((e) => e.id === 'fevi')!;
    expect(fevi.codes).toContain(OBSERVATION_CODES.lvef.code);
  });

  it('la presión arterial grafica las series que el check-in captura', () => {
    const pa = frontCatalogCodes().find((e) => e.id === 'presion-arterial')!;
    expect(pa.codes).toEqual(
      expect.arrayContaining([OBSERVATION_CODES.systolicBP.code, OBSERVATION_CODES.diastolicBP.code])
    );
  });
});

describe('Lo que el paciente carga en el check-in es graficable', () => {
  // Códigos del cuestionario de check-in que representan una serie temporal.
  const CHECKIN_SERIES = [
    OBSERVATION_CODES.weight.code,
    OBSERVATION_CODES.systolicBP.code,
    OBSERVATION_CODES.diastolicBP.code,
    OBSERVATION_CODES.heartRate.code,
  ];

  it('todo lo que se captura tiene dónde verse', () => {
    const enCatalogo = new Set(frontCatalogCodes().flatMap((e) => e.codes));
    const sinGrafico = CHECKIN_SERIES.filter((c) => !enCatalogo.has(c));
    expect(sinGrafico, 'el paciente carga estos valores pero no puede verlos').toEqual([]);
  });
});
