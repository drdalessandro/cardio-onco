// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * EPA Bienestar IA — Cardio-Oncología Marie Curie
 * Servidor MCP de investigación: "hablar con los datos" sobre FHIR.
 *
 * ── Principio de diseño ─────────────────────────────────────────────────────
 * El modelo **no escribe consultas**. Elige una herramienta y le pasa
 * parámetros tipados; el servidor arma la búsqueda FHIR. Esto no es una
 * limitación técnica sino la propiedad que hace usable el sistema:
 *
 *   · Auditable — cada respuesta trae la consulta exacta que la produjo.
 *   · Reproducible — el investigador puede re-correr esa consulta a mano.
 *   · Acotado — no hay forma de que el agente escape del AccessPolicy.
 *
 * ── Seguridad ───────────────────────────────────────────────────────────────
 * Se conecta con las credenciales del perfil `cardio-onco-researcher`:
 * **sólo lectura y seudonimizado** (sin nombre, contacto, domicilio,
 * identificadores ni texto libre; ver `docs/access-policies.md`). El servidor
 * no puede escribir aunque se lo pidan: no expone ninguna herramienta de
 * escritura y el servidor rechazaría el intento.
 *
 * Uso (stdio, para Claude Code / Claude Desktop):
 *   MEDPLUM_CLIENT_ID=… MEDPLUM_CLIENT_SECRET=… tsx src/research/mcp-server.ts
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { MedplumClient } from '@medplum/core';
import type { Observation, Patient } from '@medplum/fhirtypes';
import { existsSync, readFileSync } from 'fs';
import { z } from 'zod';
import { CONDITION_CODES, CHEMO_FAMILIES, OBSERVATION_CODES, RISK_SCORES } from '../cardiotox-mapping/data-dictionary';
import type { CohortCriteria, FhirQuery, SeriesPoint } from './cohort';
import {
  advertenciasDe, buildCohortQueries, CTRCD_DEFAULT, describir, detectarCaidaFevi, MEDIDAS_DISPONIBLES,
} from './cohort';

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

/** Formatea la consulta para que el investigador pueda repetirla tal cual. */
function renderQuery(q: FhirQuery): string {
  const qs = new URLSearchParams(q.params).toString();
  return `${q.resourceType}?${qs}   # ${q.proposito}`;
}

/** Respuesta estándar: dato + procedencia + advertencias. */
function respond(data: unknown, queries: FhirQuery[], advertencias: string[]): { content: { type: 'text'; text: string }[] } {
  const partes = [JSON.stringify(data, null, 2)];
  if (advertencias.length) {
    partes.push('\n⚠️ Advertencias metodológicas:\n' + advertencias.map((a) => `  · ${a}`).join('\n'));
  }
  partes.push('\n🔎 Consultas ejecutadas (reproducibles):\n' + queries.map((q) => '  ' + renderQuery(q)).join('\n'));
  return { content: [{ type: 'text', text: partes.join('\n') }] };
}

/** Extrae el id de paciente de una referencia `Patient/xxx`. */
function patientId(ref: string | undefined): string | undefined {
  return ref?.startsWith('Patient/') ? ref.slice('Patient/'.length) : undefined;
}

async function main(): Promise<void> {
  loadDotEnv();
  const baseUrl = process.env.MEDPLUM_BASE_URL ?? DEFAULT_BASE_URL;
  const clientId = process.env.MEDPLUM_CLIENT_ID;
  const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error(
      'Faltan MEDPLUM_CLIENT_ID / MEDPLUM_CLIENT_SECRET.\n' +
        'Usá las credenciales de un ClientApplication con la AccessPolicy `cardio-onco-researcher`.'
    );
    process.exit(2);
  }

  const medplum = new MedplumClient({ baseUrl });
  await medplum.startClientLogin(clientId, clientSecret);

  const server = new McpServer({ name: 'cardio-onco-research', version: '1.0.0' });

  // ── Esquema: qué se puede preguntar ────────────────────────────────────────
  // Sin esto el modelo adivina códigos LOINC. Con esto, consulta el diccionario.
  server.tool(
    'describir_datos',
    'Qué datos existen y con qué códigos consultarlos: mediciones (LOINC), diagnósticos (ICD-10), familias de quimioterapia (ATC) y scores de riesgo. Llamar SIEMPRE antes de construir una cohorte, para no inventar códigos.',
    {},
    async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              mediciones: MEDIDAS_DISPONIBLES,
              diagnosticos: CONDITION_CODES.map((c) => ({ icd10: c.icd10, display: c.display })),
              quimioterapia: CHEMO_FAMILIES.map((f) => ({ atc: f.atc, display: f.display, altoRiesgo: !!f.highCardiotoxRisk })),
              scores: Object.values(RISK_SCORES).map((s) => ({ method: s.method, display: s.display })),
              nota:
                'Los datos autorreportados por el paciente tienen category=survey y performer=Patient; ' +
                'el dato clínico verificado no. Distinguirlos al analizar.',
            },
            null,
            2
          ),
        },
      ],
    })
  );

  // ── Cohortes ──────────────────────────────────────────────────────────────
  server.tool(
    'buscar_cohorte',
    'Cuenta e identifica los pacientes que cumplen criterios combinados (demografía, diagnóstico, fármaco, valor de una medición). Devuelve ids seudonimizados, nunca nombres.',
    {
      sexo: z.enum(['male', 'female', 'other', 'unknown']).optional(),
      edadMin: z.number().int().min(0).max(120).optional(),
      edadMax: z.number().int().min(0).max(120).optional(),
      diagnosticos: z.array(z.string()).optional().describe('Códigos ICD-10 (ver describir_datos)'),
      farmacos: z.array(z.string()).optional().describe('Códigos ATC de familia (ver describir_datos)'),
      medicionCode: z.string().optional().describe('Código LOINC a filtrar'),
      medicionOp: z.enum(['eq', 'lt', 'le', 'gt', 'ge']).optional(),
      medicionValor: z.number().optional(),
    },
    async (args) => {
      const criteria: CohortCriteria = {
        sexo: args.sexo,
        edadMin: args.edadMin,
        edadMax: args.edadMax,
        diagnosticos: args.diagnosticos,
        farmacos: args.farmacos,
        medicion:
          args.medicionCode && args.medicionOp && args.medicionValor !== undefined
            ? { code: args.medicionCode, op: args.medicionOp, valor: args.medicionValor }
            : undefined,
      };
      const queries = buildCohortQueries(criteria);
      if (queries.length === 0) {
        return respond({ error: 'Sin criterios: especificá al menos uno.' }, [], []);
      }

      // Una consulta por criterio; la intersección se hace sobre los ids
      // porque FHIR search no hace joins entre tipos de recurso.
      let interseccion: Set<string> | undefined;
      for (const q of queries) {
        const resultados = await medplum.searchResources(q.resourceType as 'Patient', q.params as never);
        const ids = new Set<string>(
          resultados
            .map((r) =>
              q.resourceType === 'Patient'
                ? (r as Patient).id
                : patientId((r as { subject?: { reference?: string } }).subject?.reference)
            )
            .filter((id): id is string => !!id)
        );
        interseccion = interseccion ? new Set([...interseccion].filter((id) => ids.has(id))) : ids;
      }

      const ids = [...(interseccion ?? [])];
      return respond({ n: ids.length, pacientes: ids }, queries, advertenciasDe(ids.length));
    }
  );

  // ── Distribución de una medición ──────────────────────────────────────────
  server.tool(
    'distribucion',
    'Estadística descriptiva (n, media, mediana, cuartiles, desvío) de una medición en un conjunto de pacientes. Si no se pasan pacientes, usa toda la cohorte accesible.',
    {
      code: z.string().describe('Código LOINC de la medición'),
      pacientes: z.array(z.string()).optional().describe('Ids de buscar_cohorte; vacío = todos'),
      soloUltimoValor: z.boolean().optional().describe('Un valor por paciente (el más reciente) en vez de todos'),
    },
    async ({ code, pacientes, soloUltimoValor }) => {
      const params: Record<string, string> = { code, _count: '2000', _elements: 'id,subject,valueQuantity,effectiveDateTime' };
      const query: FhirQuery = { resourceType: 'Observation', params, proposito: `Todos los valores de ${code}` };
      const obs = await medplum.searchResources('Observation', params as never);

      const permitidos = pacientes?.length ? new Set(pacientes) : undefined;
      const filtradas = (obs as Observation[]).filter((o) => {
        const pid = patientId(o.subject?.reference);
        return pid && (!permitidos || permitidos.has(pid));
      });

      let valores: number[];
      if (soloUltimoValor) {
        const ultimo = new Map<string, Observation>();
        for (const o of filtradas) {
          const pid = patientId(o.subject?.reference)!;
          const prev = ultimo.get(pid);
          if (!prev || (o.effectiveDateTime ?? '') > (prev.effectiveDateTime ?? '')) {
            ultimo.set(pid, o);
          }
        }
        valores = [...ultimo.values()].map((o) => o.valueQuantity?.value!).filter((v) => v !== undefined);
      } else {
        valores = filtradas.map((o) => o.valueQuantity?.value!).filter((v) => v !== undefined);
      }

      const pacientesConDato = new Set(filtradas.map((o) => patientId(o.subject?.reference)!)).size;
      const stats = describir(valores);
      const advertencias = advertenciasDe(pacientesConDato, pacientes?.length);
      const unidad = MEDIDAS_DISPONIBLES.find((m) => m.code === code)?.unit;

      return respond({ code, unidad, pacientesConDato, ...stats }, [query], advertencias);
    }
  );

  // ── Trayectoria de un paciente ────────────────────────────────────────────
  server.tool(
    'trayectoria',
    'Serie temporal de una medición para un paciente: cómo evolucionó en el tiempo.',
    {
      pacienteId: z.string(),
      code: z.string().describe('Código LOINC'),
    },
    async ({ pacienteId, code }) => {
      const params = {
        code,
        patient: `Patient/${pacienteId}`,
        _sort: 'date',
        _count: '200',
        _elements: 'id,valueQuantity,effectiveDateTime',
      };
      const obs = await medplum.searchResources('Observation', params as never);
      const serie: SeriesPoint[] = (obs as Observation[])
        .filter((o) => o.valueQuantity?.value !== undefined && o.effectiveDateTime)
        .map((o) => ({ fecha: o.effectiveDateTime!, valor: o.valueQuantity!.value! }));

      const query: FhirQuery = { resourceType: 'Observation', params, proposito: `Serie de ${code} del paciente` };
      return respond({ pacienteId, code, n: serie.length, serie }, [query], serie.length < 2 ? ['Menos de dos mediciones: no hay trayectoria.'] : []);
    }
  );

  // ── Caída de FEVI (cardiotoxicidad) ───────────────────────────────────────
  server.tool(
    'caida_fevi',
    'Detecta caída de FEVI en una lista de pacientes. Por defecto usa el criterio CTRCD de la guía ESC 2022 (caída ≥10 puntos absolutos hasta FEVI <50%), pero los umbrales son parámetros explícitos: el motor no decide el criterio por el investigador.',
    {
      pacientes: z.array(z.string()).describe('Ids de buscar_cohorte'),
      caidaAbsolutaMin: z.number().optional().describe(`Default ${CTRCD_DEFAULT.caidaAbsolutaMin} puntos (ESC 2022)`),
      feviFinalMax: z.number().optional().describe(`Default ${CTRCD_DEFAULT.feviFinalMax}% (ESC 2022)`),
    },
    async ({ pacientes, caidaAbsolutaMin, feviFinalMax }) => {
      const umbral = {
        caidaAbsolutaMin: caidaAbsolutaMin ?? CTRCD_DEFAULT.caidaAbsolutaMin,
        feviFinalMax: feviFinalMax ?? CTRCD_DEFAULT.feviFinalMax,
      };
      const lvef = OBSERVATION_CODES.lvef.code;
      const queries: FhirQuery[] = [];
      const resultados: unknown[] = [];
      let cumplen = 0;
      let sinTrayectoria = 0;

      for (const pid of pacientes) {
        const params = {
          code: lvef,
          patient: `Patient/${pid}`,
          _sort: 'date',
          _count: '100',
          _elements: 'valueQuantity,effectiveDateTime',
        };
        const obs = await medplum.searchResources('Observation', params as never);
        const serie: SeriesPoint[] = (obs as Observation[])
          .filter((o) => o.valueQuantity?.value !== undefined && o.effectiveDateTime)
          .map((o) => ({ fecha: o.effectiveDateTime!, valor: o.valueQuantity!.value! }));

        const caida = detectarCaidaFevi(serie, umbral);
        if (!caida) {
          sinTrayectoria++;
          continue;
        }
        if (caida.cumpleCriterio) {
          cumplen++;
        }
        resultados.push({ pacienteId: pid, ...caida });
      }

      queries.push({
        resourceType: 'Observation',
        params: { code: lvef, patient: `Patient/{id}`, _sort: 'date' },
        proposito: `Serie de FEVI por paciente (${pacientes.length} consultas)`,
      });

      const evaluables = pacientes.length - sinTrayectoria;
      const advertencias = advertenciasDe(evaluables, pacientes.length);
      if (sinTrayectoria > 0) {
        advertencias.push(
          `${sinTrayectoria} de ${pacientes.length} pacientes tienen menos de dos mediciones de FEVI: quedan fuera del denominador, no cuentan como "sin caída".`
        );
      }
      advertencias.push(`Criterio aplicado: caída ≥${umbral.caidaAbsolutaMin} puntos y FEVI final <${umbral.feviFinalMax}%.`);

      return respond(
        { evaluables, cumplenCriterio: cumplen, sinTrayectoria, umbral, detalle: resultados },
        queries,
        advertencias
      );
    }
  );

  // ── Cohortes guardadas ────────────────────────────────────────────────────
  server.tool(
    'listar_cohortes',
    'Cohortes definidas como recursos FHIR (Group) y estudios (ResearchStudy) del proyecto.',
    {},
    async () => {
      const groups = await medplum.searchResources('Group', { _count: '100' } as never);
      const studies = await medplum.searchResources('ResearchStudy', { _count: '100' } as never);
      return respond(
        {
          cohortes: groups.map((g) => ({ id: g.id, name: g.name, quantity: g.quantity, actual: g.actual })),
          estudios: studies.map((s) => ({ id: s.id, title: s.title, status: s.status })),
        },
        [
          { resourceType: 'Group', params: { _count: '100' }, proposito: 'Cohortes definidas' },
          { resourceType: 'ResearchStudy', params: { _count: '100' }, proposito: 'Estudios del proyecto' },
        ],
        []
      );
    }
  );

  await server.connect(new StdioServerTransport());
  console.error(`[research-mcp] conectado a ${baseUrl} con perfil de investigación (sólo lectura)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
