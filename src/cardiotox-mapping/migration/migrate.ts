// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * EPA Bienestar IA — Cardio-Oncología Marie Curie
 * Migrador CLI: export de la hoja "Cardiotox" (Google Sheets) → FHIR R4.
 *
 * Cada fila se sube como un Bundle TRANSACCIONAL propio: el Patient va como
 * `urn:uuid` y sus Observations/Conditions/etc. lo referencian, de modo que la
 * transacción resuelve las referencias internas. Todo es idempotente (PUT por
 * `identifier`): re-correr la migración ACTUALIZA en vez de duplicar.
 *
 * Uso:
 *   tsx migrate.ts <archivo.csv> [--tab] [--out <ruta.json>]   # DRY-RUN (default)
 *   tsx migrate.ts <archivo.csv> --execute                     # sube a Medplum
 *
 * DRY-RUN (default): no toca Medplum; escribe los Bundles a JSON y muestra un
 * resumen. `--tab` para export TSV. `--execute` sube a Medplum.
 *
 * Credenciales (sólo --execute):
 *   MEDPLUM_BASE_URL    (default https://api.epa-bienestar.com.ar/fhir)
 *   MEDPLUM_CLIENT_ID   MEDPLUM_CLIENT_SECRET
 */
import { MedplumClient } from '@medplum/core';
import type { Bundle, BundleEntry } from '@medplum/fhirtypes';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { mapCardiotoxRow } from './cardiotox-mapper';
import { parseCsv, rowsToObjects } from './parsers';

const DEFAULT_OUT = 'data/example/cardiotox-migration-dryrun.json';
const DEFAULT_BASE_URL = 'https://api.epa-bienestar.com.ar/fhir';

interface Cli {
  file: string;
  tab: boolean;
  execute: boolean;
  out: string;
}

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function parseArgs(argv: string[]): Cli {
  const args = argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('Falta el archivo CSV.\n  Uso: tsx migrate.ts <archivo.csv> [--tab] [--execute] [--out <ruta>]');
    process.exit(2);
  }
  return {
    file,
    tab: args.includes('--tab'),
    execute: args.includes('--execute'),
    out: flagValue(args, '--out') ?? DEFAULT_OUT,
  };
}

/** Envuelve las entries de una fila en un Bundle transaccional. */
function rowBundle(entry: BundleEntry[]): Bundle {
  return { resourceType: 'Bundle', type: 'transaction', entry };
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv);
  const raw = readFileSync(cli.file, 'utf-8');
  const rows = rowsToObjects(parseCsv(raw, cli.tab ? '\t' : ','));

  const bundles: Bundle[] = [];
  const warnings: string[] = [];
  let resourceCount = 0;

  rows.forEach((row, i) => {
    const res = mapCardiotoxRow(row);
    // fila humana = índice + 2 (encabezado + base 1)
    res.warnings.forEach((w) => warnings.push(`fila ${i + 2}: ${w}`));
    if (res.entries.length === 0) return;
    bundles.push(rowBundle(res.entries));
    resourceCount += res.entries.length;
  });

  console.log(`━━━ Migrador Cardiotox → FHIR ━━━`);
  console.log(`Filas leídas:    ${rows.length}`);
  console.log(`Pacientes:       ${bundles.length}`);
  console.log(`Recursos totales: ${resourceCount}`);
  if (warnings.length) {
    console.warn(`Advertencias (${warnings.length}):`);
    warnings.forEach((w) => console.warn(`  ⚠ ${w}`));
  }

  if (!cli.execute) {
    mkdirSync(dirname(cli.out), { recursive: true });
    writeFileSync(cli.out, JSON.stringify(bundles, null, 2));
    console.log(`\n[dry-run] ${bundles.length} Bundle(s) escritos en ${cli.out}`);
    console.log('Para subir a Medplum: agregá --execute (requiere MEDPLUM_CLIENT_ID/SECRET).');
    return;
  }

  const baseUrl = process.env.MEDPLUM_BASE_URL ?? DEFAULT_BASE_URL;
  const clientId = process.env.MEDPLUM_CLIENT_ID;
  const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('Faltan MEDPLUM_CLIENT_ID / MEDPLUM_CLIENT_SECRET para --execute.');
    process.exit(2);
  }

  const medplum = new MedplumClient({ baseUrl });
  await medplum.startClientLogin(clientId, clientSecret);
  console.log(`\nSubiendo a ${baseUrl} …`);

  let ok = 0;
  let fail = 0;
  for (let i = 0; i < bundles.length; i++) {
    try {
      await medplum.executeBatch(bundles[i]);
      ok++;
    } catch (e) {
      fail++;
      console.error(`  ✗ Bundle ${i + 1}/${bundles.length}: ${(e as Error).message}`);
    }
  }
  console.log(`\n✓ ${ok} OK · ✗ ${fail} con error`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
