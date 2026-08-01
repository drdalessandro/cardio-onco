// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * Tests de la capa de investigación.
 *
 * Acá un error no rompe una pantalla: produce un número plausible y equivocado
 * que termina en una conclusión clínica. Por eso se testea la estadística
 * contra valores calculados a mano y la detección de caída de FEVI contra
 * trayectorias construidas a propósito.
 */
import { describe, expect, it } from 'vitest';
import {
  advertenciasDe, birthdateForAge, buildCohortQueries, CTRCD_DEFAULT,
  describir, detectarCaidaFevi, percentil,
} from './cohort';

const REF = new Date('2026-08-01T00:00:00Z');

describe('buildCohortQueries — criterios a búsquedas FHIR', () => {
  it('sin criterios no genera consultas', () => {
    expect(buildCohortQueries({})).toEqual([]);
  });

  it('sexo y edad van en una sola búsqueda de Patient', () => {
    const q = buildCohortQueries({ sexo: 'female', edadMin: 60 }, REF);
    expect(q).toHaveLength(1);
    expect(q[0].resourceType).toBe('Patient');
    expect(q[0].params.gender).toBe('female');
    // 60 años o más ⇒ nacido en 1966-08-01 o antes
    expect(q[0].params.birthdate).toBe('le1966-08-01');
  });

  it('el rango de edad se traduce correctamente (mayor edad = nacido antes)', () => {
    const q = buildCohortQueries({ edadMin: 50, edadMax: 70 }, REF);
    const p = q[0].params;
    expect(p.birthdate).toBe('le1976-08-01'); // ≥50 años
    expect(p['birthdate:above']).toBe('ge1955-08-01'); // ≤70 años
  });

  it('diagnósticos y fármacos son consultas separadas (FHIR search no hace joins)', () => {
    const q = buildCohortQueries({ diagnosticos: ['I50.22'], farmacos: ['L01DB'] });
    expect(q.map((x) => x.resourceType)).toEqual(['Condition', 'MedicationStatement']);
  });

  it('el filtro por medición usa value-quantity con comparador', () => {
    const q = buildCohortQueries({ medicion: { code: '8806-2', op: 'lt', valor: 50 } });
    expect(q[0].params).toMatchObject({ code: '8806-2', 'value-quantity': 'lt50' });
  });

  it('toda consulta declara para qué sirve (se le muestra al investigador)', () => {
    const q = buildCohortQueries({ sexo: 'male', diagnosticos: ['I10'], farmacos: ['C07'] });
    expect(q.every((x) => x.proposito.length > 0)).toBe(true);
  });
});

describe('percentil — método R-7 (el de quantile() en R)', () => {
  const xs = [1, 2, 3, 4, 5];
  it('mediana', () => expect(percentil(xs, 0.5)).toBe(3));
  it('p25 y p75 interpolan', () => {
    expect(percentil(xs, 0.25)).toBe(2);
    expect(percentil(xs, 0.75)).toBe(4);
  });
  it('interpola entre valores cuando hace falta', () => {
    // [1,2,3,4] → p50 = 2.5
    expect(percentil([1, 2, 3, 4], 0.5)).toBe(2.5);
  });
  it('un solo valor', () => expect(percentil([7], 0.5)).toBe(7));
  it('lista vacía → NaN', () => expect(percentil([], 0.5)).toBeNaN());
});

describe('describir — estadística descriptiva', () => {
  it('valores calculados a mano', () => {
    // [2,4,4,4,5,5,7,9] → media 5, desvío muestral ≈ 2.138
    const d = describir([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(d.n).toBe(8);
    expect(d.media).toBe(5);
    expect(d.mediana).toBe(4.5);
    expect(d.min).toBe(2);
    expect(d.max).toBe(9);
    expect(d.desvio).toBeCloseTo(2.138, 3);
  });

  it('usa desvío MUESTRAL (n−1), no poblacional', () => {
    // [1,2,3,4,5]: muestral = 1.5811, poblacional = 1.4142
    expect(describir([1, 2, 3, 4, 5]).desvio).toBeCloseTo(1.5811, 4);
  });

  it('descarta no-numéricos en vez de propagarlos', () => {
    expect(describir([1, 2, NaN, 3]).n).toBe(3);
  });

  it('lista vacía no rompe', () => {
    const d = describir([]);
    expect(d.n).toBe(0);
    expect(d.media).toBeNaN();
  });

  it('n=1 no inventa dispersión', () => {
    expect(describir([42]).desvio).toBe(0);
  });
});

describe('detectarCaidaFevi — trayectoria de FEVI', () => {
  it('caso testigo: 60 → 52 → 45 cumple criterio ESC (≥10 puntos y <50)', () => {
    const r = detectarCaidaFevi([
      { fecha: '2024-03', valor: 60 },
      { fecha: '2024-09', valor: 52 },
      { fecha: '2025-03', valor: 45 },
    ])!;
    expect(r.basal.valor).toBe(60);
    expect(r.nadir.valor).toBe(45);
    expect(r.caidaAbsoluta).toBe(15);
    expect(r.caidaRelativa).toBeCloseTo(0.25, 4);
    expect(r.cumpleCriterio).toBe(true);
  });

  it('caída grande pero FEVI final normal NO cumple', () => {
    // 75 → 60: caen 15 puntos pero 60% sigue siendo normal
    const r = detectarCaidaFevi([
      { fecha: '2024-01', valor: 75 },
      { fecha: '2024-06', valor: 60 },
    ])!;
    expect(r.caidaAbsoluta).toBe(15);
    expect(r.cumpleCriterio).toBe(false);
  });

  it('FEVI baja pero sin caída suficiente NO cumple', () => {
    // 52 → 47: termina <50 pero sólo cayó 5 puntos
    const r = detectarCaidaFevi([
      { fecha: '2024-01', valor: 52 },
      { fecha: '2024-06', valor: 47 },
    ])!;
    expect(r.cumpleCriterio).toBe(false);
  });

  it('el nadir es el mínimo POSTERIOR, aunque después recupere', () => {
    const r = detectarCaidaFevi([
      { fecha: '2024-01', valor: 62 },
      { fecha: '2024-06', valor: 44 },
      { fecha: '2024-12', valor: 58 },
    ])!;
    expect(r.nadir.valor).toBe(44);
    expect(r.nadir.fecha).toBe('2024-06');
    expect(r.cumpleCriterio).toBe(true);
  });

  it('ordena por fecha aunque la serie venga desordenada', () => {
    const r = detectarCaidaFevi([
      { fecha: '2025-03', valor: 45 },
      { fecha: '2024-03', valor: 60 },
    ])!;
    expect(r.basal.valor).toBe(60);
  });

  it('una sola medición no es una trayectoria', () => {
    expect(detectarCaidaFevi([{ fecha: '2024-03', valor: 60 }])).toBeUndefined();
  });

  it('los umbrales son parámetros, no constantes', () => {
    const serie = [
      { fecha: '2024-01', valor: 58 },
      { fecha: '2024-06', valor: 51 },
    ];
    expect(detectarCaidaFevi(serie)!.cumpleCriterio).toBe(false);
    // Criterio más laxo elegido explícitamente por el investigador
    expect(detectarCaidaFevi(serie, { caidaAbsolutaMin: 5, feviFinalMax: 55 })!.cumpleCriterio).toBe(true);
  });

  it('los defaults son los de ESC 2022', () => {
    expect(CTRCD_DEFAULT).toEqual({ caidaAbsolutaMin: 10, feviFinalMax: 50 });
  });
});

describe('advertenciasDe — el agente no puede presentar cualquier n con la misma seguridad', () => {
  it('n=0 se aclara que es vacío, no hallazgo negativo', () => {
    expect(advertenciasDe(0)[0]).toContain('no es un hallazgo negativo');
  });
  it('n<5 advierte reidentificación', () => {
    expect(advertenciasDe(3).join(' ')).toContain('reidentificación');
  });
  it('n<30 advierte muestra chica', () => {
    expect(advertenciasDe(12).join(' ')).toContain('muestra chica');
  });
  it('n grande no genera ruido', () => {
    expect(advertenciasDe(200)).toEqual([]);
  });
  it('poca cobertura del dato se marca como faltante, no como normal', () => {
    expect(advertenciasDe(40, 300).join(' ')).toContain('dato faltante');
  });
});

describe('birthdateForAge', () => {
  it('resta la edad a la fecha de referencia', () => {
    expect(birthdateForAge(56, REF)).toBe('1970-08-01');
  });
});

describe('MEDIDAS_DISPONIBLES — el esquema que ve el agente', () => {
  it('expone el diccionario del backend, no una lista aparte', async () => {
    const { MEDIDAS_DISPONIBLES } = await import('./cohort');
    const { OBSERVATION_CODES } = await import('../cardiotox-mapping/data-dictionary');
    expect(MEDIDAS_DISPONIBLES).toHaveLength(Object.keys(OBSERVATION_CODES).length);
  });

  it('incluye FEVI con su código y unidad (lo que el agente necesita para no adivinar)', async () => {
    const { MEDIDAS_DISPONIBLES } = await import('./cohort');
    const fevi = MEDIDAS_DISPONIBLES.find((m) => m.clave === 'lvef')!;
    expect(fevi).toMatchObject({ code: '8806-2', unit: '%' });
  });

  it('toda medida declara código y display', async () => {
    const { MEDIDAS_DISPONIBLES } = await import('./cohort');
    const incompletas = MEDIDAS_DISPONIBLES.filter((m) => !m.code || !m.display);
    expect(incompletas).toEqual([]);
  });
});
