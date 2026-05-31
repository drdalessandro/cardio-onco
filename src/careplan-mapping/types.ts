/**
 * EPA Bienestar IA — Cardio-Oncología Marie Curie
 * CarePlan/Task mapping types — ESC 2022 Guidelines on Cardiotoxicity
 */

export type RiskStratum = 'low' | 'moderate' | 'high' | 'very-high';

export interface CTRCDScoreInput {
  // Factores del agente oncológico
  anthracyclineDoseMgM2: number;          // Dosis acumulada proyectada de antraciclinas
  hasHighRiskAgent: boolean;              // Anti-HER2, VEGFR-TKI, checkpoint inhibitors, etc.
  mediastinalRadiotherapy: boolean;       // Radioterapia mediastinal previa o planificada

  // Factores cardiovasculares preexistentes
  hasPreexistingCVD: boolean;             // ECV estructural o funcional conocida
  hasHeartFailure: boolean;               // IC previa (cualquier FE)
  hasPreviousCTRCD: boolean;              // CTRCD previo por tratamiento anterior
  lvefBaseline: number;                   // FEVI basal (%)

  // Factores de riesgo cardiovascular
  hypertension: boolean;
  diabetes: boolean;
  dyslipidemia: boolean;
  currentSmoker: boolean;
  obesity: boolean;                       // IMC ≥ 30
  ckdEGFR: number;                        // TFGe ml/min/1.73m²
  age: number;
}

export interface TaskSchedule {
  planDefinitionId: string;
  planDefinitionTitle: string;
  description: string;
  periodDays: number;                     // frecuencia en días
  occurrences: number | 'ongoing';        // número de repeticiones o indefinido
  offsetDays: number;                     // días desde inicio del CarePlan para la primera task
  priority: 'routine' | 'urgent' | 'stat';
  performerRole: 'cardiologist' | 'nurse' | 'technologist';
  loinc?: string;
}

export interface RiskProtocol {
  stratum: RiskStratum;
  carePlanTitle: string;
  carePlanDescription: string;
  treatmentDurationMonths: number;
  followUpMonths: number;
  tasks: TaskSchedule[];
}

export const PLAN_DEFINITION_URLS: Record<string, string> = {
  'ecg-solo':          'https://api.epa-bienestar.com.ar/fhir/PlanDefinition/cardio-onco-ecg-solo',
  'ecg-ta':            'https://api.epa-bienestar.com.ar/fhir/PlanDefinition/cardio-onco-ecg-ta',
  'ecg-seguimiento':   'https://api.epa-bienestar.com.ar/fhir/PlanDefinition/cardio-onco-ecg-seguimiento',
  'baseline':          'https://api.epa-bienestar.com.ar/fhir/PlanDefinition/cardio-onco-baseline-comprehensive',
  'echo':              'https://api.epa-bienestar.com.ar/fhir/PlanDefinition/cardio-onco-echo-visit',
  'biomarker-lab':     'https://api.epa-bienestar.com.ar/fhir/PlanDefinition/cardio-onco-biomarker-lab',
  'risk-strat':        'https://api.epa-bienestar.com.ar/fhir/PlanDefinition/cardio-onco-risk-stratification',
};

// ─── Protocolos por estrato ESC 2022 ─────────────────────────────────────────

export const RISK_PROTOCOLS: Record<RiskStratum, RiskProtocol> = {

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
        periodDays: 0,
        occurrences: 1,
        offsetDays: 0,
        priority: 'routine',
        performerRole: 'cardiologist',
        loinc: '11524-6',
      },
      {
        planDefinitionId: 'echo',
        planDefinitionTitle: 'Ecocardiograma basal pre-tratamiento',
        description: 'ETT con FEVI, GLS, función diastólica. Documento basal obligatorio ESC 2022.',
        periodDays: 0,
        occurrences: 1,
        offsetDays: 3,
        priority: 'routine',
        performerRole: 'technologist',
        loinc: '59063-1',
      },
      {
        planDefinitionId: 'biomarker-lab',
        planDefinitionTitle: 'Laboratorio trimestral — Biomarcadores',
        description: 'TnI-as, NT-proBNP, panel metabólico. Sin ECG ni eco en misma visita.',
        periodDays: 90,
        occurrences: 'ongoing',
        offsetDays: 30,
        priority: 'routine',
        performerRole: 'nurse',
        loinc: '24323-8',
      },
      {
        planDefinitionId: 'echo',
        planDefinitionTitle: 'Ecocardiograma al finalizar tratamiento',
        description: 'ETT serial post-tratamiento. Comparar FEVI y GLS vs basal.',
        periodDays: 0,
        occurrences: 1,
        offsetDays: 180,    // aproximado fin de tratamiento 6 meses
        priority: 'routine',
        performerRole: 'technologist',
        loinc: '59063-1',
      },
      {
        planDefinitionId: 'echo',
        planDefinitionTitle: 'Ecocardiograma a 12 meses post-tratamiento',
        description: 'ETT de seguimiento tardío. Vigilancia cardiotoxicidad diferida.',
        periodDays: 0,
        occurrences: 1,
        offsetDays: 365,
        priority: 'routine',
        performerRole: 'technologist',
        loinc: '59063-1',
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
        periodDays: 0,
        occurrences: 1,
        offsetDays: 0,
        priority: 'routine',
        performerRole: 'cardiologist',
        loinc: '11524-6',
      },
      {
        planDefinitionId: 'echo',
        planDefinitionTitle: 'Ecocardiograma basal',
        description: 'ETT basal completo con GLS.',
        periodDays: 0,
        occurrences: 1,
        offsetDays: 3,
        priority: 'routine',
        performerRole: 'technologist',
        loinc: '59063-1',
      },
      {
        planDefinitionId: 'ecg-ta',
        planDefinitionTitle: 'ECG + PA mensual durante tratamiento',
        description: 'Monitoreo de QTc y detección de HTA inducida por tratamiento (TICH). Sin eco ni lab en esta visita.',
        periodDays: 28,
        occurrences: 'ongoing',
        offsetDays: 28,
        priority: 'routine',
        performerRole: 'nurse',
        loinc: '11524-6',
      },
      {
        planDefinitionId: 'echo',
        planDefinitionTitle: 'Ecocardiograma trimestral',
        description: 'ETT serial cada 3 meses. Sin ECG en misma visita.',
        periodDays: 90,
        occurrences: 'ongoing',
        offsetDays: 90,
        priority: 'routine',
        performerRole: 'technologist',
        loinc: '59063-1',
      },
      {
        planDefinitionId: 'biomarker-lab',
        planDefinitionTitle: 'Laboratorio cada 6 semanas',
        description: 'TnI-as + NT-proBNP + panel metabólico. Flujo autónomo enfermería.',
        periodDays: 42,
        occurrences: 'ongoing',
        offsetDays: 14,
        priority: 'routine',
        performerRole: 'nurse',
        loinc: '24323-8',
      },
      {
        planDefinitionId: 'ecg-seguimiento',
        planDefinitionTitle: 'Consulta cardio-oncológica de seguimiento trimestral',
        description: 'Evaluación clínica integral + ECG. Sin eco ni lab en misma visita.',
        periodDays: 90,
        occurrences: 'ongoing',
        offsetDays: 60,
        priority: 'routine',
        performerRole: 'cardiologist',
        loinc: '11524-6',
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
        periodDays: 0,
        occurrences: 1,
        offsetDays: 0,
        priority: 'routine',
        performerRole: 'cardiologist',
        loinc: '11524-6',
      },
      {
        planDefinitionId: 'echo',
        planDefinitionTitle: 'Ecocardiograma basal',
        description: 'ETT basal completo. GLS obligatorio en riesgo alto.',
        periodDays: 0,
        occurrences: 1,
        offsetDays: 2,
        priority: 'routine',
        performerRole: 'technologist',
        loinc: '59063-1',
      },
      {
        planDefinitionId: 'ecg-solo',
        planDefinitionTitle: 'ECG quincenal',
        description: 'ECG de monitoreo cada 2 semanas durante tratamiento activo. Solo ECG, sin PA ni consulta.',
        periodDays: 14,
        occurrences: 'ongoing',
        offsetDays: 14,
        priority: 'routine',
        performerRole: 'nurse',
        loinc: '11524-6',
      },
      {
        planDefinitionId: 'ecg-ta',
        planDefinitionTitle: 'ECG + PA semanal en inducción',
        description: 'Control semanal de QTc y PA durante ciclos de inducción. Detección precoz de TICH.',
        periodDays: 7,
        occurrences: 12,     // primeras 12 semanas de tratamiento
        offsetDays: 7,
        priority: 'routine',
        performerRole: 'nurse',
        loinc: '55284-4',
      },
      {
        planDefinitionId: 'echo',
        planDefinitionTitle: 'Ecocardiograma cada 6 semanas',
        description: 'Vigilancia serial de FEVI y GLS. Comparación con basal. Sin ECG en misma visita.',
        periodDays: 42,
        occurrences: 'ongoing',
        offsetDays: 42,
        priority: 'routine',
        performerRole: 'technologist',
        loinc: '59063-1',
      },
      {
        planDefinitionId: 'biomarker-lab',
        planDefinitionTitle: 'Laboratorio mensual',
        description: 'TnI-as, NT-proBNP, panel metabólico mensual. Sin ECG ni eco el mismo día.',
        periodDays: 30,
        occurrences: 'ongoing',
        offsetDays: 21,
        priority: 'routine',
        performerRole: 'nurse',
        loinc: '24323-8',
      },
      {
        planDefinitionId: 'ecg-seguimiento',
        planDefinitionTitle: 'Consulta cardio-oncológica mensual',
        description: 'Evaluación clínica integral + ECG mensual. Decisión terapéutica documentada.',
        periodDays: 30,
        occurrences: 'ongoing',
        offsetDays: 30,
        priority: 'routine',
        performerRole: 'cardiologist',
        loinc: '11524-6',
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
        periodDays: 0,
        occurrences: 1,
        offsetDays: 0,
        priority: 'routine',
        performerRole: 'cardiologist',
        loinc: '11524-6',
      },
      {
        planDefinitionId: 'echo',
        planDefinitionTitle: 'Ecocardiograma basal',
        description: 'ETT basal. GLS + speckle tracking obligatorio. Confirmar FEVI ≥ 40% para iniciar.',
        periodDays: 0,
        occurrences: 1,
        offsetDays: 1,
        priority: 'urgent',
        performerRole: 'technologist',
        loinc: '59063-1',
      },
      {
        planDefinitionId: 'ecg-solo',
        planDefinitionTitle: 'ECG quincenal',
        description: 'ECG cada 2 semanas. Monitoreo QTc, arritmias, isquemia silente.',
        periodDays: 14,
        occurrences: 'ongoing',
        offsetDays: 14,
        priority: 'routine',
        performerRole: 'nurse',
        loinc: '11524-6',
      },
      {
        planDefinitionId: 'ecg-ta',
        planDefinitionTitle: 'ECG + PA cada 5 días',
        description: 'Monitoreo intensivo. QTc + PA cada 5 días durante tratamiento activo.',
        periodDays: 5,
        occurrences: 'ongoing',
        offsetDays: 5,
        priority: 'routine',
        performerRole: 'nurse',
        loinc: '55284-4',
      },
      {
        planDefinitionId: 'echo',
        planDefinitionTitle: 'Ecocardiograma cada 6 semanas',
        description: 'ETT serial cada 6 semanas. Alerta automática si FEVI cae > 10% o GLS deteriora > 15%.',
        periodDays: 42,
        occurrences: 'ongoing',
        offsetDays: 42,
        priority: 'routine',
        performerRole: 'technologist',
        loinc: '59063-1',
      },
      {
        planDefinitionId: 'biomarker-lab',
        planDefinitionTitle: 'Laboratorio mensual intensivo',
        description: 'TnI-as, NT-proBNP, panel metabólico completo mensual. Sin ECG ni eco el mismo día.',
        periodDays: 30,
        occurrences: 'ongoing',
        offsetDays: 15,
        priority: 'routine',
        performerRole: 'nurse',
        loinc: '24323-8',
      },
      {
        planDefinitionId: 'ecg-seguimiento',
        planDefinitionTitle: 'Consulta cardio-oncológica quincenal',
        description: 'Evaluación clínica + ECG cada 2 semanas. Decisión multidisciplinaria documentada.',
        periodDays: 14,
        occurrences: 'ongoing',
        offsetDays: 14,
        priority: 'routine',
        performerRole: 'cardiologist',
        loinc: '11524-6',
      },
      {
        planDefinitionId: 'ecg-seguimiento',
        planDefinitionTitle: 'Alerta urgente 24h ante evento cardíaco',
        description: 'Task de alerta activada automáticamente si TnI > URL, FEVI < 40% o QTc > 500ms. Requiere contacto en 24h.',
        periodDays: 0,
        occurrences: 1,
        offsetDays: 0,
        priority: 'stat',
        performerRole: 'cardiologist',
      },
    ],
  },
};
