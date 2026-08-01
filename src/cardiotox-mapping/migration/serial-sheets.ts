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

import type { BundleEntry, Coding, Condition, Observation, Patient, Reference } from '@medplum/fhirtypes';
import {
  ECG_CONDITIONS, ECG_OBSERVATIONS, ECHO_FINDINGS, LOCAL_OBSERVATION_CODES,
  OBSERVATION_CODES, SEVERITY_CODES, SYSTEMS, VALVE_LESIONS,
} from '../data-dictionary';
import type { FindingCode, SeverityKey } from '../data-dictionary';
import type { Measure } from './entry-builders';
import { MIG_SYS, OBS_CAT_SYS, loincMeasure, localMeasure, measureObsEntry, putEntry } from './entry-builders';
import { cellKind, isYes, num, partialDate, slug } from './parsers';

/** Encabezado que abre un bloque nuevo (columna de fecha). */
const DATE_HEADER = /fecha/i;

/**
 * Columnas de identidad / administrativas que se repiten en cada hoja: no son
 * mediciones y ya vienen de la spine. Se saltean para no ensuciar el reporte de
 * cobertura con falsos "sin mapear".
 */
const JOIN_KEYS = new Set([
  'dni', 'nombre', 'apellido', 'sexo', 'edad', 'telefono',
  'inicio', 'dia-en-estudio', 'n-de-px', 'estado-paciente', 'estado-seguimiento',
  'ultimo-control', 'proximo-control',
]);


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

/**
 * Columnas de la hoja QT que replican el snapshot de la spine (antropometría,
 * laboratorio, doppler vascular): ya se migran desde `Cardiotox` con el mismo
 * identifier, así que no son un hueco de mapeo y no se reportan como tal.
 */
const SPINE_COVERED = new Set(
  [
    'Peso (kg)', 'Peso minimo', 'Altura (m)', 'IMC', 'Peri abd (mts)', 'Peri Abd (cm)',
    'Indice cintura/altura', 'Cr', 'HB', 'Col T', 'HDL', 'LDL', 'Trig', 'LPa', 'HbA1c',
    'eritro', 'Glu', 'Clcr', 'Microalb', 'ECOG',
    'Carótidas ateromatosas', 'Femorales normales', 'Femorales ateromatosas', 'Total',
  ].map(measureAlias)
);

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

// ─── Columnas cualitativas ───────────────────────────────────────────────────
// No todo el eco/ECG es numérico. Tres formas distintas:
//   `Valvulopatia leve|moderada|severa` → el VALOR dice qué válvula (`IT IM`),
//        la COLUMNA dice la severidad  → una Condition por válvula con severity.
//   `Disf Diasto`, `Derrame pericardico`… → 0/1               → Condition si 1.
//   `RS`, `Trast rep`, `Q pat`…           → Sí/No             → Observation
//        booleana (el "No" es clínicamente informativo: RS=No ≠ dato ausente).

export type QualitativeKind = 'valve' | 'condition' | 'observation';

export interface QualitativeCol {
  kind: QualitativeKind;
  severity?: SeverityKey;
  finding?: FindingCode;
}

function qualitativeCatalog(defs: Array<[string, QualitativeCol]>): Record<string, QualitativeCol> {
  return Object.fromEntries(defs.map(([alias, def]) => [measureAlias(alias), def]));
}

export const ECHO_QUALITATIVE = qualitativeCatalog([
  ['Valvulopatia leve', { kind: 'valve', severity: 'leve' }],
  ['Valvulopatia moderada', { kind: 'valve', severity: 'moderada' }],
  ['Valvulopatia severa', { kind: 'valve', severity: 'severa' }],
  ['Valvulopatia grave', { kind: 'valve', severity: 'severa' }],
  ...ECHO_FINDINGS.map((f) => [f.source, { kind: 'condition' as const, finding: f }] as [string, QualitativeCol]),
]);

export const ECG_QUALITATIVE = qualitativeCatalog([
  ...ECG_CONDITIONS.map((f) => [f.source, { kind: 'condition' as const, finding: f }] as [string, QualitativeCol]),
  ...ECG_OBSERVATIONS.map((f) => [f.source, { kind: 'observation' as const, finding: f }] as [string, QualitativeCol]),
]);

export const QT_QUALITATIVE = { ...ECG_QUALITATIVE, ...ECHO_QUALITATIVE };

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

const CLINICAL_STATUS = {
  coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }],
};
const PROBLEM_LIST = [
  { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-category', code: 'problem-list-item' }] },
];

/** `0`/`0.0`/`No` → ausente. Cualquier otra cosa con contenido → presente. */
function isAbsent(raw: string): boolean {
  const t = raw.trim();
  return /^(0(\.0+)?|no)$/i.test(t);
}

/**
 * Condition de lesión valvular con severidad.
 *
 * El identifier incluye la severidad a propósito: si la misma válvula pasa de
 * leve a moderada en un eco posterior, quedan dos `Condition` con onsets
 * distintos y la progresión no se pierde (que es justo lo que importa en el
 * seguimiento de cardiotoxicidad).
 */
function valveCondition(
  subject: Reference<Patient>, dni: string, abbr: string, severity: SeverityKey, date?: string
): BundleEntry | undefined {
  const lesion = VALVE_LESIONS.find((v) => v.abbr.toLowerCase() === abbr.toLowerCase());
  if (!lesion) return undefined;
  const sev = SEVERITY_CODES[severity];
  const idValue = `${dni}-cond-valve-${lesion.abbr.toLowerCase()}-${severity}`;
  const cond: Condition = {
    resourceType: 'Condition',
    identifier: [{ system: MIG_SYS, value: idValue }],
    clinicalStatus: CLINICAL_STATUS,
    category: PROBLEM_LIST,
    severity: { coding: [{ system: SYSTEMS.snomed, code: sev.code, display: sev.display }] },
    code: {
      coding: [
        { system: SYSTEMS.icd10, code: lesion.icd10, display: lesion.display },
        { system: SYSTEMS.snomed, code: lesion.snomed, display: lesion.display },
      ],
      text: `${lesion.display} ${sev.display.toLowerCase()}`,
    },
    subject,
    onsetDateTime: date,
  };
  return putEntry(cond, 'Condition', idValue);
}

/** Condition de un hallazgo booleano presente. */
function findingCondition(
  subject: Reference<Patient>, dni: string, f: FindingCode, date?: string
): BundleEntry {
  const idValue = `${dni}-cond-${f.snomed}`;
  const coding: Coding[] = [{ system: SYSTEMS.snomed, code: f.snomed, display: f.display }];
  if (f.icd10) coding.unshift({ system: SYSTEMS.icd10, code: f.icd10, display: f.display });
  const cond: Condition = {
    resourceType: 'Condition',
    identifier: [{ system: MIG_SYS, value: idValue }],
    clinicalStatus: CLINICAL_STATUS,
    category: PROBLEM_LIST,
    code: { coding, text: f.display },
    subject,
    onsetDateTime: date,
  };
  return putEntry(cond, 'Condition', idValue);
}

/**
 * Observation booleana de un hallazgo Sí/No.
 * Se guarda también el "No" porque es informativo (p. ej. `RS = No` significa
 * que el paciente NO está en ritmo sinusal, distinto de "no se evaluó").
 */
function findingObservation(
  subject: Reference<Patient>, dni: string, f: FindingCode, present: boolean, date?: string, suffix?: string
): BundleEntry {
  const idValue = `${dni}-obs-${f.snomed}${date ? '-' + date : ''}${suffix ? '-' + suffix : ''}`;
  const obs: Observation = {
    resourceType: 'Observation',
    identifier: [{ system: MIG_SYS, value: idValue }],
    status: 'final',
    category: [{ coding: [{ system: OBS_CAT_SYS, code: 'procedure' }] }],
    code: { coding: [{ system: SYSTEMS.snomed, code: f.snomed, display: f.display }], text: f.display },
    subject,
    effectiveDateTime: date,
    valueBoolean: present,
  };
  return putEntry(obs, 'Observation', idValue);
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
  fallbackDate?: string,
  qual: Record<string, QualitativeCol> = {}
): SerialMapResult {
  const entries: BundleEntry[] = [];
  const matched: string[] = [];
  const ignored: string[] = [];
  const warnings: string[] = [];

  for (const block of splitBlocks(Object.keys(row), row)) {
    const date = block.index === 0 ? fallbackDate : block.date;
    let valuesInBlock = 0;

    for (const col of block.columns) {
      const alias = measureAlias(col);
      // Ni las claves de join ni lo que ya migra la spine son mediciones nuevas.
      if (JOIN_KEYS.has(alias) || SPINE_COVERED.has(alias)) continue;
      const raw = row[col] ?? '';
      if (cellKind(raw) !== 'value') continue; // vacío / no corresponde / no realizado
      // Sin fecha, el índice de bloque desambigua para no pisar recursos.
      const suffix = date ? undefined : `b${block.index}`;

      // 1) Columnas cualitativas (valvulopatías, hallazgos Sí/No).
      const q = qual[alias];
      if (q) {
        valuesInBlock++;
        matched.push(col);
        if (q.kind === 'valve') {
          // El valor lista las válvulas afectadas: "IT", "IT IM", "IM + IAo".
          if (isAbsent(raw)) continue;
          for (const token of raw.split(/[\s,+/]+/).filter(Boolean)) {
            const e = valveCondition(subject, dni, token, q.severity!, date);
            if (e) entries.push(e);
            else warnings.push(`DNI ${dni}: sigla de válvula desconocida "${token}" en "${col}" — se omite`);
          }
        } else if (q.kind === 'condition') {
          if (!isAbsent(raw)) entries.push(findingCondition(subject, dni, q.finding!, date));
        } else {
          entries.push(findingObservation(subject, dni, q.finding!, isYes(raw) || !isAbsent(raw), date, suffix));
        }
        continue;
      }

      // 2) Mediciones numéricas.
      const value = num(raw);
      if (value === undefined) continue;
      valuesInBlock++;
      const measure = cat[alias];
      if (!measure) {
        ignored.push(col);
        continue;
      }
      matched.push(col);
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
