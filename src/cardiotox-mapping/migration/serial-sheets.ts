// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * EPA Bienestar IA — Cardio-Oncología Marie Curie
 * Migrador: hojas **seriadas** (Ecocardiogramas_control, Estudios_
 * Complementarios, QT_cardiotox) → `Observation` fechadas.
 *
 * Estas hojas repiten el mismo juego de mediciones en **bloques**: un bloque
 * basal y luego N bloques de control, cada uno precedido por su columna de
 * fecha (`Fecha eco control`, `Fecha`, …). En vez de codificar a mano los
 * nombres de las ~7 repeticiones, el parser detecta los bloques por posición:
 *
 *   [ …basal… ] [Fecha eco control] [ …control 1… ] [Fecha eco control 2] [ …control 2… ]
 *
 * Cada columna del bloque se resuelve contra un **catálogo de mediciones** por
 * alias normalizado (se ignoran acentos, mayúsculas y sufijos numéricos), de
 * modo que `FEY`, `FEY 2` y `FEY control 3` caen todas en LOINC 8806-2 y sólo
 * cambia la fecha. Así la serie temporal queda nativa en FHIR: **una
 * `Observation` por medición y por fecha**.
 *
 * Las columnas que no matchean NO se inventan: se reportan en `ignored` para
 * revisarlas contra el export real y agregar el alias que falte.
 */

import type { BundleEntry, Patient, Reference } from '@medplum/fhirtypes';
import { LOCAL_OBSERVATION_CODES, OBSERVATION_CODES } from '../data-dictionary';
import type { Measure } from './entry-builders';
import { loincMeasure, localMeasure, measureObsEntry } from './entry-builders';
import { num, partialDate, slug } from './parsers';

/** Encabezado que abre un bloque nuevo (columna de fecha). */
const DATE_HEADER = /fecha/i;

/** Columnas de unión entre hojas — no son mediciones. */
const JOIN_KEYS = new Set(['dni', 'nombre', 'apellido']);

/**
 * Normaliza un encabezado a su alias de catálogo: saca acentos/símbolos, el
 * sufijo numérico de repetición y las palabras de posición (`control`,
 * `basal`, `inicial`, `seguimiento`).
 */
export function measureAlias(header: string): string {
  return slug(header)
    .replace(/-?\d+$/, '')
    .replace(/-?(control|basal|inicial|seguimiento)-?/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Catálogo: alias normalizado → medición codificada. */
export type MeasureCatalog = Record<string, Measure>;

function catalog(pairs: Array<[string[], Measure]>): MeasureCatalog {
  const out: MeasureCatalog = {};
  for (const [aliases, m] of pairs) {
    for (const a of aliases) {
      out[measureAlias(a)] = m;
    }
  }
  return out;
}

const O = OBSERVATION_CODES;
const L = LOCAL_OBSERVATION_CODES;

/** Ecocardiograma — categoría `imaging` (docs §4). */
export const ECHO_CATALOG: MeasureCatalog = catalog([
  [['FEY', 'FEVI'], loincMeasure(O.lvef, 'imaging')],
  [['IMVI'], loincMeasure(O.lvMassIndex, 'imaging')],
  [['PSAP'], loincMeasure(O.pasp, 'imaging')],
  [['Vol AI'], loincMeasure(O.laVolume, 'imaging')],
  [['MAPSE'], localMeasure(L.mapse, 'imaging')],
  [['EPR'], localMeasure(L.relativeWallThickness, 'imaging')],
  [['area AI'], localMeasure(L.leftAtrialArea, 'imaging')],
  [['Vel IT'], localMeasure(L.tricuspidRegurgVelocity, 'imaging')],
  [['É', "e'", 'E prima'], localMeasure(L.ePrime, 'imaging')],
  [['E/É', "E/e'"], localMeasure(L.eOverEPrime, 'imaging')],
  [['S Lat', 'S lateral'], localMeasure(L.sLateral, 'imaging')],
]);

/** ECG — categoría `procedure` (docs §5). */
export const ECG_CATALOG: MeasureCatalog = catalog([
  [['PR (mseg)', 'PR'], loincMeasure(O.prInterval, 'procedure')],
  [['QRS'], loincMeasure(O.qrsDuration, 'procedure')],
  [['QT (mseg)', 'QT'], loincMeasure(O.qtInterval, 'procedure')],
  [['QTc'], loincMeasure(O.qtcInterval, 'procedure')],
  [['FC'], loincMeasure(O.heartRate, 'vital-signs')],
]);

/** QT_cardiotox mezcla ECG (foco QT) con un 2º bloque de eco. */
export const QT_CATALOG: MeasureCatalog = { ...ECG_CATALOG, ...ECHO_CATALOG };

/** Un bloque de mediciones y la fecha que lo encabeza. */
export interface Block {
  index: number;
  /** `undefined` en el bloque basal (no tiene columna de fecha propia). */
  date?: string;
  columns: string[];
}

/**
 * Parte los encabezados en bloques usando las columnas de fecha como separador.
 * El bloque 0 son las columnas previas a la 1ª fecha (basal).
 */
export function splitBlocks(headers: string[], row: Record<string, string>): Block[] {
  const blocks: Block[] = [];
  let current: Block = { index: 0, columns: [] };
  for (const h of headers) {
    if (DATE_HEADER.test(h)) {
      blocks.push(current);
      current = { index: blocks.length, date: partialDate(row[h]), columns: [] };
    } else {
      current.columns.push(h);
    }
  }
  blocks.push(current);
  return blocks;
}

export interface SerialMapResult {
  entries: BundleEntry[];
  /** Encabezados resueltos contra el catálogo. */
  matched: string[];
  /** Encabezados con dato numérico que NO matchearon (revisar alias). */
  ignored: string[];
  warnings: string[];
}

/**
 * Mapea una fila de hoja seriada a `Observation` fechadas.
 *
 * @param row - Fila {encabezado: valor}.
 * @param cat - Catálogo de mediciones de la hoja (ECHO/ECG/QT).
 * @param dni - DNI ya validado (la fila se une al Patient por este valor).
 * @param fallbackDate - Fecha del bloque basal (típicamente `Inicio seguimiento`
 *   de la spine), para no perder el basal cuando la hoja no trae su fecha.
 */
export function mapSerialRow(
  row: Record<string, string>,
  cat: MeasureCatalog,
  dni: string,
  subject: Reference<Patient>,
  fallbackDate?: string
): SerialMapResult {
  const entries: BundleEntry[] = [];
  const matched: string[] = [];
  const ignored: string[] = [];
  const warnings: string[] = [];

  for (const block of splitBlocks(Object.keys(row), row)) {
    const date = block.index === 0 ? fallbackDate : block.date;
    let valuesInBlock = 0;

    for (const col of block.columns) {
      if (JOIN_KEYS.has(measureAlias(col))) continue; // la clave de join no es una medición
      const value = num(row[col]);
      if (value === undefined) continue;
      valuesInBlock++;
      const measure = cat[measureAlias(col)];
      if (!measure) {
        ignored.push(col);
        continue;
      }
      matched.push(col);
      // Sin fecha, el índice de bloque desambigua para no pisar recursos.
      const suffix = date ? undefined : `b${block.index}`;
      entries.push(measureObsEntry(subject, dni, measure, value, date, suffix));
    }

    if (valuesInBlock > 0 && !date) {
      warnings.push(
        `DNI ${dni}: bloque ${block.index} tiene mediciones pero no fecha — se guardan sin \`effectiveDateTime\``
      );
    }
  }

  return { entries, matched, ignored, warnings };
}
