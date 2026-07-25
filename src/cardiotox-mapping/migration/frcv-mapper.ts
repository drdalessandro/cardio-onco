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

import type {
  BundleEntry, Coding, Condition, Goal, MedicationStatement, Observation, Patient, Reference, RiskAssessment,
} from '@medplum/fhirtypes';
import { ORGAN_DAMAGE, OBSERVATION_CODES, SYSTEMS, riskMethodConcept } from '../data-dictionary';
import type { ObsCode, RiskScoreMethod } from '../data-dictionary';
import { MIG_SYS, OBS_CAT_SYS, loincMeasure, measureObsEntry, putEntry } from './entry-builders';
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
  { aliases: ['ARA 2', 'ARA2', 'ARA II', 'ARAII'], atc: 'C09C', display: 'ARA II (antagonistas del receptor de angiotensina II)' },
  { aliases: ['ARNI', 'Sacubitrilo', 'Sacubitrilo/Valsartán'], atc: 'C09DX04', display: 'ARNI (sacubitrilo/valsartán)' },
  {
    aliases: ['Antag Mineralocort', 'Antialdosteronicos', 'Espironolactona', 'ARM', 'MRA'],
    atc: 'C03DA',
    display: 'Antagonistas mineralocorticoides (ARM)',
  },
  // ── Insignia CKM ──
  { aliases: ['Gliflozinas', 'iSGLT2', 'SGLT2', 'Dapagliflozina', 'Empagliflozina'], atc: 'A10BK', display: 'Gliflozinas (inhibidores de SGLT2)', ckmCore: true },
  {
    // La planilla la llama "antag GLP 1".
    aliases: ['antag GLP 1', 'GLP1', 'GLP-1', 'Analogos GLP1', 'Semaglutida', 'Liraglutida'],
    atc: 'A10BJ',
    display: 'Agonistas del receptor de GLP-1',
    ckmCore: true,
  },
  // ── Lípidos ──
  { aliases: ['Estatinas', 'Estatina'], atc: 'C10AA', display: 'Estatinas', ckmCore: true },
  { aliases: ['Ezetimibe'], atc: 'C10AX09', display: 'Ezetimibe' },
  { aliases: ['Ac. bempedoico', 'Acido bempedoico', 'Bempedoico'], atc: 'C10AX15', display: 'Ácido bempedoico' },
  { aliases: ['Fibratos'], atc: 'C10AB', display: 'Fibratos' },
  // ── Antihipertensivos ──
  // NB: "Betabloquentes" es el encabezado real de la planilla (sin la "a").
  { aliases: ['Betabloquentes', 'Betabloqueantes', 'BB'], atc: 'C07', display: 'Betabloqueantes' },
  { aliases: ['Bloq calcicos', 'Calcioantagonistas', 'BCC'], atc: 'C08', display: 'Bloqueantes cálcicos' },
  { aliases: ['Diuretico tiazidico', 'Tiazidas'], atc: 'C03A', display: 'Diuréticos tiazídicos' },
  { aliases: ['Diurt simil tiazidico', 'Simil tiazidico', 'Indapamida', 'Clortalidona'], atc: 'C03BA', display: 'Diuréticos símil tiazídicos' },
  { aliases: ['Diureticos'], atc: 'C03', display: 'Diuréticos' },
  { aliases: ['Hidralazina'], atc: 'C02DB02', display: 'Hidralazina' },
  { aliases: ['metil dopa', 'Metildopa', 'Alfa metil dopa'], atc: 'C02AB', display: 'Metildopa' },
  // ── Metabólico / antitrombótico ──
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

/**
 * Objetivos de tratamiento cumplidos (`Cumple objetivos…` = si/no).
 * La planilla los separa por dominio según la posición de la columna: el
 * primero cierra el bloque de antihipertensivos y el segundo el de lípidos.
 */
export const GOAL_ACHIEVEMENT: Array<{ aliases: string[]; key: string; description: string }> = [
  {
    aliases: ['Cumple objetivos de tratamiento'],
    key: 'hta',
    description: 'Objetivos de tratamiento antihipertensivo',
  },
  { aliases: ['Cumple objetivos'], key: 'lipidos', description: 'Objetivos de tratamiento lipídico' },
  {
    // Se modela como objetivo cumplido/no cumplido para no inventar un código
    // clínico de "cese tabáquico" que no está verificado.
    aliases: ['Logra cese tabaquico'],
    key: 'cese-tabaquico',
    description: 'Cese del tabaquismo',
  },
];

/** Scores cargados a mano en FRCV → `RiskAssessment` manual. */
export const FRCV_SCORE_COLUMNS: Array<{ aliases: string[]; method: RiskScoreMethod }> = [
  { aliases: ['Score OPS'], method: 'OPS-PAHO' },
  { aliases: ['Score framing', 'Score Framingham'], method: 'FRAMINGHAM' },
  { aliases: ['PREVENT'], method: 'PREVENT-AHA-2023' },
];

/**
 * Columnas auxiliares de la planilla (contadores de la hoja Estadísticas,
 * restos de value-sets) — se ignoran explícitamente para que no aparezcan como
 * "sin mapear" en el reporte de cobertura.
 */
export const FRCV_HELPER_COLUMNS = ['Si', 'No', 'Column 1'];

/** `Pack year` → carga tabáquica acumulada. */
const PACK_YEARS: ObsCode = {
  code: '8664-5',
  display: 'Cigarettes smoked total (pack years)',
  unit: '{pack_years}',
  unverified: true,
};

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

/** Goal booleano de cumplimiento (sin target numérico). */
function achievementGoal(
  subject: Reference<Patient>, dni: string, key: string, description: string, achieved: boolean
): BundleEntry {
  const idValue = `${dni}-goal-${key}`;
  const goal: Goal = {
    resourceType: 'Goal',
    identifier: [{ system: MIG_SYS, value: idValue }],
    lifecycleStatus: 'active',
    achievementStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/goal-achievement',
          code: achieved ? 'achieved' : 'not-achieved',
          display: achieved ? 'Achieved' : 'Not Achieved',
        },
      ],
    },
    description: { text: description },
    subject,
  };
  return putEntry(goal, 'Goal', idValue);
}

/** Condition de daño de órgano blanco (HVI, RAC, IR…). */
function organDamageConditions(
  subject: Reference<Patient>, dni: string, raw: string
): { entries: BundleEntry[]; unknown: string[] } {
  const entries: BundleEntry[] = [];
  const unknown: string[] = [];
  for (const token of raw.split(/[\s,+/]+/).filter(Boolean)) {
    if (/^(no|0(\.0+)?)$/i.test(token)) continue;
    const d = ORGAN_DAMAGE.find((o) => o.abbr.toLowerCase() === token.toLowerCase());
    if (!d) {
      unknown.push(token);
      continue;
    }
    const idValue = `${dni}-cond-${d.snomed}`;
    const coding: Coding[] = [{ system: SYSTEMS.snomed, code: d.snomed, display: d.display }];
    if (d.icd10) coding.unshift({ system: SYSTEMS.icd10, code: d.icd10, display: d.display });
    const cond: Condition = {
      resourceType: 'Condition',
      identifier: [{ system: MIG_SYS, value: idValue }],
      clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }] },
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-category', code: 'problem-list-item' }] }],
      code: { coding, text: d.display },
      subject,
    };
    entries.push(putEntry(cond, 'Condition', idValue));
  }
  return { entries, unknown };
}

/** RiskAssessment manual desde una categoría cargada a mano. */
function manualRisk(
  subject: Reference<Patient>, dni: string, method: RiskScoreMethod, categoryText: string
): BundleEntry {
  const idValue = `${dni}-risk-${method}-manual`;
  const ra: RiskAssessment = {
    resourceType: 'RiskAssessment',
    identifier: [{ system: MIG_SYS, value: idValue }],
    status: 'final',
    method: riskMethodConcept(method),
    subject,
    prediction: [{ outcome: { text: categoryText }, qualitativeRisk: { text: categoryText } }],
    extension: [{ url: SYSTEMS.riskSourceExt, valueCode: 'manual' }],
  };
  return putEntry(ra, 'RiskAssessment', idValue);
}

// Índices por alias normalizado (se arman una sola vez).
const MED_BY_ALIAS = new Map<string, CvMedFamily>(
  CV_MED_FAMILIES.flatMap((f) => f.aliases.map((a) => [measureAlias(a), f] as const))
);
const GOAL_BY_ALIAS = new Map<string, GoalDef>(
  GOAL_DEFS.flatMap((g) => g.aliases.map((a) => [measureAlias(a), g] as const))
);
const ACHIEVEMENT_BY_ALIAS = new Map(
  GOAL_ACHIEVEMENT.flatMap((g) => g.aliases.map((a) => [measureAlias(a), g] as const))
);
const SCORE_BY_ALIAS = new Map(
  FRCV_SCORE_COLUMNS.flatMap((s) => s.aliases.map((a) => [measureAlias(a), s] as const))
);
const ORGAN_DAMAGE_ALIASES = new Set(['Daño de organo blanco', 'Daño de org blanco'].map(measureAlias));
const HELPER_ALIASES = new Set(FRCV_HELPER_COLUMNS.map(measureAlias));
const IDENTITY_ALIASES = new Set(
  ['DNI', 'Nombre', 'apellido', 'sexo', 'edad', 'telefono', 'Inicio seguimiento'].map(measureAlias)
);
const PACK_YEARS_ALIAS = measureAlias('Pack year');
const EX_SMOKER_ALIAS = measureAlias('Ex TBQ');

/**
 * `Observation` de ex tabaquista — usa el MISMO identifier que la spine
 * (`<dni>-obs-smoking`), de modo que la columna duplicada de FRCV colapsa en un
 * único recurso en vez de crear uno paralelo.
 */
function smokingStatusEntry(subject: Reference<Patient>, dni: string): BundleEntry {
  const idValue = `${dni}-obs-smoking`;
  const obs: Observation = {
    resourceType: 'Observation',
    identifier: [{ system: MIG_SYS, value: idValue }],
    status: 'final',
    category: [{ coding: [{ system: OBS_CAT_SYS, code: 'social-history' }] }],
    code: { coding: [{ system: SYSTEMS.loinc, code: '72166-2', display: 'Tobacco smoking status' }] },
    subject,
    valueCodeableConcept: {
      coding: [{ system: SYSTEMS.snomed, code: '8517006', display: 'Ex fumador' }],
    },
  };
  return putEntry(obs, 'Observation', idValue);
}

/** Categorías que en realidad significan "no evaluado". */
function isNonCategory(v: string): boolean {
  return /^(no|no corresponde|0(\.0+)?)$/i.test(v.trim());
}

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
    const alias = measureAlias(col);
    if (IDENTITY_ALIASES.has(alias) || HELPER_ALIASES.has(alias)) continue;
    if (!text(raw)) continue;

    // Objetivos de tratamiento cumplidos (si/no).
    const ach = ACHIEVEMENT_BY_ALIAS.get(alias);
    if (ach) {
      matched.push(col);
      entries.push(achievementGoal(subject, dni, ach.key, ach.description, isYes(raw)));
      continue;
    }

    // Daño de órgano blanco: "HVI", "HVI + IR", "RAC".
    if (ORGAN_DAMAGE_ALIASES.has(alias)) {
      matched.push(col);
      const { entries: es, unknown } = organDamageConditions(subject, dni, raw);
      entries.push(...es);
      unknown.forEach((u) =>
        warnings.push(`DNI ${dni}: daño de órgano blanco desconocido "${u}" en "${col}" — se omite`)
      );
      continue;
    }

    // Ex tabaquista: mismo recurso que carga la spine (`EX TBQ`) → deduplica.
    if (alias === EX_SMOKER_ALIAS) {
      if (isYes(raw)) {
        matched.push(col);
        entries.push(smokingStatusEntry(subject, dni));
      } else if (/^no$/i.test(raw.trim())) {
        matched.push(col);
      }
      continue;
    }

    // Carga tabáquica acumulada.
    if (alias === PACK_YEARS_ALIAS) {
      const value = num(raw);
      if (value !== undefined) {
        matched.push(col);
        entries.push(measureObsEntry(subject, dni, loincMeasure(PACK_YEARS, 'social-history'), value));
      }
      continue;
    }

    // Scores cargados a mano.
    const score = SCORE_BY_ALIAS.get(alias);
    if (score) {
      if (!isNonCategory(raw)) {
        matched.push(col);
        entries.push(manualRisk(subject, dni, score.method, text(raw)!));
      }
      continue;
    }

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
