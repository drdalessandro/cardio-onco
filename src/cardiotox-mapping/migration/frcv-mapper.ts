// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * EPA Bienestar IA — Cardio-Oncología Marie Curie
 * Migrador: hoja **FRCV** = capa de tratamiento **cardio-reno-metabólica (CKM)**.
 *
 * Es la hoja que conecta cardio-onco con el proyecto CKM: gliflozinas (iSGLT2) y
 * agonistas GLP-1 son las drogas insignia del modelo, junto con el bloqueo del
 * eje renina-angiotensina (IECA/ARA2/ARNI) y el control lipídico
 * (estatinas/ezetimibe).
 *
 * Mapeo:
 *   - Cada familia farmacológica presente → `MedicationStatement` (ATC).
 *   - Cada objetivo terapéutico con valor → `Goal` con `target.measure` (LOINC)
 *     y `detailQuantity` con comparador, siguiendo la convención CKM.
 *
 * Los códigos **ATC y LOINC son estándar**; lo que puede variar es el nombre de
 * la columna en el export. Por eso el match es por alias normalizado y las
 * columnas no reconocidas se reportan (nunca se adivinan).
 */

import type { BundleEntry, Goal, MedicationStatement, Patient, Reference } from '@medplum/fhirtypes';
import { OBSERVATION_CODES, SYSTEMS } from '../data-dictionary';
import type { ObsCode } from '../data-dictionary';
import { MIG_SYS, putEntry } from './entry-builders';
import { measureAlias } from './serial-sheets';
import { isYes, num, slug, text } from './parsers';

/** Familia farmacológica CKM/cardiovascular con su código ATC. */
export interface CvMedFamily {
  /** Nombres de columna aceptados (se normalizan a alias). */
  aliases: string[];
  atc: string;
  display: string;
  /** `true` en las familias insignia del modelo cardio-reno-metabólico. */
  ckmCore?: boolean;
}

/**
 * Catálogo de familias CV/CKM → ATC (clasificación oficial WHOCC).
 * Ver docs §10 (medicación cardiovascular) y la guía CKM AHA/ACC/ADA/ASN 2026.
 */
export const CV_MED_FAMILIES: CvMedFamily[] = [
  // ── Eje renina-angiotensina-aldosterona ──
  { aliases: ['IECA'], atc: 'C09A', display: 'IECA (inhibidores de la ECA)' },
  { aliases: ['ARA2', 'ARA II', 'ARAII'], atc: 'C09C', display: 'ARA II (antagonistas del receptor de angiotensina II)' },
  { aliases: ['ARNI', 'Sacubitrilo', 'Sacubitrilo/Valsartán'], atc: 'C09DX04', display: 'ARNI (sacubitrilo/valsartán)' },
  { aliases: ['Antialdosteronicos', 'Espironolactona', 'ARM', 'MRA'], atc: 'C03DA', display: 'Antagonistas de la aldosterona (ARM)' },
  // ── Insignia CKM ──
  { aliases: ['Gliflozinas', 'iSGLT2', 'SGLT2', 'Dapagliflozina', 'Empagliflozina'], atc: 'A10BK', display: 'Gliflozinas (inhibidores de SGLT2)', ckmCore: true },
  { aliases: ['GLP1', 'GLP-1', 'Analogos GLP1', 'Semaglutida', 'Liraglutida'], atc: 'A10BJ', display: 'Agonistas del receptor de GLP-1', ckmCore: true },
  // ── Lípidos ──
  { aliases: ['Estatinas', 'Estatina'], atc: 'C10AA', display: 'Estatinas', ckmCore: true },
  { aliases: ['Ezetimibe'], atc: 'C10AX09', display: 'Ezetimibe' },
  // ── Resto del arsenal CV ──
  { aliases: ['Betabloqueantes', 'BB'], atc: 'C07', display: 'Betabloqueantes' },
  { aliases: ['Calcioantagonistas', 'BCC'], atc: 'C08', display: 'Bloqueantes cálcicos' },
  { aliases: ['Diureticos'], atc: 'C03', display: 'Diuréticos' },
  { aliases: ['Metformina'], atc: 'A10BA02', display: 'Metformina' },
  { aliases: ['Insulina'], atc: 'A10A', display: 'Insulina' },
  { aliases: ['Anticoagulantes', 'ACO', 'DOAC'], atc: 'B01A', display: 'Anticoagulantes' },
  { aliases: ['Antiagregantes', 'AAS', 'Aspirina'], atc: 'B01AC', display: 'Antiagregantes plaquetarios' },
];

/** Objetivo terapéutico: columna con el valor meta → `Goal`. */
export interface GoalDef {
  aliases: string[];
  code: ObsCode;
  /** Comparador FHIR del objetivo (`<` para LDL/HbA1c, `<` para TAS). */
  comparator: '<' | '<=' | '>' | '>=';
  label: string;
}

/** Objetivos de la capa FRCV (metas individualizadas por el médico). */
export const GOAL_DEFS: GoalDef[] = [
  { aliases: ['LDL objetivo', 'Objetivo LDL', 'LDL meta'], code: OBSERVATION_CODES.ldl, comparator: '<', label: 'LDL' },
  { aliases: ['HbA1c objetivo', 'Objetivo HbA1c'], code: OBSERVATION_CODES.hba1c, comparator: '<', label: 'HbA1c' },
  { aliases: ['TAS objetivo', 'Objetivo TAS', 'PA objetivo'], code: OBSERVATION_CODES.systolicBP, comparator: '<', label: 'TA sistólica' },
  { aliases: ['Peso objetivo', 'Objetivo peso'], code: OBSERVATION_CODES.weight, comparator: '<', label: 'Peso' },
];

export interface FrcvMapResult {
  entries: BundleEntry[];
  matched: string[];
  ignored: string[];
  warnings: string[];
}

function medStatement(
  subject: Reference<Patient>,
  dni: string,
  fam: CvMedFamily,
  detail?: string
): BundleEntry {
  const idValue = `${dni}-cvmed-${slug(fam.atc)}`;
  const med: MedicationStatement = {
    resourceType: 'MedicationStatement',
    identifier: [{ system: MIG_SYS, value: idValue }],
    status: 'active',
    category: {
      coding: [
        { system: 'http://terminology.hl7.org/CodeSystem/medication-statement-category', code: 'outpatient' },
      ],
    },
    medicationCodeableConcept: {
      coding: [{ system: SYSTEMS.atc, code: fam.atc, display: fam.display }],
      text: detail ?? fam.display,
    },
    subject,
  };
  return putEntry(med, 'MedicationStatement', idValue);
}

function goalResource(
  subject: Reference<Patient>,
  dni: string,
  def: GoalDef,
  value: number
): BundleEntry {
  const idValue = `${dni}-goal-${def.code.code}`;
  const goal: Goal = {
    resourceType: 'Goal',
    identifier: [{ system: MIG_SYS, value: idValue }],
    lifecycleStatus: 'active',
    description: { text: `${def.label} ${def.comparator} ${value}${def.code.unit ? ' ' + def.code.unit : ''}` },
    subject,
    target: [
      {
        measure: { coding: [{ system: SYSTEMS.loinc, code: def.code.code, display: def.code.display }] },
        detailQuantity: def.code.unit
          ? { value, comparator: def.comparator, unit: def.code.unit, system: SYSTEMS.ucum, code: def.code.unit }
          : { value, comparator: def.comparator },
      },
    ],
  };
  return putEntry(goal, 'Goal', idValue);
}

// Índices por alias normalizado (se arman una sola vez).
const MED_BY_ALIAS = new Map<string, CvMedFamily>(
  CV_MED_FAMILIES.flatMap((f) => f.aliases.map((a) => [measureAlias(a), f] as const))
);
const GOAL_BY_ALIAS = new Map<string, GoalDef>(
  GOAL_DEFS.flatMap((g) => g.aliases.map((a) => [measureAlias(a), g] as const))
);

/**
 * Mapea una fila de FRCV a `MedicationStatement` (ATC) + `Goal` (metas).
 *
 * Las columnas de fármaco son booleanas (`Sí`/`No`); si además traen texto
 * (p. ej. la droga concreta) se conserva en `medicationCodeableConcept.text`.
 */
export function mapFrcvRow(
  row: Record<string, string>,
  dni: string,
  subject: Reference<Patient>
): FrcvMapResult {
  const entries: BundleEntry[] = [];
  const matched: string[] = [];
  const ignored: string[] = [];
  const warnings: string[] = [];

  for (const [col, raw] of Object.entries(row)) {
    if (measureAlias(col) === 'dni' || !text(raw)) continue;

    const alias = measureAlias(col);
    const fam = MED_BY_ALIAS.get(alias);
    if (fam) {
      if (isYes(raw)) {
        matched.push(col);
        entries.push(medStatement(subject, dni, fam));
      } else if (!/^no$/i.test(raw.trim())) {
        // Texto libre en la columna de familia → es el nombre de la droga.
        matched.push(col);
        entries.push(medStatement(subject, dni, fam, text(raw)));
      }
      continue;
    }

    const goalDef = GOAL_BY_ALIAS.get(alias);
    if (goalDef) {
      const value = num(raw);
      if (value === undefined) {
        warnings.push(`DNI ${dni}: objetivo "${col}" no es numérico ("${raw}") — se omite`);
      } else {
        matched.push(col);
        entries.push(goalResource(subject, dni, goalDef, value));
      }
      continue;
    }

    ignored.push(col);
  }

  return { entries, matched, ignored, warnings };
}
