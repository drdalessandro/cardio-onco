// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * EPA Bienestar IA — Cardio-Oncología Marie Curie
 * Diagnóstico de la capa de investigación: `npm run research:check`
 *
 * El servidor MCP se conecta al arrancar, así que si algo falta muere ahí y
 * Claude lo muestra como "failed" sin decir por qué. Este script separa las
 * causas posibles y las prueba **una por una, en orden**, para que el
 * diagnóstico salga de una sola corrida en vez de por descarte.
 *
 * Se detiene en el primer problema: cada chequeo depende del anterior.
 */
import { MedplumClient } from '@medplum/core';
import { existsSync, readFileSync } from 'fs';

const DEFAULT_BASE_URL = 'https://api.medplum.com.ar';

function loadDotEnv(file = '.env'): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (m && m[2].trim() && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}

const ok = (msg: string): void => console.log(`  ✅ ${msg}`);
function bad(msg: string, ayuda: string): never {
  console.log(`  ❌ ${msg}`);
  console.log(`\n     Cómo resolverlo:\n     ${ayuda.split('\n').join('\n     ')}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  loadDotEnv();
  console.log('━━━ Diagnóstico de la capa de investigación ━━━\n');

  // ── 1. Credenciales ────────────────────────────────────────────────────────
  console.log('1. Credenciales');
  const baseUrl = process.env.MEDPLUM_BASE_URL ?? DEFAULT_BASE_URL;
  // El MCP recibe las MEDPLUM_RESEARCH_* renombradas a MEDPLUM_CLIENT_* por
  // `.mcp.json`; acá se aceptan las dos formas para poder correrlo suelto.
  const clientId = process.env.MEDPLUM_RESEARCH_CLIENT_ID ?? process.env.MEDPLUM_CLIENT_ID;
  const clientSecret = process.env.MEDPLUM_RESEARCH_CLIENT_SECRET ?? process.env.MEDPLUM_CLIENT_SECRET;

  if (clientId === undefined || clientSecret === undefined) {
    bad(
      'Faltan las credenciales',
      'export MEDPLUM_RESEARCH_CLIENT_ID=…\n' +
        'export MEDPLUM_RESEARCH_CLIENT_SECRET=…\n\n' +
        'Son las del ClientApplication con AccessPolicy = cardio-onco-researcher,\n' +
        'NO las de administración del .env (esas pueden escribir).'
    );
  }
  ok(`client id ${clientId.slice(0, 8)}… presente`);
  if (process.env.MEDPLUM_RESEARCH_CLIENT_ID === undefined && process.env.MEDPLUM_CLIENT_ID) {
    console.log('  ⚠️  Estás usando MEDPLUM_CLIENT_ID (administración). Para el agente');
    console.log('      conviene el client de investigación: sólo lectura y seudonimizado.');
  }

  // ── 2. Red ─────────────────────────────────────────────────────────────────
  console.log(`\n2. Red → ${baseUrl}`);
  try {
    const res = await fetch(`${baseUrl}/healthcheck`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      // Un 403 acá suele NO venir del servidor sino de un proxy que bloquea el
      // host: `fetch` lo ve como respuesta válida y el chequeo daría un falso
      // positivo si no se mirara el status.
      bad(
        `respuesta HTTP ${res.status} en ${baseUrl}/healthcheck`,
        (res.status === 403 || res.status === 407
          ? 'Un 403/407 en el healthcheck casi siempre es un PROXY bloqueando el\nhost, no el servidor rechazando. Es lo que pasa en Claude Code EN LA WEB.\nEl servidor MCP tiene que correr en tu máquina.\n\n'
          : '') + 'Verificá que MEDPLUM_BASE_URL sea correcto y que el servidor esté arriba.'
      );
    }
    ok(`el servidor responde (HTTP ${res.status})`);
  } catch (e) {
    bad(
      `no se llega a ${baseUrl}`,
      `${(e as Error).message}\n\n` +
        'Si estás en Claude Code EN LA WEB, esto es esperable: el contenedor\n' +
        'remoto no tiene salida a ese host. El servidor MCP tiene que correr\n' +
        'en tu máquina (Claude Code CLI o Claude Desktop).'
    );
  }

  // ── 3. Autenticación ───────────────────────────────────────────────────────
  console.log('\n3. Autenticación');
  const medplum = new MedplumClient({ baseUrl });
  try {
    await medplum.startClientLogin(clientId, clientSecret);
    ok('credenciales aceptadas');
  } catch (e) {
    bad(
      'el servidor rechazó las credenciales',
      `${(e as Error).message}\n\n` +
        'Revisá que el ClientApplication exista y que el secret sea el correcto.'
    );
  }

  const project = medplum.getProject();
  console.log(`  → Project: ${project?.name ?? '(desconocido)'} (id ${project?.id ?? '?'})`);

  // ── 4. Datos ───────────────────────────────────────────────────────────────
  console.log('\n4. Datos para consultar');
  const cuenta = async (tipo: string, params: Record<string, string> = {}): Promise<number> => {
    const bundle = await medplum.search(tipo as 'Patient', { ...params, _summary: 'count', _count: '0' } as never);
    return bundle.total ?? 0;
  };

  const pacientes = await cuenta('Patient');
  if (pacientes === 0) {
    bad(
      'no hay ningún Patient en el Project',
      'Falta migrar. Ver docs/puesta-en-marcha.md pasos 4 a 7:\n' +
        '  npm run bootstrap -- --execute\n' +
        '  migrate.ts … --include-orphans --execute'
    );
  }
  ok(`${pacientes} Patient`);

  const pendientes: string[] = [];
  const fevi = await cuenta('Observation', { code: '8806-2' });
  const cohortes = await cuenta('Group');
  const estudios = await cuenta('ResearchStudy');

  console.log(`  ${fevi > 0 ? '✅' : '⚠️ '} ${fevi} Observation de FEVI (LOINC 8806-2)`);
  console.log(`  ${cohortes > 0 ? '✅' : '⚠️ '} ${cohortes} Group (cohortes)`);
  console.log(`  ${estudios > 0 ? '✅' : '⚠️ '} ${estudios} ResearchStudy`);

  if (fevi === 0) {
    pendientes.push('No hay ninguna FEVI cargada: falta la migración (pasos 6–7).');
  }
  if (cohortes === 0 || estudios === 0) {
    pendientes.push('Faltan las cohortes (Group/ResearchStudy): corré `npm run upload:core` (paso 4).');
  }
  if (pacientes < 10) {
    pendientes.push(`Sólo ${pacientes} Patient: parece que todavía no se migró la planilla.`);
  }

  // ── 5. La política de investigación está activa ────────────────────────────
  console.log('\n5. Perfil de investigación (seudonimización)');
  const muestra = await medplum.searchResources('Patient', { _count: '1' } as never);
  const p = muestra[0];
  if (p?.name?.length || p?.telecom?.length) {
    // BLOQUEANTE, no advertencia: si el Patient llega con datos identificatorios,
    // este client no tiene la política de investigación. Conectar el agente así
    // le daría acceso a PHI — y, si es el client de administración, permiso de
    // escritura sobre la historia clínica.
    bad(
      'los Patient llegan con datos identificatorios: NO es el perfil de investigación',
      'Estás usando un ClientApplication sin `AccessPolicy = cardio-onco-researcher`\n' +
        '(probablemente el de administración, que además puede ESCRIBIR).\n\n' +
        'Creá un ClientApplication aparte, asignale la AccessPolicy\n' +
        '`cardio-onco-researcher` y usá esas credenciales:\n\n' +
        '  export MEDPLUM_RESEARCH_CLIENT_ID=…\n' +
        '  export MEDPLUM_RESEARCH_CLIENT_SECRET=…\n\n' +
        'Ver docs/access-policies.md y el paso 1 de docs/puesta-en-marcha.md.'
    );
  }
  ok('los Patient llegan sin datos identificatorios (hiddenFields aplicado)');

  // Sólo se declara "listo" si no quedó nada pendiente.
  if (pendientes.length > 0) {
    console.log('\n━━━ Falta completar ━━━');
    pendientes.forEach((x) => console.log(`  · ${x}`));
    console.log('\nEl MCP va a conectar igual, pero el agente tendría poco o nada que consultar.');
    process.exit(1);
  }

  console.log('\n━━━ Todo listo ━━━');
  console.log('El servidor MCP debería conectar. Probalo con:  npm run research:mcp');
}

main().catch((e) => {
  console.error('\n❌ Error inesperado:', e);
  process.exit(1);
});
