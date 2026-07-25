// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * EPA Bienestar IA — Cardio-Oncología Marie Curie
 * Migrador: constructores de `BundleEntry` compartidos por todas las hojas.
 *
 * Centraliza dos decisiones de diseño:
 *  1. **Idempotencia** — cada recurso lleva un `identifier` estable en el
 *     CodeSystem de migración y se sube con `PUT` condicional por identifier,
 *     así re-correr la migración actualiza en lugar de duplicar.
 *  2. **Un solo `Patient` por DNI** — el `fullUrl` del paciente se deriva del
 *     DNI, por lo que todas las hojas del libro referencian exactamente la
 *     misma `urn:uuid` y la transacción resuelve las referencias internas.
 */

import type { BundleEntry, Patient, Reference, Resource } from '@medplum/fhirtypes';
import { SYSTEMS } from '../data-dictionary';
import type { LocalObsCode, ObsCode } from '../data-dictionary';
import { slug } from './parsers';

/** CodeSystem de los identifiers de migración. */
export const MIG_SYS = SYSTEMS.cardiotoxRecordId;
export const OBS_CAT_SYS = 'http://terminology.hl7.org/CodeSystem/observation-category';

const enc = encodeURIComponent;

/** `fullUrl` canónico del paciente — el mismo para todas las hojas. */
export function patientFullUrl(dni: string): string {
  return `urn:uuid:pat-${slug(dni)}`;
}

/** Referencia al paciente dentro de la transacción. */
export function patientRef(dni: string): Reference<Patient> {
  return { reference: patientFullUrl(dni) };
}

/** Entry idempotente: `PUT <Tipo>?identifier=<sistema>|<valor>`. */
export function putEntry(resource: Resource, type: string, idValue: string): BundleEntry {
  return {
    fullUrl: `urn:uuid:${slug(type)}-${slug(idValue)}`,
    resource,
    request: { method: 'PUT', url: `${type}?identifier=${enc(MIG_SYS)}|${enc(idValue)}` },
  };
}

/**
 * Una medición codificada, sea LOINC universal o CodeSystem local del proyecto.
 * Unifica `ObsCode` (LOINC) y `LocalObsCode` para que las hojas seriadas y la
 * spine usen el mismo constructor.
 */
export interface Measure {
  system: string;
  code: string;
  display: string;
  unit?: string;
  /** Categoría FHIR de la Observation (`vital-signs`, `imaging`, …). */
  category: string;
}

/** Medición con LOINC (del diccionario). */
export function loincMeasure(c: ObsCode, category: string): Measure {
  return { system: SYSTEMS.loinc, code: c.code, display: c.display, unit: c.unit, category };
}

/** Medición con CodeSystem local del proyecto (sin LOINC universal). */
export function localMeasure(c: LocalObsCode, category: string): Measure {
  return { system: c.system, code: c.code, display: c.display, unit: c.unit, category };
}

/**
 * `Observation` numérica idempotente.
 *
 * El identifier lleva la **fecha** cuando existe: así una misma medición en dos
 * fechas son dos recursos distintos (serie temporal nativa de FHIR), y la misma
 * medición/fecha cargada desde dos hojas colapsa en **un solo** recurso — que es
 * justamente lo que resuelve la duplicación "basal/control" de la planilla.
 *
 * @param suffix - Desambiguador cuando la fila no trae fecha (índice de bloque).
 */
export function measureObsEntry(
  subject: Reference<Patient>,
  dni: string,
  m: Measure,
  value: number,
  date?: string,
  suffix?: string
): BundleEntry {
  const idValue = `${dni}-obs-${m.code}${date ? '-' + date : ''}${suffix ? '-' + suffix : ''}`;
  return putEntry(
    {
      resourceType: 'Observation',
      identifier: [{ system: MIG_SYS, value: idValue }],
      status: 'final',
      category: [{ coding: [{ system: OBS_CAT_SYS, code: m.category }] }],
      code: { coding: [{ system: m.system, code: m.code, display: m.display }] },
      subject,
      effectiveDateTime: date,
      valueQuantity: m.unit ? { value, unit: m.unit, system: SYSTEMS.ucum, code: m.unit } : { value },
    },
    'Observation',
    idValue
  );
}
