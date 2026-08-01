// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * EPA Bienestar IA — Cardio-Oncología Marie Curie
 * Migrador CLI: libro "Cardiotox" (Google Sheets, 9 hojas) → FHIR R4.
 *
 * Las hojas se exportan a CSV/TSV (una por hoja) y se unen por `DNI`: cada
 * paciente se sube como **un Bundle transaccional** con su Patient (`urn:uuid`)
 * y todos sus recursos referenciándolo, de modo que la transacción resuelve las
 * referencias internas. Todo idempotente (PUT por `identifier`): re-correr la
 * migración ACTUALIZA en vez de duplicar.
 *
 * Uso:
 *   tsx migrate.ts <cardiotox.csv> [hojas…] [opciones]      # DRY-RUN (default)
 *
 * Hojas adicionales (join por DNI):
 *   --echo  <csv>   Ecocardiogramas_control  (serie de eco/FEVI)
 *   --ecg   <csv>   Estudios_Complementarios (serie de ECG)
 *   --qt    <csv>   QT_cardiotox             (serie ECG/eco, foco QT)
 *   --frcv  <csv>   FRCV                     (capa CKM: meds + objetivos)
 *
 * Opciones:
 *   --inspect            Sólo reporta cobertura de encabezados (no escribe nada).
 *                        Úsalo PRIMERO contra el export real para ver qué
 *                        columnas no se reconocen antes de migrar.
 *   --include-orphans    Crea Patient mínimo para DNIs que sólo están en hojas
 *                        seriadas (por defecto se omiten con advertencia).
 *   --limit <N>          Procesa sólo los primeros N pacientes (smoke test).
 *   --tab                Los archivos son TSV.
 *   --out <ruta.json>    Destino del dry-run.
 *   --execute            Sube a Medplum (requiere credenciales).
 *
 * Credenciales (sólo --execute):
 *   MEDPLUM_BASE_URL   (default https://api.medplum.com.ar — se lee de .env)
 *   MEDPLUM_CLIENT_ID  MEDPLUM_CLIENT_SECRET
 */
import { MedplumClient } from '@medplum/core';
import type { Bundle } from '@medplum/fhirtypes';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { parseCsv, rowsToObjects } from './parsers';
import { joinWorkbook } from './workbook';
import type { SheetName, Workbook } from './workbook';

const DEFAULT_OUT = 'data/example/cardiotox-migration-dryrun.json';

/**
 * Servidor FHIR del proyecto — Favaloro | Medplum Argentina.
 * Debe coincidir con `MEDPLUM_BASE_URL` de `.env`; se deja explícito acá para
 * que un `--execute` sin la variable seteada NO escriba en otro servidor.
 */
const DEFAULT_BASE_URL = 'https://api.medplum.com.ar';

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

/** Flag de CLI → hoja del libro. */
const SHEET_FLAGS: Array<{ flag: string; sheet: SheetName }> = [
  { flag: '--echo', sheet: 'Ecocardiogramas_control' },
  { flag: '--ecg', sheet: 'Estudios_Complementarios' },
  { flag: '--qt', sheet: 'QT_cardiotox' },
  { flag: '--frcv', sheet: 'FRCV' },
];

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function die(msg: string): never {
  console.error(msg);
  process.exit(2);
}

function main(): Promise<void> {
  loadDotEnv();
  const args = process.argv.slice(2);
  const flagValues = new Set(SHEET_FLAGS.map((s) => flagValue(args, s.flag)).filter(Boolean));
  const spineFile = args.find((a) => !a.startsWith('--') && !flagValues.has(a) && a !== flagValue(args, '--out'));
  if (!spineFile) {
    die(
      'Falta el CSV de la hoja Cardiotox.\n' +
        '  Uso: tsx migrate.ts <cardiotox.csv> [--echo f] [--ecg f] [--qt f] [--frcv f] [--inspect] [--execute]'
    );
  }

  const delimiter = args.includes('--tab') ? '\t' : ',';
  const read = (f: string): Array<Record<string, string>> => rowsToObjects(parseCsv(readFileSync(f, 'utf-8'), delimiter));

  const sheets: Workbook['sheets'] = { Cardiotox: read(spineFile) };
  for (const { flag, sheet } of SHEET_FLAGS) {
    const f = flagValue(args, flag);
    if (f) sheets[sheet] = read(f);
  }

  const result = joinWorkbook({ sheets, includeOrphans: args.includes('--include-orphans') });

  console.log('━━━ Migrador Cardiotox → FHIR (join por DNI) ━━━');
  for (const c of result.coverage) {
    console.log(`\n▸ ${c.sheet} — ${c.rows} fila(s)`);
    if (c.sheet !== 'Cardiotox') {
      console.log(`  reconocidas (${c.matched.length}): ${c.matched.join(', ') || '—'}`);
      if (c.ignored.length) {
        console.log(`  ⚠ SIN MAPEAR (${c.ignored.length}): ${c.ignored.join(', ')}`);
      }
    }
  }

  console.log(`\nPacientes:        ${result.stats.patients}`);
  console.log(`Recursos:         ${result.stats.resources}`);
  console.log(`Entries fusionadas: ${result.stats.deduped}  (misma medición en dos hojas → un recurso)`);
  if (result.stats.orphanDnis.length) {
    console.log(`DNIs huérfanos:   ${result.stats.orphanDnis.join(', ')}`);
  }
  if (result.warnings.length) {
    console.warn(`\nAdvertencias (${result.warnings.length}):`);
    result.warnings.forEach((w) => console.warn(`  ⚠ ${w}`));
  }

  if (args.includes('--inspect')) {
    console.log('\n[inspect] Sin escribir ni subir nada. Revisá las columnas SIN MAPEAR y agregá sus alias antes de migrar.');
    return Promise.resolve();
  }

  // `--limit N` acota la corrida a los primeros N pacientes: la primera subida
  // real conviene hacerla con un puñado y verificar antes de mandar todo.
  const limit = Number(flagValue(args, '--limit') ?? NaN);
  const bundles = Number.isFinite(limit) && limit > 0 ? result.bundles.slice(0, limit) : result.bundles;
  if (bundles.length !== result.bundles.length) {
    console.log(`\n[limit] Se procesan los primeros ${bundles.length} de ${result.bundles.length} pacientes.`);
  }

  if (!args.includes('--execute')) {
    const out = flagValue(args, '--out') ?? DEFAULT_OUT;
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(bundles, null, 2));
    console.log(`\n[dry-run] ${bundles.length} Bundle(s) escritos en ${out}`);
    console.log('Para subir a Medplum: agregá --execute (requiere MEDPLUM_CLIENT_ID/SECRET).');
    return Promise.resolve();
  }

  return upload(bundles);
}

async function upload(bundles: Bundle[]): Promise<void> {
  const baseUrl = process.env.MEDPLUM_BASE_URL ?? DEFAULT_BASE_URL;
  const clientId = process.env.MEDPLUM_CLIENT_ID;
  const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    die(
      'Faltan MEDPLUM_CLIENT_ID / MEDPLUM_CLIENT_SECRET para --execute.\n' +
        '  Creá un ClientApplication en Medplum y exportá las credenciales, o cargalas en .env.'
    );
  }

  const resources = bundles.reduce((n, b) => n + (b.entry?.length ?? 0), 0);
  console.log(`\n━━━ SUBIDA REAL ━━━`);
  console.log(`Servidor: ${baseUrl}`);
  console.log(`Pacientes: ${bundles.length} · Recursos: ${resources}`);
  console.log('Idempotente (PUT por identifier): re-correr actualiza, no duplica.\n');

  const medplum = new MedplumClient({ baseUrl });
  try {
    await medplum.startClientLogin(clientId, clientSecret);
  } catch (e) {
    die(`No se pudo autenticar contra ${baseUrl}: ${(e as Error).message}`);
  }

  let ok = 0;
  const failures: Array<{ index: number; message: string }> = [];
  for (let i = 0; i < bundles.length; i++) {
    try {
      await medplum.executeBatch(bundles[i]);
      ok++;
    } catch (e) {
      failures.push({ index: i + 1, message: (e as Error).message });
    }
    // Progreso cada 25 pacientes (o al final) para no inundar la consola.
    if ((i + 1) % 25 === 0 || i === bundles.length - 1) {
      console.log(`  … ${i + 1}/${bundles.length}  (✓ ${ok} · ✗ ${failures.length})`);
    }
  }

  console.log(`\n✓ ${ok} OK · ✗ ${failures.length} con error`);
  if (failures.length) {
    console.error('\nPacientes con error (índice dentro de la corrida):');
    failures.slice(0, 20).forEach((f) => console.error(`  ✗ #${f.index}: ${f.message}`));
    if (failures.length > 20) console.error(`  … y ${failures.length - 20} más`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
