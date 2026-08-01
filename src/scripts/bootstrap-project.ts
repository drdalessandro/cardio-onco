// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * EPA Bienestar IA — Cardio-Oncología Marie Curie
 * Bootstrap de un **Project** de Medplum: deja un proyecto nuevo listo para usar.
 *
 * El `Project` es la unidad de multi-tenancy de Medplum: aísla recursos, bots,
 * subscriptions, access policies y credenciales. Poner Cardio-Onco en su propio
 * Project (separado de CKM) es la opción correcta; lo que hacía falta era que
 * instalarlo fuera **reproducible y auditable** en vez de un procedimiento
 * manual.
 *
 * Qué instala, en orden de dependencia:
 *   1. Terminologías   — CodeSystem/ValueSet (CIE-10 cardio-onco, vademécum ANMAT)
 *   2. Cuestionarios   — Questionnaire de las notas de evolución + tipos de encuentro
 *   3. Bots            — Bot + Binary + Subscription (requiere `npm run build:bots`)
 *   4. Ejemplo (opt.)  — paciente de demostración, sólo con `--example`
 *
 * Todos los bundles son transacciones con `PUT` condicional, así que el script
 * es **idempotente**: correrlo de nuevo actualiza en vez de duplicar.
 *
 * SEGURIDAD: el `ClientApplication` pertenece a UN Project, así que las
 * credenciales determinan el destino — es imposible sembrar el proyecto
 * equivocado. Aun así, el script **muestra el Project destino y pide
 * confirmación** antes de escribir.
 *
 * Uso:
 *   tsx src/scripts/bootstrap-project.ts              # dry-run: qué haría
 *   tsx src/scripts/bootstrap-project.ts --execute    # aplica todo
 *   tsx src/scripts/bootstrap-project.ts --seeds --execute   # sólo terminologías
 *   tsx src/scripts/bootstrap-project.ts --bots --execute    # sólo bots
 *
 * Credenciales (en `.env` o el entorno):
 *   MEDPLUM_BASE_URL   (default https://api.medplum.com.ar)
 *   MEDPLUM_CLIENT_ID  MEDPLUM_CLIENT_SECRET
 */
import { MedplumClient } from '@medplum/core';
import type { Bundle } from '@medplum/fhirtypes';
import { existsSync, readFileSync } from 'fs';

const DEFAULT_BASE_URL = 'https://api.medplum.com.ar';

/** Un paso del bootstrap. */
interface Step {
  /** Flag que lo selecciona (`--seeds`, `--bots`, `--example`). */
  group: 'seeds' | 'bots' | 'example';
  file: string;
  label: string;
  /** Cómo obtener el archivo si falta. */
  hint?: string;
}

const STEPS: Step[] = [
  // Las políticas van primero: definen quién puede ver qué antes de que entre
  // el primer dato.
  { group: 'seeds', file: 'data/core/access-policies.json', label: 'AccessPolicy (paciente · clínico · investigación)' },
  { group: 'seeds', file: 'data/core/condiciones-cie10.json', label: 'Terminología CIE-10 cardio-onco' },
  { group: 'seeds', file: 'data/core/medicamentos-argentina.json', label: 'Vademécum ANMAT' },
  { group: 'seeds', file: 'data/core/encounter-types.json', label: 'Tipos de encuentro' },
  { group: 'seeds', file: 'data/core/encounter-note-questionnaires.json', label: 'Cuestionarios de evolución' },
  { group: 'seeds', file: 'data/core/questionnaire-checkin-cardio-onco.json', label: 'Check-in del paciente (captura autorreportada)' },
  {
    group: 'bots',
    file: 'data/core/example-bots.json',
    label: 'Bots + Subscriptions',
    hint: 'Se genera con `npm run build:bots`.',
  },
  { group: 'example', file: 'data/example/example-patient-data.json', label: 'Paciente de ejemplo' },
];

/** Carga `.env` (sin dependencias: el proyecto no usa dotenv). */
function loadDotEnv(file = '.env'): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (!m) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, '');
    if (value && process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

function die(msg: string): never {
  console.error(msg);
  process.exit(2);
}

/** Resumen de lo que trae un bundle, para el dry-run. */
function summarize(bundle: Bundle): string {
  const counts: Record<string, number> = {};
  for (const e of bundle.entry ?? []) {
    const t = e.resource?.resourceType ?? '?';
    counts[t] = (counts[t] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([t, n]) => `${n} ${t}`)
    .join(', ');
}

async function main(): Promise<void> {
  loadDotEnv();
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');

  // Sin flags de grupo se instalan seeds + bots (el ejemplo es siempre opt-in).
  const groups = new Set<Step['group']>(
    (['seeds', 'bots', 'example'] as const).filter((g) => args.includes(`--${g}`))
  );
  if (groups.size === 0) {
    groups.add('seeds');
    groups.add('bots');
  }

  const steps = STEPS.filter((s) => groups.has(s.group));
  console.log('━━━ Bootstrap del Project — Cardio-Oncología ━━━\n');

  // ── Verificar qué hay para instalar ──
  const ready: Array<Step & { bundle: Bundle }> = [];
  for (const step of steps) {
    if (!existsSync(step.file)) {
      console.warn(`  ⚠ falta ${step.file} — se omite "${step.label}". ${step.hint ?? ''}`);
      continue;
    }
    const bundle = JSON.parse(readFileSync(step.file, 'utf-8')) as Bundle;
    ready.push({ ...step, bundle });
    console.log(`  ▸ ${step.label}`);
    console.log(`      ${step.file} → ${summarize(bundle)}`);
  }

  if (ready.length === 0) {
    die('\nNo hay nada para instalar.');
  }

  if (!execute) {
    console.log('\n[dry-run] No se escribió nada. Agregá --execute para aplicar.');
    return;
  }

  // ── Autenticación ──
  const baseUrl = process.env.MEDPLUM_BASE_URL ?? DEFAULT_BASE_URL;
  const clientId = process.env.MEDPLUM_CLIENT_ID;
  const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    die(
      '\nFaltan MEDPLUM_CLIENT_ID / MEDPLUM_CLIENT_SECRET.\n' +
        '  Creá un ClientApplication DENTRO del Project destino y cargá sus\n' +
        '  credenciales en .env. El Project del client determina dónde se instala.'
    );
  }

  const medplum = new MedplumClient({ baseUrl });
  try {
    await medplum.startClientLogin(clientId, clientSecret);
  } catch (e) {
    die(`\nNo se pudo autenticar contra ${baseUrl}: ${(e as Error).message}`);
  }

  // ── Mostrar el destino ANTES de escribir ──
  const project = medplum.getProject();
  console.log(`\nServidor: ${baseUrl}`);
  console.log(`Project destino: ${project?.name ?? '(desconocido)'} (id ${project?.id ?? '?'})`);
  console.log('Idempotente (PUT condicional): re-correr actualiza, no duplica.\n');

  // ── Instalar ──
  let ok = 0;
  const failures: string[] = [];
  for (const step of ready) {
    try {
      await medplum.executeBatch(step.bundle);
      console.log(`  ✓ ${step.label}`);
      ok++;
    } catch (e) {
      console.error(`  ✗ ${step.label}: ${(e as Error).message}`);
      failures.push(step.label);
    }
  }

  console.log(`\n✓ ${ok} paso(s) OK · ✗ ${failures.length} con error`);
  if (failures.length) process.exit(1);
  console.log('\nProject listo. Siguiente: cargar los datos con el migrador');
  console.log('  (src/cardiotox-mapping/migration/migrate.ts, empezando con --limit 5).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
