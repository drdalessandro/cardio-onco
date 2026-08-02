// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * EPA Bienestar IA — Cardio-Oncología Marie Curie
 * Auditoría de las AccessPolicy instaladas: `npm run check:policies`
 *
 * Responde cuatro preguntas que no se pueden contestar mirando el repo, porque
 * dependen del estado del servidor:
 *
 *   1. ¿Están instaladas las tres políticas?
 *   2. ¿`cardio-onco-patient` es la **default patient access policy**? ← crítico
 *   3. ¿Quién tiene asignada cada política? (usuarios, bots y clients)
 *   4. ¿Lo instalado coincide con `data/core/access-policies.json`, o alguien lo
 *      editó por consola y quedó a la deriva?
 *
 * Requiere el client de **administración**: la política de investigación no da
 * acceso a `AccessPolicy` ni a `ProjectMembership`, justamente para que un
 * agente no pueda leer ni cambiar los permisos (no escalada de privilegios).
 */
import { MedplumClient } from '@medplum/core';
import type { AccessPolicy, AccessPolicyResource, Bundle, ProjectMembership } from '@medplum/fhirtypes';
import { existsSync, readFileSync } from 'fs';

const DEFAULT_BASE_URL = 'https://api.medplum.com.ar';
const ESPERADAS = ['cardio-onco-patient', 'cardio-onco-clinician', 'cardio-onco-researcher'];
const ARCHIVO = 'data/core/access-policies.json';

function loadDotEnv(file = '.env'): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (m && m[2].trim() && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}

/** Firma comparable de una política: qué concede, sin ids ni metadatos. */
function firma(p: AccessPolicy): string {
  const entrada = (r: AccessPolicyResource): string =>
    [
      r.resourceType,
      r.compartment?.reference ?? '-',
      r.readonly ? 'ro' : '-',
      (r.interaction ?? []).slice().sort().join('+') || '-',
      (r.hiddenFields ?? []).slice().sort().join('+') || '-',
      (r.readonlyFields ?? []).slice().sort().join('+') || '-',
    ].join('|');
  return [p.compartment?.reference ?? '-', ...(p.resource ?? []).map(entrada).sort()].join('\n');
}

async function main(): Promise<void> {
  loadDotEnv();
  const baseUrl = process.env.MEDPLUM_BASE_URL ?? DEFAULT_BASE_URL;
  const clientId = process.env.MEDPLUM_CLIENT_ID;
  const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error(
      'Faltan MEDPLUM_CLIENT_ID / MEDPLUM_CLIENT_SECRET (las de ADMINISTRACIÓN).\n' +
        'La política de investigación no puede leer AccessPolicy — es a propósito.'
    );
    process.exit(2);
  }

  const medplum = new MedplumClient({ baseUrl });
  await medplum.startClientLogin(clientId, clientSecret);

  // `getProject()` devuelve el Project que vino en el login, que puede ser una
  // representación PARCIAL: si `defaultPatientAccessPolicy` no viene ahí, no
  // significa que no esté configurada. Se lee el recurso para estar seguros.
  const desdeLogin = medplum.getProject();
  let project = desdeLogin;
  let proyectoCompleto = false;
  if (desdeLogin?.id) {
    try {
      project = await medplum.readResource('Project', desdeLogin.id);
      proyectoCompleto = true;
    } catch {
      // Sin permiso para leer el Project: se sigue con lo del login, avisando.
    }
  }

  console.log('━━━ Auditoría de AccessPolicy ━━━');
  console.log(`Servidor: ${baseUrl}`);
  console.log(`Project:  ${project?.name ?? '(desconocido)'} (id ${project?.id ?? '?'})\n`);

  let problemas = 0;

  // ── 1. ¿Están las tres? ────────────────────────────────────────────────────
  console.log('1. Políticas instaladas');
  const instaladas = await medplum.searchResources('AccessPolicy', { _count: '100' } as never);
  const porNombre = new Map(instaladas.map((p) => [p.name ?? '', p]));

  for (const nombre of ESPERADAS) {
    const p = porNombre.get(nombre);
    if (p) {
      console.log(`  ✅ ${nombre}  (id ${p.id}, ${p.resource?.length ?? 0} recursos)`);
    } else {
      console.log(`  ❌ ${nombre} — NO instalada`);
      problemas++;
    }
  }
  const otras = instaladas.filter((p) => !ESPERADAS.includes(p.name ?? ''));
  if (otras.length) {
    // Medplum crea sus propias políticas por defecto al armar un Project: que
    // estén no es un problema, sólo hay que saber cuál manda (ver punto 2).
    const propias = otras.filter((p) => /^Default .* Access Policy$/.test(p.name ?? ''));
    if (propias.length) {
      console.log(`  ℹ️  ${propias.length} política(s) que trae Medplum por defecto (normal): ${propias.map((p) => p.name).join(', ')}`);
    }
    const ajenas = otras.filter((p) => !propias.includes(p));
    if (ajenas.length) {
      console.log(`  ⚠️  ${ajenas.length} política(s) ajenas al proyecto: ${ajenas.map((p) => p.name).join(', ')}`);
    }
  }

  // ── 2. Default patient access policy ── EL CONTROL CRÍTICO ─────────────────
  console.log('\n2. Default patient access policy  🔒');
  const def = project?.defaultPatientAccessPolicy;
  const esperada = porNombre.get('cardio-onco-patient');
  if (!def?.reference && !proyectoCompleto) {
    console.log('  ⚠️  No se pudo leer el Project completo, así que no se puede confirmar');
    console.log('      si la default patient access policy está configurada.');
    console.log('      Verificalo a mano: Medplum admin → Project → Default Patient Access Policy.');
    problemas++;
  } else if (!def?.reference) {
    console.log('  ❌ El Project NO tiene default patient access policy.');
    console.log('     Con el registro abierto, cada paciente que se registra entra SIN');
    console.log('     restricciones y puede leer datos de otros pacientes.');
    console.log('     → Medplum admin → Project → Default Patient Access Policy →');
    console.log('       elegir `cardio-onco-patient`.');
    problemas++;
  } else if (esperada && def.reference === `AccessPolicy/${esperada.id}`) {
    console.log(`  ✅ ${def.reference} → cardio-onco-patient`);
  } else {
    console.log(`  ❌ Apunta a ${def.reference}, que NO es cardio-onco-patient.`);
    problemas++;
  }

  // ── 3. Quién tiene qué ─────────────────────────────────────────────────────
  console.log('\n3. Asignaciones (ProjectMembership)');
  let memberships: ProjectMembership[] = [];
  let membershipsLegibles = true;
  try {
    memberships = (await medplum.searchResources('ProjectMembership', { _count: '200' } as never)) as ProjectMembership[];
  } catch (e) {
    // Leer ProjectMembership exige ser administrador DEL PROJECT, no alcanza
    // con un ClientApplication común. No es un problema de configuración de las
    // políticas, así que se informa y se sigue con el resto de la auditoría.
    membershipsLegibles = false;
    console.log(`  ⚠️  No se pudo leer ProjectMembership (${(e as Error).message}).`);
    console.log('      El ClientApplication no es administrador del Project. Verificá las');
    console.log('      asignaciones a mano en: Medplum admin → Project → Users.');
  }
  const porPolitica = new Map<string, number>();
  const sinPolitica: string[] = [];

  for (const m of memberships) {
    const tipo = m.profile?.reference?.split('/')[0] ?? '?';
    if (m.accessPolicy?.reference) {
      const id = m.accessPolicy.reference.split('/')[1];
      const nombre = instaladas.find((p) => p.id === id)?.name ?? m.accessPolicy.reference;
      porPolitica.set(nombre, (porPolitica.get(nombre) ?? 0) + 1);
    } else if (!m.admin) {
      sinPolitica.push(`${tipo}${m.profile?.display ? ` (${m.profile.display})` : ''}`);
    }
  }

  if (membershipsLegibles && porPolitica.size === 0) {
    console.log('  ⚠️  Ninguna membership tiene AccessPolicy asignada.');
  }
  for (const [nombre, n] of [...porPolitica].sort()) {
    console.log(`  · ${nombre}: ${n} membership(s)`);
  }
  if (membershipsLegibles) {
    const admins = memberships.filter((m) => m.admin).length;
    console.log(`  · administradores del Project: ${admins}`);
  }

  if (sinPolitica.length) {
    console.log(`\n  ⚠️  ${sinPolitica.length} membership(s) sin política y sin ser admin —`);
    console.log('      acceso completo al Project por omisión:');
    sinPolitica.slice(0, 10).forEach((x) => console.log(`        ${x}`));
    if (sinPolitica.length > 10) console.log(`        … y ${sinPolitica.length - 10} más`);
    problemas++;
  }

  // ── 4. ¿Coincide con el repo? ──────────────────────────────────────────────
  console.log('\n4. Deriva respecto del repo');
  if (!existsSync(ARCHIVO)) {
    console.log(`  ⚠️  No se encuentra ${ARCHIVO}; se omite la comparación.`);
  } else {
    const bundle = JSON.parse(readFileSync(ARCHIVO, 'utf-8')) as Bundle;
    const enRepo = new Map(
      (bundle.entry ?? []).map((e) => {
        const ap = e.resource as AccessPolicy;
        return [ap.name ?? '', ap];
      })
    );
    for (const nombre of ESPERADAS) {
      const local = enRepo.get(nombre);
      const remota = porNombre.get(nombre);
      if (!local || !remota) continue;
      if (firma(local) === firma(remota)) {
        console.log(`  ✅ ${nombre} — idéntica al repo`);
      } else {
        console.log(`  ⚠️  ${nombre} — DIFIERE del repo (alguien la editó por consola)`);
        console.log('      Correr `npm run upload:core` la vuelve a lo versionado.');
        problemas++;
      }
    }
  }

  // ── Cierre ─────────────────────────────────────────────────────────────────
  if (problemas > 0) {
    console.log(`\n━━━ ${problemas} problema(s) ━━━`);
    console.log('Resolvelos antes de abrir el registro a pacientes reales.');
    process.exit(1);
  }
  console.log('\n━━━ Políticas OK ━━━');
  console.log('Falta igual la prueba de intrusión del paso 5: con un paciente de prueba,');
  console.log('pedir por id una Observation de otro paciente y confirmar que da 403.');
}

main().catch((e) => {
  console.error('\n❌', e);
  process.exit(1);
});
