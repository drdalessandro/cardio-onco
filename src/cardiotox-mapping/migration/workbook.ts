// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * EPA Bienestar IA — Cardio-Oncología Marie Curie
 * Migrador: **join por `DNI`** de las hojas del libro → un `Patient`
 * longitudinal por persona.
 *
 * La fuente no es una tabla plana sino un libro relacional de 9 hojas unidas por
 * `DNI`. Este módulo hace el join y arma **un Bundle transaccional por
 * paciente**, con la spine (Cardiotox) como registro maestro y las hojas
 * seriadas / CKM aportando el resto:
 *
 *   Cardiotox                (spine)   → Patient + basal
 *   Ecocardiogramas_control  (serie)   → Observation de eco fechadas
 *   Estudios_Complementarios (serie)   → Observation de ECG fechadas
 *   QT_cardiotox             (serie)   → Observation ECG/eco fechadas
 *   FRCV                     (CKM)     → MedicationStatement + Goal
 *
 * Dos propiedades importantes del join:
 *
 * 1. **Deduplicación.** Todas las hojas usan el mismo `identifier` determinista
 *    por recurso, así que la misma medición cargada en la spine y en la hoja
 *    seriada colapsa en **un** recurso. Esto no es un parche: es exactamente lo
 *    que resuelve la duplicación `inicial/control` de la planilla. Además, FHIR
 *    prohíbe que una transacción tenga dos entries que resuelvan al mismo
 *    recurso, así que deduplicar es obligatorio.
 * 2. **Huérfanos.** Una fila de hoja seriada cuyo DNI no existe en la spine no
 *    puede colgar de ningún `Patient`: se omite con advertencia (o se le crea un
 *    `Patient` mínimo sólo con el DNI si se pide explícitamente).
 */

import type { Bundle, BundleEntry, Patient } from '@medplum/fhirtypes';
import { SYSTEMS } from '../data-dictionary';
import { mapCardiotoxRow } from './cardiotox-mapper';
import { patientFullUrl, patientRef } from './entry-builders';
import { mapFrcvRow } from './frcv-mapper';
import {
  ECG_CATALOG, ECG_QUALITATIVE, ECHO_CATALOG, ECHO_QUALITATIVE,
  QT_CATALOG, QT_QUALITATIVE, mapSerialRow,
} from './serial-sheets';
import { dniValue, partialDate } from './parsers';

/** Hojas del libro que se migran. */
export type SheetName =
  | 'Cardiotox'
  | 'Ecocardiogramas_control'
  | 'Estudios_Complementarios'
  | 'QT_cardiotox'
  | 'FRCV';

export interface Workbook {
  /** Filas por hoja (la spine `Cardiotox` es obligatoria). */
  sheets: Partial<Record<SheetName, Array<Record<string, string>>>>;
  /** Crear `Patient` mínimo para DNIs que sólo aparecen en hojas seriadas. */
  includeOrphans?: boolean;
}

/** Cobertura de encabezados de una hoja — para validar contra el export real. */
export interface SheetCoverage {
  sheet: SheetName;
  rows: number;
  matched: string[];
  ignored: string[];
}

export interface JoinResult {
  /** Un Bundle transaccional por paciente. */
  bundles: Bundle[];
  warnings: string[];
  coverage: SheetCoverage[];
  stats: {
    patients: number;
    resources: number;
    /** Entries colapsados por identifier repetido (esperable y deseado). */
    deduped: number;
    orphanDnis: string[];
  };
}

const SERIAL_CATALOGS = {
  Ecocardiogramas_control: { measures: ECHO_CATALOG, qualitative: ECHO_QUALITATIVE },
  Estudios_Complementarios: { measures: ECG_CATALOG, qualitative: ECG_QUALITATIVE },
  QT_cardiotox: { measures: QT_CATALOG, qualitative: QT_QUALITATIVE },
} as const;

/** Fila → DNI limpio (o `undefined` si la fila no lo trae). */
function rowDni(row: Record<string, string>): string | undefined {
  return dniValue(row['DNI']);
}

/** `Patient` mínimo (sólo DNI) para huérfanos, cuando se habilita. */
function orphanPatient(dni: string): BundleEntry {
  const patient: Patient = {
    resourceType: 'Patient',
    identifier: [{ system: SYSTEMS.dniArgentina, value: dni, use: 'official' }],
  };
  return {
    fullUrl: patientFullUrl(dni),
    resource: patient,
    request: {
      method: 'PUT',
      url: `Patient?identifier=${encodeURIComponent(SYSTEMS.dniArgentina)}|${encodeURIComponent(dni)}`,
    },
  };
}

/**
 * Une las hojas por `DNI` y arma un Bundle transaccional por paciente.
 *
 * @param wb - Hojas ya parseadas a objetos {encabezado: valor}.
 */
export function joinWorkbook(wb: Workbook): JoinResult {
  const warnings: string[] = [];
  const coverage: SheetCoverage[] = [];
  const orphanDnis = new Set<string>();

  /** DNI → entries acumuladas (spine primero). */
  const byDni = new Map<string, BundleEntry[]>();
  /** DNI → fecha basal de la spine, para fechar el bloque basal de las series. */
  const baselineDate = new Map<string, string | undefined>();

  // ── 1. Spine: define el universo de pacientes ──
  const spineRows = wb.sheets.Cardiotox ?? [];
  const spineMatched = new Set<string>();
  spineRows.forEach((row, i) => {
    const res = mapCardiotoxRow(row);
    res.warnings.forEach((w) => warnings.push(`Cardiotox fila ${i + 2}: ${w}`));
    if (!res.dni) return;
    if (byDni.has(res.dni)) {
      warnings.push(`Cardiotox fila ${i + 2}: DNI ${res.dni} duplicado en la spine — se fusionan las filas`);
    }
    const acc = byDni.get(res.dni) ?? [];
    acc.push(...res.entries);
    byDni.set(res.dni, acc);
    baselineDate.set(res.dni, partialDate(row['Inicio seguimiento']));
    Object.keys(row).forEach((h) => spineMatched.add(h));
  });
  coverage.push({ sheet: 'Cardiotox', rows: spineRows.length, matched: [...spineMatched], ignored: [] });

  /** Resuelve el paciente de una fila de hoja secundaria. */
  const resolve = (dni: string | undefined, sheet: SheetName, rowNum: number): string | undefined => {
    if (!dni) {
      warnings.push(`${sheet} fila ${rowNum}: sin DNI — se omite`);
      return undefined;
    }
    if (byDni.has(dni)) return dni;
    if (wb.includeOrphans) {
      orphanDnis.add(dni);
      byDni.set(dni, [orphanPatient(dni)]);
      return dni;
    }
    orphanDnis.add(dni);
    warnings.push(`${sheet} fila ${rowNum}: DNI ${dni} no existe en Cardiotox — se omite (usar --include-orphans para migrarlo)`);
    return undefined;
  };

  // ── 2. Hojas seriadas: Observations fechadas ──
  for (const sheet of Object.keys(SERIAL_CATALOGS) as Array<keyof typeof SERIAL_CATALOGS>) {
    const rows = wb.sheets[sheet];
    if (!rows?.length) continue;
    const matched = new Set<string>();
    const ignored = new Set<string>();

    rows.forEach((row, i) => {
      const dni = resolve(rowDni(row), sheet, i + 2);
      if (!dni) return;
      const { measures, qualitative } = SERIAL_CATALOGS[sheet];
      const res = mapSerialRow(row, measures, dni, patientRef(dni), baselineDate.get(dni), qualitative);
      res.matched.forEach((h) => matched.add(h));
      res.ignored.forEach((h) => ignored.add(h));
      res.warnings.forEach((w) => warnings.push(`${sheet}: ${w}`));
      byDni.get(dni)!.push(...res.entries);
    });

    coverage.push({ sheet, rows: rows.length, matched: [...matched], ignored: [...ignored] });
  }

  // ── 3. FRCV: capa de tratamiento CKM ──
  const frcvRows = wb.sheets.FRCV;
  if (frcvRows?.length) {
    const matched = new Set<string>();
    const ignored = new Set<string>();
    frcvRows.forEach((row, i) => {
      const dni = resolve(rowDni(row), 'FRCV', i + 2);
      if (!dni) return;
      const res = mapFrcvRow(row, dni, patientRef(dni));
      res.matched.forEach((h) => matched.add(h));
      res.ignored.forEach((h) => ignored.add(h));
      res.warnings.forEach((w) => warnings.push(`FRCV: ${w}`));
      byDni.get(dni)!.push(...res.entries);
    });
    coverage.push({ sheet: 'FRCV', rows: frcvRows.length, matched: [...matched], ignored: [...ignored] });
  }

  // ── 4. Dedupe + un Bundle por paciente ──
  let deduped = 0;
  let resources = 0;
  const bundles: Bundle[] = [];
  for (const [, entries] of byDni) {
    const seen = new Map<string, BundleEntry>();
    for (const e of entries) {
      const key = e.request?.url ?? e.fullUrl ?? '';
      if (seen.has(key)) {
        deduped++; // misma medición cargada en dos hojas → un solo recurso
        continue;
      }
      seen.set(key, e);
    }
    const entry = [...seen.values()];
    resources += entry.length;
    bundles.push({ resourceType: 'Bundle', type: 'transaction', entry });
  }

  return {
    bundles,
    warnings,
    coverage,
    stats: { patients: bundles.length, resources, deduped, orphanDnis: [...orphanDnis] },
  };
}
