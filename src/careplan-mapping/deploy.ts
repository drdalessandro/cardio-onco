#!/usr/bin/env ts-node
/**
 * EPA Bienestar IA — Cardio-Oncología Marie Curie
 * Deploy script: sube Questionnaire, PlanDefinitions y registra el Bot en Medplum
 *
 * Uso:
 *   npx ts-node deploy.ts --env prod
 *   npx ts-node deploy.ts --env dev --dry-run
 */

import { MedplumClient } from '@medplum/core';
import { readFileSync }   from 'fs';
import { join, dirname }  from 'path';
import { fileURLToPath }  from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const MEDPLUM_BASE_URL = 'https://api.epa-bienestar.com.ar/fhir';
const BOT_NAME         = 'cardio-onco-create-careplan';

// ─── PlanDefinitions a deployar (misma carpeta o ruta relativa) ───────────────
const PLAN_DEFINITION_IDS = [
  'cardio-onco-ecg-solo',
  'cardio-onco-ecg-ta',
  'cardio-onco-ecg-seguimiento',
  'cardio-onco-baseline-comprehensive',
  'cardio-onco-echo-visit',
  'cardio-onco-biomarker-lab',
  'cardio-onco-risk-stratification',
];

async function deploy(medplum: MedplumClient, dryRun = false): Promise<void> {
  console.log('\n━━━ EPA Bienestar IA — Cardio-Oncología Deploy ━━━\n');

  // 1. Questionnaire
  const questionnaire = JSON.parse(
    readFileSync(join(__dirname, 'questionnaire-risk-stratification.json'), 'utf-8')
  );
  if (!dryRun) {
    const q = await medplum.upsertResource(questionnaire, 'id');
    console.log(`✓ Questionnaire: ${q.id}`);
  } else {
    console.log(`[dry-run] Questionnaire: ${questionnaire.id}`);
  }

  // 2. PlanDefinitions
  for (const pdId of PLAN_DEFINITION_IDS) {
    try {
      const pd = JSON.parse(
        readFileSync(join(__dirname, `plan-definitions/${pdId}.json`), 'utf-8')
      );
      if (!dryRun) {
        const result = await medplum.upsertResource(pd, 'id');
        console.log(`✓ PlanDefinition: ${result.id} (${result.title})`);
      } else {
        console.log(`[dry-run] PlanDefinition: ${pdId}`);
      }
    } catch (e) {
      console.warn(`  ⚠ PlanDefinition ${pdId} no encontrado en disco, skipping.`);
    }
  }

  // 3. Registrar/actualizar Bot
  if (!dryRun) {
    const existingBots = await medplum.searchResources('Bot', { name: BOT_NAME });
    const botCode = readFileSync(join(__dirname, 'bot.ts'), 'utf-8');

    if (existingBots.length === 0) {
      const bot = await medplum.createResource({
        resourceType: 'Bot',
        name: BOT_NAME,
        description: 'Crea CarePlan + Tasks cardio-oncológicas desde score CTRCD ESC 2022',
        sourceCode: { contentType: 'application/typescript', data: btoa(botCode) },
        runtimeVersion: 'awslambda',
      });
      console.log(`✓ Bot creado: ${bot.id}`);

      // Subscription trigger
      await medplum.createResource({
        resourceType: 'Subscription',
        status: 'active',
        reason: 'Activar protocolo cardio-oncológico al completar score CTRCD',
        criteria: 'QuestionnaireResponse?questionnaire=cardio-onco-risk-stratification&status=completed',
        channel: {
          type: 'rest-hook',
          endpoint: `Bot/${bot.id}`,
        },
      });
      console.log(`✓ Subscription creada → Bot/${bot.id}`);
    } else {
      console.log(`✓ Bot ya existente: ${existingBots[0].id} (actualizar manualmente si hay cambios)`);
    }
  } else {
    console.log('[dry-run] Bot y Subscription skipped.');
  }

  console.log('\n━━━ Deploy completado ━━━\n');
}

// ─── Entrypoint ───────────────────────────────────────────────────────────────
(async () => {
  const isDryRun = process.argv.includes('--dry-run');

  const medplum = new MedplumClient({ baseUrl: MEDPLUM_BASE_URL });
  await medplum.startClientLogin(
    process.env.MEDPLUM_CLIENT_ID!,
    process.env.MEDPLUM_CLIENT_SECRET!
  );

  await deploy(medplum, isDryRun);
})().catch(console.error);
