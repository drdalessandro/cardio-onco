/**
 * EPA Bienestar IA — Cardio-Oncología Marie Curie
 * Bot Medplum: createCarePlanFromRisk
 *
 * Flujo:
 *   QuestionnaireResponse (score CTRCD) → calcularRiesgo() → crearCarePlan() + crearTasks()
 *
 * Deploy: npx medplum deploy-bot --bot cardio-onco-create-careplan
 * Trigger: QuestionnaireResponse?questionnaire=cardio-onco-risk-stratification
 */

import {
  BotEvent,
  MedplumClient,
} from '@medplum/core';
import {
  Bundle,
  BundleEntry,
  CarePlan,
  CarePlanActivity,
  Patient,
  Practitioner,
  QuestionnaireResponse,
  QuestionnaireResponseItem,
  Task,
  Reference,
} from '@medplum/fhirtypes';

import {
  CTRCDScoreInput,
  PLAN_DEFINITION_URLS,
  RISK_PROTOCOLS,
  RiskProtocol,
  RiskStratum,
  TaskSchedule,
} from './types';

// ─── Punto de entrada del Bot ─────────────────────────────────────────────────

export async function handler(medplum: MedplumClient, event: BotEvent): Promise<void> {
  const qr = event.input as QuestionnaireResponse;

  if (!qr.subject?.reference) {
    throw new Error('QuestionnaireResponse sin subject (Patient reference)');
  }

  const patientRef = qr.subject as Reference<Patient>;
  const patientId  = patientRef.reference!.split('/')[1];

  // 1. Extraer datos del score del QR
  const scoreInput = extractScoreFromQR(qr);

  // 2. Calcular estrato de riesgo ESC 2022
  const stratum = calculateCTRCDRisk(scoreInput);
  console.log(`[cardio-onco-bot] Paciente ${patientId} → estrato: ${stratum}`);

  // 3. Obtener el Practitioner del contexto (Aquieri o Crosa — Marie Curie)
  const practitioner = await resolvePractitioner(medplum, qr);

  // 4. Crear CarePlan + Tasks en una transacción Bundle
  const bundle = buildCarePlanBundle(patientRef, practitioner, stratum, qr);

  // 5. Ejecutar transacción en Medplum
  const result = await medplum.executeBatch(bundle);

  const carePlanEntry = result.entry?.find(
    (e) => e.resource?.resourceType === 'CarePlan'
  );

  console.log(
    `[cardio-onco-bot] CarePlan creado: ${carePlanEntry?.resource?.id} | ` +
    `Tasks: ${result.entry?.filter(e => e.resource?.resourceType === 'Task').length}`
  );
}

// ─── Extracción de datos del QuestionnaireResponse ───────────────────────────

function extractScoreFromQR(qr: QuestionnaireResponse): CTRCDScoreInput {
  const getItem = (linkId: string): QuestionnaireResponseItem | undefined =>
    qr.item?.find((i) => i.linkId === linkId);

  const getBool = (linkId: string): boolean =>
    getItem(linkId)?.answer?.[0]?.valueBoolean ?? false;
  const getNum  = (linkId: string): number =>
    getItem(linkId)?.answer?.[0]?.valueDecimal  ?? 0;
  const getInt  = (linkId: string): number =>
    getItem(linkId)?.answer?.[0]?.valueInteger  ?? 0;

  return {
    anthracyclineDoseMgM2:   getNum('anthracycline-dose'),
    hasHighRiskAgent:        getBool('high-risk-agent'),
    mediastinalRadiotherapy: getBool('mediastinal-rt'),
    hasPreexistingCVD:       getBool('preexisting-cvd'),
    hasHeartFailure:         getBool('heart-failure'),
    hasPreviousCTRCD:        getBool('previous-ctrcd'),
    lvefBaseline:            getNum('lvef-baseline'),
    hypertension:            getBool('hypertension'),
    diabetes:                getBool('diabetes'),
    dyslipidemia:            getBool('dyslipidemia'),
    currentSmoker:           getBool('current-smoker'),
    obesity:                 getBool('obesity'),
    ckdEGFR:                 getNum('ckd-egfr'),
    age:                     getInt('age'),
  };
}

// ─── Algoritmo de estratificación CTRCD ESC 2022 ─────────────────────────────

export function calculateCTRCDRisk(s: CTRCDScoreInput): RiskStratum {

  // Muy alto — cualquier criterio es suficiente
  if (
    s.hasHeartFailure                                            ||
    s.hasPreviousCTRCD                                          ||
    s.lvefBaseline < 50                                         ||
    (s.hasPreexistingCVD && s.anthracyclineDoseMgM2 > 250)     ||
    (s.mediastinalRadiotherapy && s.hasPreexistingCVD)
  ) {
    return 'very-high';
  }

  // Alto — 2+ factores o 1 factor + agente de alto riesgo
  const highFactors = [
    s.hasPreexistingCVD,
    s.anthracyclineDoseMgM2 > 350,
    s.mediastinalRadiotherapy,
    s.hasHighRiskAgent && s.anthracyclineDoseMgM2 > 200,
    s.lvefBaseline >= 50 && s.lvefBaseline < 55,
    s.ckdEGFR < 30,
  ].filter(Boolean).length;

  if (highFactors >= 2 || (highFactors >= 1 && s.hasHighRiskAgent)) {
    return 'high';
  }

  // Contar FRCV
  const frcvCount = [
    s.hypertension,
    s.diabetes,
    s.dyslipidemia,
    s.currentSmoker,
    s.obesity,
    s.age >= 65,
    s.ckdEGFR < 60,
  ].filter(Boolean).length;

  const isModerate =
    frcvCount >= 2                                             ||
    (s.anthracyclineDoseMgM2 >= 200 && s.anthracyclineDoseMgM2 <= 350) ||
    (s.hasHighRiskAgent && frcvCount >= 1)                     ||
    highFactors >= 1;

  return isModerate ? 'moderate' : 'low';
}

// ─── Construcción del Bundle transaccional ────────────────────────────────────

export function buildCarePlanBundle(
  patientRef:   Reference<Patient>,
  practitioner: Reference<Practitioner> | undefined,
  stratum:      RiskStratum,
  sourceQR:     QuestionnaireResponse,
): Bundle {
  const protocol   = RISK_PROTOCOLS[stratum];
  const today      = new Date();
  const carePlanId = `urn:uuid:careplan-${stratum}-${Date.now()}`;

  const entries: BundleEntry[] = [];

  // ── CarePlan ────────────────────────────────────────────────────────────────
  const carePlan: CarePlan = {
    resourceType: 'CarePlan',
    status:       'active',
    intent:       'plan',
    title:        protocol.carePlanTitle,
    description:  protocol.carePlanDescription,
    subject:      patientRef,
    period: {
      start: today.toISOString().split('T')[0],
      end:   addMonths(today, protocol.treatmentDurationMonths + protocol.followUpMonths)
               .toISOString().split('T')[0],
    },
    instantiatesCanonical: [PLAN_DEFINITION_URLS['risk-strat']],
    category: [
      {
        coding: [{
          system:  'http://snomed.info/sct',
          code:    '734163000',
          display: 'Care plan',
        }],
      },
    ],
    author:       practitioner,
    supportingInfo: [{
      reference: `QuestionnaireResponse/${sourceQR.id}`,
      display:   'Score CTRCD ESC 2022',
    }],
    note: [{
      text: `Estrato de riesgo ESC 2022: ${stratum.toUpperCase()}. ` +
            `Generado por Bot cardio-onco-create-careplan. ` +
            `Visitas distribuidas: principio ESC 2022 de no acumulación diagnóstica.`,
      time: today.toISOString(),
    }],
    activity: buildActivityReferences(protocol),
    extension: [
      {
        url:       'https://api.epa-bienestar.com.ar/fhir/StructureDefinition/ctrcd-risk-stratum',
        valueCode: stratum,
      },
      {
        url:         'https://api.epa-bienestar.com.ar/fhir/StructureDefinition/esc-guideline-year',
        valueString: '2022',
      },
    ],
  };

  entries.push({
    fullUrl:  carePlanId,
    resource: carePlan,
    request:  { method: 'POST', url: 'CarePlan' },
  });

  // ── Tasks ────────────────────────────────────────────────────────────────────
  for (const taskDef of protocol.tasks) {
    const tasks = buildTasks(taskDef, patientRef, practitioner, carePlanId, today);
    for (const task of tasks) {
      entries.push({
        fullUrl:  `urn:uuid:task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        resource: task,
        request:  { method: 'POST', url: 'Task' },
      });
    }
  }

  return { resourceType: 'Bundle', type: 'transaction', entry: entries };
}

// ─── Tasks individuales ───────────────────────────────────────────────────────

function buildTasks(
  def:          TaskSchedule,
  patientRef:   Reference<Patient>,
  practitioner: Reference<Practitioner> | undefined,
  carePlanId:   string,
  startDate:    Date,
): Task[] {
  const tasks: Task[] = [];
  const pdUrl = PLAN_DEFINITION_URLS[def.planDefinitionId];
  const count = def.occurrences === 'ongoing'
    ? Math.ceil(180 / Math.max(def.periodDays, 1))
    : def.occurrences;

  for (let i = 0; i < count; i++) {
    const due = addDays(startDate, def.offsetDays + def.periodDays * i);

    const task: Task = {
      resourceType: 'Task',
      status:       'requested',
      intent:       'plan',
      priority:     def.priority,
      code: {
        coding: def.loinc
          ? [{ system: 'http://loinc.org', code: def.loinc, display: def.planDefinitionTitle }]
          : [],
        text: def.planDefinitionTitle,
      },
      description:  def.description,
      for:          patientRef,
      authoredOn:   new Date().toISOString(),
      requester:    practitioner,
      owner:        def.performerRole === 'cardiologist' ? practitioner : undefined,
      executionPeriod: {
        start: due.toISOString().split('T')[0],
        end:   addDays(due, 7).toISOString().split('T')[0],
      },
      basedOn: [{ reference: carePlanId, display: 'CarePlan cardio-oncológico' }],
      instantiatesCanonical: pdUrl,
      note: [{
        text: `Visita ${i + 1}/${count} — ${def.planDefinitionTitle}. ` +
              `NO combinar con otras visitas diagnósticas el mismo día (ESC 2022).`,
      }],
      extension: [
        {
          url:          'https://api.epa-bienestar.com.ar/fhir/StructureDefinition/visit-sequence-number',
          valueInteger: i + 1,
        },
        {
          url:         'https://api.epa-bienestar.com.ar/fhir/StructureDefinition/no-bundle-with-others',
          valueBoolean: true,
        },
      ],
    };

    tasks.push(task);
  }

  return tasks;
}

// ─── Activity references ──────────────────────────────────────────────────────

function buildActivityReferences(protocol: RiskProtocol): CarePlanActivity[] {
  return protocol.tasks.map((def) => ({
    plannedActivityDetail: {
      kind:  'Task' as const,
      code: {
        coding: def.loinc
          ? [{ system: 'http://loinc.org', code: def.loinc, display: def.planDefinitionTitle }]
          : [],
        text: def.planDefinitionTitle,
      },
      status:      'not-started' as const,
      description: def.description,
      scheduledTiming: def.periodDays > 0 ? {
        repeat: { frequency: 1, period: def.periodDays, periodUnit: 'd' as const },
      } : undefined,
      instantiatesCanonical: [PLAN_DEFINITION_URLS[def.planDefinitionId] ?? ''],
    },
  }));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolvePractitioner(
  medplum:    MedplumClient,
  qr:         QuestionnaireResponse,
): Promise<Reference<Practitioner> | undefined> {
  if (qr.author?.reference?.startsWith('Practitioner/')) {
    return qr.author as Reference<Practitioner>;
  }
  try {
    const results = await medplum.searchResources('Practitioner', {
      identifier: 'MN-114729',   // Dr. Aquieri — Marie Curie
    });
    if (results.length > 0) {
      return { reference: `Practitioner/${results[0].id}`, display: 'Dr. Aquieri' };
    }
  } catch {
    console.warn('[cardio-onco-bot] Practitioner no resuelto, continuando sin owner.');
  }
  return undefined;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}
