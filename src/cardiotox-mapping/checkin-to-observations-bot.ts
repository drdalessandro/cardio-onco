// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * EPA Bienestar IA — Cardio-Oncología Marie Curie
 * Bot: `QuestionnaireResponse` del paciente → `Observation[]`.
 *
 * Es **genérico a propósito**: no conoce ninguna pregunta en particular. Lee el
 * `Questionnaire` referenciado por la respuesta y usa los códigos declarados en
 * `item.code`. Agregar una medición al check-in es editar el `Questionnaire` en
 * el servidor — este bot no cambia y no hay que redeployar nada.
 *
 * Cierra la rebanada vertical del autorreporte:
 *
 *   paciente completa el check-in
 *     → QuestionnaireResponse
 *     → [este bot] Observation con LOINC/SNOMED del recurso
 *     → Subscription de scores (TAS 8480-6, tabaquismo 72166-2 ya están en el
 *       criteria) → recalculate-scores-bot → RiskAssessment actualizado
 *     → el clínico ve la trayectoria al día
 *
 * Las Observations se guardan con `performer = Patient` y categoría `survey`,
 * así la investigación puede separar autorreporte de dato clínico verificado.
 */

import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Observation, Patient, Questionnaire, QuestionnaireResponse, Reference } from '@medplum/fhirtypes';
import { questionnaireResponseToObservations } from './questionnaire-to-observations';

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<QuestionnaireResponse>
): Promise<Observation[]> {
  const response = event.input;

  if (response.status !== 'completed') {
    console.log(`[checkin] respuesta ${response.id} en estado "${response.status}" — se ignora`);
    return [];
  }

  const subject = response.subject as Reference<Patient> | undefined;
  if (!subject?.reference?.startsWith('Patient/')) {
    console.warn(`[checkin] respuesta ${response.id} sin Patient como subject — se omite`);
    return [];
  }

  // El significado clínico vive en el Questionnaire, no acá.
  if (!response.questionnaire) {
    console.warn(`[checkin] respuesta ${response.id} sin referencia al Questionnaire — se omite`);
    return [];
  }
  const questionnaire: Questionnaire | undefined = await medplum.searchOne('Questionnaire', {
    url: response.questionnaire,
  });
  if (!questionnaire) {
    console.warn(`[checkin] no se encontró el Questionnaire ${response.questionnaire} — se omite`);
    return [];
  }

  const { observations, uncoded, warnings } = questionnaireResponseToObservations(questionnaire, response, {
    subject,
    patientReported: true,
    responseId: response.id,
  });

  warnings.forEach((w) => console.warn(`[checkin] ${w}`));
  if (uncoded.length) {
    // Normal: preguntas de texto libre que no son observaciones codificadas.
    console.log(`[checkin] preguntas sin código (no se mapean): ${uncoded.join(', ')}`);
  }

  // Upsert por identifier → re-procesar la misma respuesta actualiza, no duplica.
  const saved: Observation[] = [];
  for (const obs of observations) {
    const identifier = obs.identifier?.[0];
    saved.push(
      identifier
        ? await medplum.upsertResource(obs, { identifier: `${identifier.system}|${identifier.value}` })
        : await medplum.createResource(obs)
    );
  }

  console.log(`[checkin] ${saved.length} Observation(s) desde la respuesta ${response.id}`);
  return saved;
}
