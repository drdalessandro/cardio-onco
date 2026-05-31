/**
 * EPA Bienestar IA — Cardio-Oncología Marie Curie
 * Bot Medplum: createCarePlanFromRisk
 *
 * Flujo:
 *   QuestionnaireResponse (score CTRCD) → calcularRiesgo() → crearCarePlan() + crearTasks()
 *
 * IMPORTANTE: Este archivo debe ser autocontenido (sin imports relativos).
 * El runtime Lambda de Medplum ejecuta un único archivo .mjs.
 *
 * Deploy: pegar este archivo completo en Bot → Editor → Deploy
 * Trigger: QuestionnaireResponse?questionnaire=cardio-onco-risk-stratification&status=completed
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

// ─── Types (inlineados — no usar import relativo en Bot Medplum) ──────────────

type RiskStratum = 'low' | 'moderate' | 'high' | 'very-high';

interface CTRCDScoreInput {
  anthracyclineDoseMgM2: number;
  hasHighRiskAgent: boolean;
  mediastinalRadiotherapy: boolean;
  hasPreexistingCVD: boolean;
  hasHeartFailure: boolean;
  hasPreviousCTRCD: boolean;
  lvefBaseline: number;
  hypertension: boolean;
  diabetes: boolean;
  dyslipidemia: boolean;
  currentSmoker: boolean;
  obesity: boolean;
  ckdEGFR: number;
  age: number;
}

interface TaskSchedule {
  planDefinitionId: string;
  planDefinitionTitle: string;
  description: string;
  periodDays: number;
  occurrences: number | 'ongoing';
  offsetDays: number;
  priority: 'routine' | 'urgent' | 'stat';
  performerRole: 'cardiologist' | 'nurse' | 'technologist';
  loinc?: string;
}

interface RiskProtocol {
  stratum: RiskStratum;
  carePlanTitle: string;
  carePlanDescription: string;
  treatmentDurationMonths: number;
  followUpMonths: number;
  tasks: TaskSchedule[];
}

const PLAN_DEFINITION_URLS: Record<string, string> = {
  'ecg-solo':        'https://api.epa-bienestar.com.ar/fhir/PlanDefinition/cardio-onco-ecg-solo',
  'ecg-ta':          'https://api.epa-bienestar.com.ar/fhir/PlanDefinition/cardio-onco-ecg-ta',
  'ecg-seguimiento': 'https://api.epa-bienestar.com.ar/fhir/PlanDefinition/cardio-onco-ecg-seguimiento',
  'baseline':        'https://api.epa-bienestar.com.ar/fhir/PlanDefinition/cardio-onco-baseline-comprehensive',
  'echo':            'https://api.epa-bienestar.com.ar/fhir/PlanDefinition/cardio-onco-echo-visit',
  'biomarker-lab':   'https://api.epa-bienestar.com.ar/fhir/PlanDefinition/cardio-onco-biomarker-lab',
  'risk-strat':      'https://api.epa-bienestar.com.ar/fhir/PlanDefinition/cardio-onco-risk-stratification',
};

const RISK_PROTOCOLS: Record<RiskStratum, RiskProtocol> = {
  low: {
    stratum: 'low',
    carePlanTitle: 'Protocolo cardio-oncológico — Riesgo bajo ESC 2022',
    carePlanDescription:
      'Sin cardiopatía previa, sin FRCV mayor, antraciclinas < 200 mg/m². ' +
      'ECG y eco solo en puntos clave. Lab trimestral.',
    treatmentDurationMonths: 6,
    followUpMonths: 12,
    tasks: [
      {
        planDefinitionId: 'ecg-solo',
        planDefinitionTitle: 'ECG basal pre-tratamiento',
        description: 'ECG de 12 derivaciones basal antes de iniciar tratamiento oncológico. Evaluar QTc, ritmo.',
        periodDays: 0, occurrences: 1, offsetDays: 0,
        priority: 'routine', performerRole: 'cardiologist', loinc: '11524-6',
      },
      {
        planDefinitionId: 'echo',
        planDefinitionTitle: 'Ecocardiograma basal pre-tratamiento',
        description: 'ETT con FEVI, GLS, función diastólica. Documento basal obligatorio ESC 2022.',
        periodDays: 0, occurrences: 1, offsetDays: 3,
        priority: 'routine', performerRole: 'technologist', loinc: '59063-1',
      },
      {
        planDefinitionId: 'biomarker-lab',
        planDefinitionTitle: 'Laboratorio trimestral — Biomarcadores',
        description: 'TnI-as, NT-proBNP, panel metabólico. Sin ECG ni eco en misma visita.',
        periodDays: 90, occurrences: 'ongoing', offsetDays: 30,
        priority: 'routine', performerRole: 'nurse', loinc: '24323-8',
      },
      {
        planDefinitionId: 'echo',
        planDefinitionTitle: 'Ecocardiograma al finalizar tratamiento',
        description: 'ETT serial post-tratamiento. Comparar FEVI y GLS vs basal.',
        periodDays: 0, occurrences: 1, offsetDays: 180,
        priority: 'routine', performerRole: 'technologist', loinc: '59063-1',
      },
      {
        planDefinitionId: 'echo',
        planDefinitionTitle: 'Ecocardiograma a 12 meses post-tratamiento',
        description: 'ETT de seguimiento tardío. Vigilancia cardiotoxicidad diferida.',
        periodDays: 0, occurrences: 1, offsetDays: 365,
        priority: 'routine', performerRole: 'technologist', loinc: '59063-1',
      },
    ],
  },

  moderate: {
    stratum: 'moderate',
    carePlanTitle: 'Protocolo cardio-oncológico — Riesgo moderado ESC 2022',
    carePlanDescription:
      '1-2 FRCV o antraciclinas 200-350 mg/m². ECG+PA mensual, eco cada 3 meses, ' +
      'lab cada 6 semanas, consulta de seguimiento trimestral.',
    treatmentDurationMonths: 6,
    followUpMonths: 24,
    tasks: [
      {
        planDefinitionId: 'ecg-solo',
        planDefinitionTitle: 'ECG basal',
        description: 'ECG pre-tratamiento basal.',
        periodDays: 0, occurrences: 1, offsetDays: 0,
        priority: 'routine', performerRole: 'cardiologist', loinc: '11524-6',
      },
      {
        planDefinitionId: 'echo',
        planDefinitionTitle: 'Ecocardiograma basal',
        description: 'ETT basal completo con GLS.',
        periodDays: 0, occurrences: 1, offsetDays: 3,
        priority: 'routine', performerRole: 'technologist', loinc: '59063-1',
      },
      {
        planDefinitionId: 'ecg-ta',
        planDefinitionTitle: 'ECG + PA mensual durante tratamiento',
        description: 'Monitoreo de QTc y detección de HTA inducida por tratamiento (TICH). Sin eco ni lab en esta visita.',
        periodDays: 28, occurrences: 'ongoing', offsetDays: 28,
        priority: 'routine', performerRole: 'nurse', loinc: '11524-6',
      },
      {
        planDefinitionId: 'echo',
        planDefinitionTitle: 'Ecocardiograma trimestral',
        description: 'ETT serial cada 3 meses. Sin ECG en misma visita.',
        periodDays: 90, occurrences: 'ongoing', offsetDays: 90,
        priority: 'routine', performerRole: 'technologist', loinc: '59063-1',
      },
      {
        planDefinitionId: 'biomarker-lab',
        planDefinitionTitle: 'Laboratorio cada 6 semanas',
        description: 'TnI-as + NT-proBNP + panel metabólico. Flujo autónomo enfermería.',
        periodDays: 42, occurrences: 'ongoing', offsetDays: 14,
        priority: 'routine', performerRole: 'nurse', loinc: '24323-8',
      },
      {
        planDefinitionId: 'ecg-seguimiento',
        planDefinitionTitle: 'Consulta cardio-oncológica de seguimiento trimestral',
        description: 'Evaluación clínica integral + ECG. Sin eco ni lab en misma visita.',
        periodDays: 90, occurrences: 'ongoing', offsetDays: 60,
        priority: 'routine', performerRole: 'cardiologist', loinc: '11524-6',
      },
    ],
  },

  high: {
    stratum: 'high',
    carePlanTitle: 'Protocolo cardio-oncológico — Riesgo alto ESC 2022',
    carePlanDescription:
      'ECV preexistente o antraciclinas > 350 mg/m² o radioterapia mediastinal previa. ' +
      'ECG quincenal, ECG+PA semanal, eco cada 6 semanas, lab mensual, seguimiento mensual.',
    treatmentDurationMonths: 6,
    followUpMonths: 36,
    tasks: [
      {
        planDefinitionId: 'ecg-solo',
        planDefinitionTitle: 'ECG basal',
        description: 'ECG basal antes de iniciar. Revisión cardiológica completa obligatoria.',
        periodDays: 0, occurrences: 1, offsetDays: 0,
        priority: 'routine', performerRole: 'cardiologist', loinc: '11524-6',
      },
      {
        planDefinitionId: 'echo',
        planDefinitionTitle: 'Ecocardiograma basal',
        description: 'ETT basal completo. GLS obligatorio en riesgo alto.',
        periodDays: 0, occurrences: 1, offsetDays: 2,
        priority: 'routine', performerRole: 'technologist', loinc: '59063-1',
      },
      {
        planDefinitionId: 'ecg-solo',
        planDefinitionTitle: 'ECG quincenal',
        description: 'ECG de monitoreo cada 2 semanas durante tratamiento activo. Solo ECG, sin PA ni consulta.',
        periodDays: 14, occurrences: 'ongoing', offsetDays: 14,
        priority: 'routine', performerRole: 'nurse', loinc: '11524-6',
      },
      {
        planDefinitionId: 'ecg-ta',
        planDefinitionTitle: 'ECG + PA semanal en inducción',
        description: 'Control semanal de QTc y PA durante ciclos de inducción. Detección precoz de TICH.',
        periodDays: 7, occurrences: 12, offsetDays: 7,
        priority: 'routine', performerRole: 'nurse', loinc: '55284-4',
      },
      {
        planDefinitionId: 'echo',
        planDefinitionTitle: 'Ecocardiograma cada 6 semanas',
        description: 'Vigilancia serial de FEVI y GLS. Comparación con basal. Sin ECG en misma visita.',
        periodDays: 42, occurrences: 'ongoing', offsetDays: 42,
        priority: 'routine', performerRole: 'technologist', loinc: '59063-1',
      },
      {
        planDefinitionId: 'biomarker-lab',
        planDefinitionTitle: 'Laboratorio mensual',
        description: 'TnI-as, NT-proBNP, panel metabólico mensual. Sin ECG ni eco el mismo día.',
        periodDays: 30, occurrences: 'ongoing', offsetDays: 21,
        priority: 'routine', performerRole: 'nurse', loinc: '24323-8',
      },
      {
        planDefinitionId: 'ecg-seguimiento',
        planDefinitionTitle: 'Consulta cardio-oncológica mensual',
        description: 'Evaluación clínica integral + ECG mensual. Decisión terapéutica documentada.',
        periodDays: 30, occurrences: 'ongoing', offsetDays: 30,
        priority: 'routine', performerRole: 'cardiologist', loinc: '11524-6',
      },
    ],
  },

  'very-high': {
    stratum: 'very-high',
    carePlanTitle: 'Protocolo cardio-oncológico — Riesgo muy alto ESC 2022',
    carePlanDescription:
      'IC preexistente, FEVI < 50%, CTRCD previo, o combinación de múltiples factores de alto riesgo. ' +
      'Vigilancia intensiva. ECG quincenal, ECG+PA cada 5 días, eco cada 6 semanas, ' +
      'lab mensual, seguimiento quincenal, alerta urgente 24h ante evento.',
    treatmentDurationMonths: 6,
    followUpMonths: 60,
    tasks: [
      {
        planDefinitionId: 'ecg-solo',
        planDefinitionTitle: 'ECG basal',
        description: 'ECG basal. Revisión multidisciplinaria cardio-oncológica previa al inicio.',
        periodDays: 0, occurrences: 1, offsetDays: 0,
        priority: 'routine', performerRole: 'cardiologist', loinc: '11524-6',
      },
      {
        planDefinitionId: 'echo',
        planDefinitionTitle: 'Ecocardiograma basal',
        description: 'ETT basal. GLS + speckle tracking obligatorio. Confirmar FEVI ≥ 40% para iniciar.',
        periodDays: 0, occurrences: 1, offsetDays: 1,
        priority: 'urgent', performerRole: 'technologist', loinc: '59063-1',
      },
      {
        planDefinitionId: 'ecg-solo',
        planDefinitionTitle: 'ECG quincenal',
        description: 'ECG cada 2 semanas. Monitoreo QTc, arritmias, isquemia silente.',
        periodDays: 14, occurrences: 'ongoing', offsetDays: 14,
        priority: 'routine', performerRole: 'nurse', loinc: '11524-6',
      },
      {
        planDefinitionId: 'ecg-ta',
        planDefinitionTitle: 'ECG + PA cada 5 días',
        description: 'Monitoreo intensivo. QTc + PA cada 5 días durante tratamiento activo.',
        periodDays: 5, occurrences: 'ongoing', offsetDays: 5,
        priority: 'routine', performerRole: 'nurse', loinc: '55284-4',
      },
      {
        planDefinitionId: 'echo',
        planDefinitionTitle: 'Ecocardiograma cada 6 semanas',
        description: 'ETT serial cada 6 semanas. Alerta automática si FEVI cae > 10% o GLS deteriora > 15%.',
        periodDays: 42, occurrences: 'ongoing', offsetDays: 42,
        priority: 'routine', performerRole: 'technologist', loinc: '59063-1',
      },
      {
        planDefinitionId: 'biomarker-lab',
        planDefinitionTitle: 'Laboratorio mensual intensivo',
        description: 'TnI-as, NT-proBNP, panel metabólico completo mensual. Sin ECG ni eco el mismo día.',
        periodDays: 30, occurrences: 'ongoing', offsetDays: 15,
        priority: 'routine', performerRole: 'nurse', loinc: '24323-8',
      },
      {
        planDefinitionId: 'ecg-seguimiento',
        planDefinitionTitle: 'Consulta cardio-oncológica quincenal',
        description: 'Evaluación clínica + ECG cada 2 semanas. Decisión multidisciplinaria documentada.',
        periodDays: 14, occurrences: 'ongoing', offsetDays: 14,
        priority: 'routine', performerRole: 'cardiologist', loinc: '11524-6',
      },
      {
        planDefinitionId: 'ecg-seguimiento',
        planDefinitionTitle: 'Alerta urgente 24h ante evento cardíaco',
        description: 'Task de alerta activada automáticamente si TnI > URL, FEVI < 40% o QTc > 500ms. Requiere contacto en 24h.',
        periodDays: 0, occurrences: 1, offsetDays: 0,
        priority: 'stat', performerRole: 'cardiologist',
      },
    ],
  },
};

// ─── Punto de entrada del Bot ─────────────────────────────────────────────────

export async function handler(medplum: MedplumClient, event: BotEvent): Promise<void> {
  const qr = event.input as QuestionnaireResponse;

  if (!qr.subject?.reference) {
    throw new Error('QuestionnaireResponse sin subject (Patient reference)');
  }

  const patientRef = qr.subject as Reference<Patient>;
  const patientId  = patientRef.reference!.split('/')[1];

  const scoreInput = extractScoreFromQR(qr);
  const stratum    = calculateCTRCDRisk(scoreInput);
  console.log(`[cardio-onco-bot] Paciente ${patientId} → estrato: ${stratum}`);

  const practitioner = await resolvePractitioner(medplum, qr);
  const bundle       = buildCarePlanBundle(patientRef, practitioner, stratum, qr);
  const result       = await medplum.executeBatch(bundle);

  const carePlanEntry = result.entry?.find((e) => e.resource?.resourceType === 'CarePlan');
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
  if (
    s.hasHeartFailure ||
    s.hasPreviousCTRCD ||
    s.lvefBaseline < 50 ||
    (s.hasPreexistingCVD && s.anthracyclineDoseMgM2 > 250) ||
    (s.mediastinalRadiotherapy && s.hasPreexistingCVD)
  ) {
    return 'very-high';
  }

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

  const frcvCount = [
    s.hypertension, s.diabetes, s.dyslipidemia, s.currentSmoker,
    s.obesity, s.age >= 65, s.ckdEGFR < 60,
  ].filter(Boolean).length;

  const isModerate =
    frcvCount >= 2 ||
    (s.anthracyclineDoseMgM2 >= 200 && s.anthracyclineDoseMgM2 <= 350) ||
    (s.hasHighRiskAgent && frcvCount >= 1) ||
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
    category: [{
      coding: [{ system: 'http://snomed.info/sct', code: '734163000', display: 'Care plan' }],
    }],
    author: practitioner,
    supportingInfo: [{ reference: `QuestionnaireResponse/${sourceQR.id}`, display: 'Score CTRCD ESC 2022' }],
    note: [{
      text: `Estrato de riesgo ESC 2022: ${stratum.toUpperCase()}. ` +
            `Generado por Bot cardio-onco-create-careplan. ` +
            `Visitas distribuidas: principio ESC 2022 de no acumulación diagnóstica.`,
      time: today.toISOString(),
    }],
    activity: buildActivityReferences(protocol),
    extension: [
      { url: 'https://api.epa-bienestar.com.ar/fhir/StructureDefinition/ctrcd-risk-stratum', valueCode: stratum },
      { url: 'https://api.epa-bienestar.com.ar/fhir/StructureDefinition/esc-guideline-year', valueString: '2022' },
    ],
  };

  entries.push({ fullUrl: carePlanId, resource: carePlan, request: { method: 'POST', url: 'CarePlan' } });

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
    tasks.push({
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
        { url: 'https://api.epa-bienestar.com.ar/fhir/StructureDefinition/visit-sequence-number', valueInteger: i + 1 },
        { url: 'https://api.epa-bienestar.com.ar/fhir/StructureDefinition/no-bundle-with-others', valueBoolean: true },
      ],
    });
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
      scheduledTiming: def.periodDays > 0
        ? { repeat: { frequency: 1, period: def.periodDays, periodUnit: 'd' as const } }
        : undefined,
      instantiatesCanonical: [PLAN_DEFINITION_URLS[def.planDefinitionId] ?? ''],
    },
  }));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolvePractitioner(
  medplum: MedplumClient,
  qr:      QuestionnaireResponse,
): Promise<Reference<Practitioner> | undefined> {
  if (qr.author?.reference?.startsWith('Practitioner/')) {
    return qr.author as Reference<Practitioner>;
  }
  try {
    const results = await medplum.searchResources('Practitioner', { identifier: 'MN-114729' });
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
