// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * EPA Bienestar IA — Cardio-Oncología Marie Curie
 * Bot Medplum: recalcular scores de riesgo cuando cambian las Observations.
 *
 * Trigger: Subscription sobre Observation (códigos de entrada de los scores).
 * Al crearse/actualizarse una Observation relevante de un paciente, el Bot
 * recolecta los últimos valores del paciente, recalcula PREVENT, Framingham,
 * SCORE2 y Globorisk, y hace UPSERT de los RiskAssessment (uno por método,
 * idempotente vía identifier) marcados como `risk-source = computed`.
 *
 * Reutiliza las funciones puras ya verificadas del motor de scores; esbuild
 * las inlinea al bundlear el bot (bundle: true).
 */

import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Condition, Observation, Patient, Reference, RiskAssessment } from '@medplum/fhirtypes';
import { buildPreventRiskAssessment, computePrevent } from './scores/prevent';
import { buildFraminghamRiskAssessment, computeFramingham } from './scores/framingham';
import { buildScore2RiskAssessment, computeScore2, mgDlToMmolChol } from './scores/score2';
import { buildGloboriskRiskAssessment, computeGloborisk } from './scores/globorisk';

const LOINC = {
  totalChol: '2093-3',
  hdl: '2085-9',
  bpPanel: '85354-9',
  sbp: '8480-6',
  egfr: '98979-8',
  bmi: '39156-5',
  hba1c: '4548-4',
  uacr: '14959-1',
  smoking: '72166-2',
};

/** Códigos que disparan un recálculo (para la criteria de la Subscription y el filtro). */
export const SCORE_INPUT_CODES = Object.values(LOINC);

const RA_ID_SYSTEM = 'https://api.epa-bienestar.com.ar/fhir/CodeSystem/risk-assessment-computed';
const RISK_SOURCE_EXT = 'https://api.epa-bienestar.com.ar/fhir/StructureDefinition/risk-source';

export interface RawInputs {
  age?: number;
  sex: 'female' | 'male';
  totalChol?: number; // mg/dL
  hdl?: number; // mg/dL
  sbp?: number; // mmHg
  egfr?: number;
  bmi?: number;
  hba1c?: number;
  uacr?: number;
  diabetes: boolean;
  smoking: boolean;
}

export async function handler(medplum: MedplumClient, event: BotEvent<Observation>): Promise<void> {
  const obs = event.input;
  if (obs?.resourceType !== 'Observation') {
    return;
  }

  // Solo reaccionar a códigos de entrada de los scores.
  const codes = (obs.code?.coding ?? []).map((c) => c.code);
  if (!codes.some((c) => c && SCORE_INPUT_CODES.includes(c))) {
    return;
  }

  const patientRef = obs.subject as Reference<Patient> | undefined;
  if (!patientRef?.reference?.startsWith('Patient/')) {
    return;
  }
  const patientId = patientRef.reference.split('/')[1];
  const patient = await medplum.readResource('Patient', patientId);

  const inputs = await gatherInputs(medplum, patient);
  if (inputs.age === undefined) {
    console.log(`[recalc-scores] Paciente ${patientId} sin fecha de nacimiento; se omite.`);
    return;
  }

  const subject: RiskAssessment['subject'] = {
    reference: `Patient/${patientId}`,
    display: patient.name?.[0]?.text,
  };
  const basis = await gatherBasis(medplum, patientId);

  const ras = buildScoresForInputs(inputs, subject, basis);
  for (const ra of ras) {
    await upsertComputed(medplum, ra, subject);
  }

  console.log(`[recalc-scores] Paciente ${patientId}: ${ras.length} RiskAssessment actualizados.`);
}

// ─── Lógica pura de orquestación (testeable sin I/O) ───────────────────────────

function has(i: RawInputs, ...keys: Array<keyof RawInputs>): boolean {
  return keys.every((k) => typeof i[k] === 'number' && !Number.isNaN(i[k] as number));
}

/** Ejecuta un cálculo que puede lanzar (fuera de rango etario) y agrega el RA si tuvo éxito. */
function tryPush(out: RiskAssessment[], build: () => RiskAssessment): void {
  try {
    out.push(build());
  } catch (err) {
    console.log(`[recalc-scores] score omitido: ${(err as Error).message}`);
  }
}

/**
 * Decide y construye los RiskAssessment que corresponden según los datos
 * disponibles del paciente. Función pura (sin acceso a Medplum) → testeable.
 * @param inputs - Datos clínicos recolectados.
 * @param subject - Referencia al Patient.
 * @param basis - Observations de entrada (trazabilidad).
 * @returns Array de RiskAssessment listos para upsert.
 */
export function buildScoresForInputs(
  inputs: RawInputs,
  subject: RiskAssessment['subject'],
  basis: Reference[] = []
): RiskAssessment[] {
  const out: RiskAssessment[] = [];
  if (inputs.age === undefined) {
    return out;
  }
  const age = inputs.age;

  if (has(inputs, 'totalChol', 'hdl', 'sbp', 'egfr', 'bmi')) {
    tryPush(out, () =>
      buildPreventRiskAssessment(
        computePrevent({
          age, sex: inputs.sex, totalCholesterol: inputs.totalChol as number, hdl: inputs.hdl as number,
          systolicBP: inputs.sbp as number, bpTreated: false, statin: false, diabetes: inputs.diabetes,
          smoking: inputs.smoking, egfr: inputs.egfr as number, bmi: inputs.bmi as number,
          hba1c: inputs.hba1c, uacr: inputs.uacr,
        }),
        subject, basis
      )
    );
  }

  if (has(inputs, 'totalChol', 'hdl', 'sbp')) {
    tryPush(out, () =>
      buildFraminghamRiskAssessment(
        computeFramingham({
          age, sex: inputs.sex, totalCholesterol: inputs.totalChol as number, hdl: inputs.hdl as number,
          systolicBP: inputs.sbp as number, bpTreated: false, smoking: inputs.smoking, diabetes: inputs.diabetes,
        }),
        subject, basis
      )
    );
    tryPush(out, () =>
      buildScore2RiskAssessment(
        computeScore2({
          age, sex: inputs.sex, smoking: inputs.smoking, systolicBP: inputs.sbp as number, diabetes: inputs.diabetes,
          totalCholesterol: mgDlToMmolChol(inputs.totalChol as number), hdl: mgDlToMmolChol(inputs.hdl as number),
        }),
        subject, basis
      )
    );
  }

  if (has(inputs, 'totalChol', 'sbp')) {
    tryPush(out, () =>
      buildGloboriskRiskAssessment(
        computeGloborisk({
          age, sex: inputs.sex, systolicBP: inputs.sbp as number,
          totalCholesterol: mgDlToMmolChol(inputs.totalChol as number), diabetes: inputs.diabetes, smoking: inputs.smoking,
        }),
        subject, basis
      )
    );
  }

  return out;
}

/** Upsert idempotente por identifier (patient + método). Marca risk-source = computed. */
async function upsertComputed(
  medplum: MedplumClient,
  ra: RiskAssessment,
  subject: RiskAssessment['subject']
): Promise<void> {
  const method = ra.method?.coding?.[0]?.code ?? 'unknown';
  const patientId = subject.reference?.split('/')[1] ?? 'unknown';
  const idValue = `${patientId}-${method}`;

  ra.identifier = [{ system: RA_ID_SYSTEM, value: idValue }];
  ra.extension = [{ url: RISK_SOURCE_EXT, valueCode: 'computed' }];

  const existing = await medplum.searchOne('RiskAssessment', `identifier=${RA_ID_SYSTEM}|${idValue}`);
  if (existing) {
    ra.id = existing.id;
    await medplum.updateResource(ra);
  } else {
    await medplum.createResource(ra);
  }
}

async function latest(medplum: MedplumClient, patientId: string, code: string): Promise<Observation | undefined> {
  return medplum.searchOne('Observation', `patient=Patient/${patientId}&code=${code}&_sort=-date`);
}

function ageFromBirthDate(birthDate?: string): number | undefined {
  if (!birthDate) return undefined;
  const diff = Date.now() - new Date(birthDate).getTime();
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
}

async function gatherInputs(medplum: MedplumClient, patient: Patient): Promise<RawInputs> {
  const patientId = patient.id as string;
  const [chol, hdl, bpPanel, sbpDirect, egfr, bmi, hba1c, uacr, smokingObs, conditions] = await Promise.all([
    latest(medplum, patientId, LOINC.totalChol),
    latest(medplum, patientId, LOINC.hdl),
    latest(medplum, patientId, LOINC.bpPanel),
    latest(medplum, patientId, LOINC.sbp),
    latest(medplum, patientId, LOINC.egfr),
    latest(medplum, patientId, LOINC.bmi),
    latest(medplum, patientId, LOINC.hba1c),
    latest(medplum, patientId, LOINC.uacr),
    latest(medplum, patientId, LOINC.smoking),
    medplum.searchResources('Condition', `patient=Patient/${patientId}&clinical-status=active&_count=100`),
  ]);

  const sbpFromPanel = bpPanel?.component?.find((c) => c.code?.coding?.some((cd) => cd.code === LOINC.sbp))
    ?.valueQuantity?.value;

  const diabetes = (conditions as Condition[]).some((c) =>
    c.code?.coding?.some((cd) => /^E1[013]/i.test(cd.code ?? ''))
  );

  const smokingText = (
    smokingObs?.valueCodeableConcept?.text ??
    smokingObs?.valueCodeableConcept?.coding?.[0]?.display ??
    smokingObs?.valueCodeableConcept?.coding?.[0]?.code ??
    ''
  ).toLowerCase();
  const smoking = /current|fumador|smoker|77176002|449868002/.test(smokingText) && !/never|ex|former|no fum/.test(smokingText);

  return {
    age: ageFromBirthDate(patient.birthDate),
    sex: patient.gender === 'female' ? 'female' : 'male',
    totalChol: chol?.valueQuantity?.value,
    hdl: hdl?.valueQuantity?.value,
    sbp: sbpFromPanel ?? sbpDirect?.valueQuantity?.value,
    egfr: egfr?.valueQuantity?.value,
    bmi: bmi?.valueQuantity?.value,
    hba1c: hba1c?.valueQuantity?.value,
    uacr: uacr?.valueQuantity?.value,
    diabetes,
    smoking,
  };
}

/** Referencias a las Observations de entrada, para trazabilidad (RiskAssessment.basis). */
async function gatherBasis(medplum: MedplumClient, patientId: string): Promise<Reference[]> {
  const refs: Reference[] = [];
  for (const code of [LOINC.totalChol, LOINC.hdl, LOINC.sbp, LOINC.bpPanel, LOINC.egfr]) {
    const o = await latest(medplum, patientId, code);
    if (o?.id) {
      refs.push({ reference: `Observation/${o.id}` });
    }
  }
  return refs;
}
