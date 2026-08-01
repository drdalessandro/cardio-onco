// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * EPA Bienestar IA — Cardio-Oncología Marie Curie
 * Capa de investigación: cohortes, series y estadística descriptiva.
 *
 * Módulo **puro** (sin Medplum ni red): traduce criterios de investigación a
 * búsquedas FHIR y resume resultados. Que sea puro es lo que permite testear la
 * lógica de cohortes sin servidor — y es la pieza que el agente LLM usa a
 * través de herramientas acotadas, nunca escribiendo queries a mano.
 *
 * Regla de diseño: **el agente elige herramienta y parámetros; no redacta la
 * consulta.** Cada resultado viaja con la búsqueda FHIR exacta que lo produjo
 * (`ProvenancedResult.query`), para que un investigador pueda reproducirlo. Un
 * hallazgo que no se puede reproducir no se puede publicar.
 */

import { OBSERVATION_CODES } from '../cardiotox-mapping/data-dictionary';

/** Comparadores de FHIR search para valores numéricos. */
export type NumericOp = 'eq' | 'lt' | 'le' | 'gt' | 'ge';

/** Criterios de una cohorte. Todo opcional; se combinan con AND. */
export interface CohortCriteria {
  /** Sexo administrativo del paciente. */
  sexo?: 'male' | 'female' | 'other' | 'unknown';
  /** Edad en años (se traduce a rango de `birthdate`). */
  edadMin?: number;
  edadMax?: number;
  /** Códigos ICD-10 de diagnóstico (Condition). Se combinan con OR. */
  diagnosticos?: string[];
  /** Códigos ATC de familia farmacológica (MedicationStatement). OR. */
  farmacos?: string[];
  /** Filtro por valor de una medición: p. ej. FEVI < 50. */
  medicion?: { code: string; op: NumericOp; valor: number };
  /** Rango de fechas del seguimiento (aplica a la medición si hay). */
  desde?: string;
  hasta?: string;
}

/** Una consulta FHIR lista para ejecutar, con su propósito declarado. */
export interface FhirQuery {
  resourceType: string;
  params: Record<string, string>;
  /** Para qué sirve — se muestra al investigador junto al resultado. */
  proposito: string;
}

/** Resultado con su procedencia: sin esto no es reproducible. */
export interface ProvenancedResult<T> {
  data: T;
  /** Las consultas exactas que produjeron el resultado. */
  query: FhirQuery[];
  /** Advertencias metodológicas (n chico, datos faltantes…). */
  advertencias: string[];
}

/** `birthdate` correspondiente a una edad, respecto de una fecha de referencia. */
export function birthdateForAge(age: number, ref = new Date()): string {
  const d = new Date(ref);
  d.setFullYear(d.getFullYear() - age);
  return d.toISOString().slice(0, 10);
}

/**
 * Traduce criterios de cohorte a consultas FHIR.
 *
 * FHIR search **no hace joins**: no se puede pedir "pacientes con diagnóstico X
 * y droga Y" en una sola consulta. Se emite una consulta por criterio y la
 * intersección se resuelve sobre los ids — por eso la función devuelve un
 * arreglo y el evaluador las cruza.
 */
export function buildCohortQueries(criteria: CohortCriteria, ref = new Date()): FhirQuery[] {
  const queries: FhirQuery[] = [];

  // Criterios demográficos → una sola búsqueda de Patient.
  const patientParams: Record<string, string> = {};
  if (criteria.sexo) {
    patientParams.gender = criteria.sexo;
  }
  if (criteria.edadMin !== undefined) {
    // Mayor edad ⇒ nacido ANTES.
    patientParams.birthdate = `le${birthdateForAge(criteria.edadMin, ref)}`;
  }
  if (criteria.edadMax !== undefined) {
    const key = patientParams.birthdate ? 'birthdate:above' : 'birthdate';
    patientParams[key] = `ge${birthdateForAge(criteria.edadMax + 1, ref)}`;
  }
  if (Object.keys(patientParams).length > 0) {
    queries.push({
      resourceType: 'Patient',
      params: { ...patientParams, _count: '1000', _elements: 'id,gender,birthDate' },
      proposito: 'Pacientes que cumplen los criterios demográficos',
    });
  }

  if (criteria.diagnosticos?.length) {
    queries.push({
      resourceType: 'Condition',
      params: { code: criteria.diagnosticos.join(','), _count: '1000', _elements: 'id,subject,code' },
      proposito: `Diagnóstico en [${criteria.diagnosticos.join(', ')}]`,
    });
  }

  if (criteria.farmacos?.length) {
    queries.push({
      resourceType: 'MedicationStatement',
      params: { code: criteria.farmacos.join(','), _count: '1000', _elements: 'id,subject,medicationCodeableConcept' },
      proposito: `Tratamiento con [${criteria.farmacos.join(', ')}]`,
    });
  }

  if (criteria.medicion) {
    const { code, op, valor } = criteria.medicion;
    const params: Record<string, string> = {
      code,
      'value-quantity': `${op}${valor}`,
      _count: '1000',
      _elements: 'id,subject,code,valueQuantity,effectiveDateTime',
    };
    if (criteria.desde) {
      params.date = `ge${criteria.desde}`;
    }
    if (criteria.hasta) {
      params['date:below'] = `le${criteria.hasta}`;
    }
    queries.push({
      resourceType: 'Observation',
      params,
      proposito: `Medición ${code} ${op} ${valor}`,
    });
  }

  return queries;
}

/** Un punto de una serie temporal. */
export interface SeriesPoint {
  fecha: string;
  valor: number;
}

/** Estadística descriptiva de una distribución. */
export interface Descriptiva {
  n: number;
  media: number;
  mediana: number;
  p25: number;
  p75: number;
  min: number;
  max: number;
  desvio: number;
}

/** Percentil por interpolación lineal (método R-7, el de `quantile()` en R). */
export function percentil(ordenados: number[], p: number): number {
  if (ordenados.length === 0) {
    return NaN;
  }
  if (ordenados.length === 1) {
    return ordenados[0];
  }
  const h = (ordenados.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return ordenados[lo] + (h - lo) * (ordenados[hi] - ordenados[lo]);
}

/** Descriptiva de una lista de valores. */
export function describir(valores: number[]): Descriptiva {
  const xs = valores.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = xs.length;
  if (n === 0) {
    return { n: 0, media: NaN, mediana: NaN, p25: NaN, p75: NaN, min: NaN, max: NaN, desvio: NaN };
  }
  const media = xs.reduce((a, b) => a + b, 0) / n;
  // Desvío muestral (n−1); con n=1 no está definido.
  const desvio = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - media) ** 2, 0) / (n - 1)) : 0;
  return {
    n,
    media,
    mediana: percentil(xs, 0.5),
    p25: percentil(xs, 0.25),
    p75: percentil(xs, 0.75),
    min: xs[0],
    max: xs[n - 1],
    desvio,
  };
}

/**
 * Umbrales de caída de FEVI.
 *
 * Valores por defecto tomados de la definición de disfunción cardíaca asociada
 * al tratamiento oncológico (CTRCD) de la guía ESC 2022 de cardio-oncología:
 * caída ≥10 puntos absolutos hasta una FEVI <50%.
 *
 * ⚠️ Son **parámetros, no constantes**: la definición de CTRCD tiene variantes
 * (leve/moderada/grave, con y sin GLS y biomarcadores). El motor no decide por
 * el investigador — se declaran explícitamente en cada análisis.
 */
export const CTRCD_DEFAULT = {
  caidaAbsolutaMin: 10,
  feviFinalMax: 50,
} as const;

export interface CaidaFevi {
  basal: SeriesPoint;
  nadir: SeriesPoint;
  caidaAbsoluta: number;
  caidaRelativa: number;
  cumpleCriterio: boolean;
}

/**
 * Detecta caída de FEVI en una serie.
 *
 * Toma el **primer** valor como basal y el **mínimo posterior** como nadir. No
 * asume nada sobre el espaciado de los controles.
 *
 * @param serie - Puntos de FEVI, en cualquier orden (se ordenan por fecha).
 * @param umbral - Umbrales del criterio; por defecto los de ESC 2022.
 */
export function detectarCaidaFevi(
  serie: SeriesPoint[],
  umbral: { caidaAbsolutaMin: number; feviFinalMax: number } = CTRCD_DEFAULT
): CaidaFevi | undefined {
  const ordenada = [...serie].filter((p) => Number.isFinite(p.valor)).sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (ordenada.length < 2) {
    return undefined; // sin al menos dos mediciones no hay trayectoria
  }
  const basal = ordenada[0];
  const posteriores = ordenada.slice(1);
  const nadir = posteriores.reduce((min, p) => (p.valor < min.valor ? p : min), posteriores[0]);

  const caidaAbsoluta = basal.valor - nadir.valor;
  const caidaRelativa = basal.valor === 0 ? 0 : caidaAbsoluta / basal.valor;

  return {
    basal,
    nadir,
    caidaAbsoluta,
    caidaRelativa,
    cumpleCriterio: caidaAbsoluta >= umbral.caidaAbsolutaMin && nadir.valor < umbral.feviFinalMax,
  };
}

/**
 * Advertencias metodológicas automáticas.
 *
 * Un agente conversacional tiende a presentar cualquier número con la misma
 * seguridad. Estas advertencias viajan con el resultado para que un n de 4 no
 * se lea igual que un n de 400.
 */
export function advertenciasDe(n: number, totalCohorte?: number): string[] {
  const out: string[] = [];
  if (n === 0) {
    out.push('Ningún paciente cumple los criterios: el resultado está vacío, no es un hallazgo negativo.');
  } else if (n < 5) {
    out.push(
      `n = ${n}: por debajo de 5 los estadísticos no son interpretables y el riesgo de reidentificación es alto. No publicar celdas de este tamaño.`
    );
  } else if (n < 30) {
    out.push(`n = ${n}: muestra chica, los intervalos de confianza son amplios. Interpretar con cautela.`);
  }
  if (totalCohorte !== undefined && totalCohorte > 0) {
    const cobertura = n / totalCohorte;
    if (cobertura < 0.5) {
      out.push(
        `Sólo ${Math.round(cobertura * 100)}% de la cohorte tiene este dato registrado: el resto no es "normal", es dato faltante.`
      );
    }
  }
  return out;
}

/** Códigos que la capa de investigación sabe consultar (del diccionario). */
export const MEDIDAS_DISPONIBLES = Object.entries(OBSERVATION_CODES).map(([clave, c]) => ({
  clave,
  code: c.code,
  display: c.display,
  unit: (c as { unit?: string }).unit,
}));
