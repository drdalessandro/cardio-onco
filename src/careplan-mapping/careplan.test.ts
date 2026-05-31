/**
 * EPA Bienestar IA — Tests: scoring CTRCD + CarePlan/Task generation
 * npx jest cardio-onco-careplan.test.ts
 */

import { calculateCTRCDRisk, buildCarePlanBundle } from './bot';
import { CTRCDScoreInput, RISK_PROTOCOLS }         from './types';

// ─── Casos clínicos representativos ESC 2022 ─────────────────────────────────

const BASE_INPUT: CTRCDScoreInput = {
  anthracyclineDoseMgM2:   0,
  hasHighRiskAgent:        false,
  mediastinalRadiotherapy: false,
  hasPreexistingCVD:       false,
  hasHeartFailure:         false,
  hasPreviousCTRCD:        false,
  lvefBaseline:            65,
  hypertension:            false,
  diabetes:                false,
  dyslipidemia:            false,
  currentSmoker:           false,
  obesity:                 false,
  ckdEGFR:                 90,
  age:                     45,
};

describe('Algoritmo CTRCD ESC 2022', () => {

  test('Paciente joven sin FRCV, sin antraciclinas → bajo', () => {
    expect(calculateCTRCDRisk(BASE_INPUT)).toBe('low');
  });

  test('Paciente con 2 FRCV + antraciclinas 250 mg/m² → moderado', () => {
    expect(calculateCTRCDRisk({
      ...BASE_INPUT,
      hypertension:          true,
      diabetes:              true,
      anthracyclineDoseMgM2: 250,
    })).toBe('moderate');
  });

  test('Agente alto riesgo + ECV preexistente → alto', () => {
    expect(calculateCTRCDRisk({
      ...BASE_INPUT,
      hasHighRiskAgent:  true,
      hasPreexistingCVD: true,
    })).toBe('high');
  });

  test('Antraciclinas > 350 mg/m² + HTA + DM → alto', () => {
    expect(calculateCTRCDRisk({
      ...BASE_INPUT,
      anthracyclineDoseMgM2: 380,
      hypertension:          true,
      diabetes:              true,
    })).toBe('high');
  });

  test('IC preexistente → muy alto (criterio absoluto)', () => {
    expect(calculateCTRCDRisk({
      ...BASE_INPUT,
      hasHeartFailure: true,
    })).toBe('very-high');
  });

  test('CTRCD previo → muy alto (criterio absoluto)', () => {
    expect(calculateCTRCDRisk({
      ...BASE_INPUT,
      hasPreviousCTRCD: true,
    })).toBe('very-high');
  });

  test('FEVI basal 45% → muy alto', () => {
    expect(calculateCTRCDRisk({
      ...BASE_INPUT,
      lvefBaseline: 45,
    })).toBe('very-high');
  });

  test('RT mediastinal + ECV preexistente → muy alto', () => {
    expect(calculateCTRCDRisk({
      ...BASE_INPUT,
      mediastinalRadiotherapy: true,
      hasPreexistingCVD:       true,
    })).toBe('very-high');
  });
});

describe('Protocolo de visitas — principio de no acumulación', () => {

  test('Riesgo bajo: ECO y ECG no coinciden en el mismo día (offset diferente)', () => {
    const protocol = RISK_PROTOCOLS['low'];
    const ecgTask  = protocol.tasks.find(t => t.planDefinitionId === 'ecg-solo');
    const echoTask = protocol.tasks.find(t => t.planDefinitionId === 'echo' && t.occurrences === 1);
    expect(ecgTask?.offsetDays).not.toBe(echoTask?.offsetDays);
  });

  test('Riesgo moderado: Lab y ECO tienen periodos diferentes (no se superponen en semana 1)', () => {
    const protocol = RISK_PROTOCOLS['moderate'];
    const labTask  = protocol.tasks.find(t => t.planDefinitionId === 'biomarker-lab');
    const echoTask = protocol.tasks.find(t => t.planDefinitionId === 'echo' && t.occurrences === 'ongoing');
    expect(labTask?.periodDays).not.toBe(echoTask?.periodDays);
  });

  test('Riesgo muy alto: Task de alerta tiene priority=stat', () => {
    const protocol   = RISK_PROTOCOLS['very-high'];
    const alertTask  = protocol.tasks.find(t => t.priority === 'stat');
    expect(alertTask).toBeDefined();
    expect(alertTask?.priority).toBe('stat');
  });

  test('Todos los estratos tienen al menos un Task de ecocardiograma', () => {
    for (const stratum of ['low', 'moderate', 'high', 'very-high'] as const) {
      const protocol = RISK_PROTOCOLS[stratum];
      const echoTask = protocol.tasks.find(t => t.planDefinitionId === 'echo');
      expect(echoTask).toBeDefined();
    }
  });

  test('No hay dos Tasks con mismo offsetDays en riesgo bajo', () => {
    const protocol = RISK_PROTOCOLS['low'];
    const onceOnly = protocol.tasks.filter(t => t.occurrences === 1);
    const offsets  = onceOnly.map(t => t.offsetDays);
    const unique   = new Set(offsets);
    expect(unique.size).toBe(offsets.length);
  });

  test('Riesgo muy alto: Task ECG+PA más frecuente que riesgo bajo', () => {
    const vhigh    = RISK_PROTOCOLS['very-high'];
    const low      = RISK_PROTOCOLS['low'];
    const vhEcgTA  = vhigh.tasks.find(t => t.planDefinitionId === 'ecg-ta');
    const lowEcgTA = low.tasks.find(t => t.planDefinitionId === 'ecg-ta');
    // bajo no tiene ECG+PA, muy alto tiene cada 5 días
    expect(vhEcgTA?.periodDays).toBe(5);
    expect(lowEcgTA).toBeUndefined();
  });
});

describe('Generación FHIR CarePlan + Tasks', () => {

  const patientRef = { reference: 'Patient/test-patient-001', display: 'Paciente Test' };
  const practRef   = { reference: 'Practitioner/aquieri-mn-114729', display: 'Dr. Aquieri' };
  const mockQR     = { resourceType: 'QuestionnaireResponse', id: 'qr-001' } as any;

  test('Bundle contiene CarePlan y al menos 5 Tasks para riesgo moderado', () => {
    const bundle = buildCarePlanBundle(patientRef, practRef, 'moderate', mockQR);
    const careplanEntries = bundle.entry?.filter(e => e.resource?.resourceType === 'CarePlan') ?? [];
    const taskEntries     = bundle.entry?.filter(e => e.resource?.resourceType === 'Task') ?? [];
    expect(careplanEntries).toHaveLength(1);
    expect(taskEntries.length).toBeGreaterThanOrEqual(5);
  });

  test('CarePlan tiene instantiatesCanonical apuntando a PD-7', () => {
    const bundle   = buildCarePlanBundle(patientRef, practRef, 'low', mockQR);
    const cpEntry  = bundle.entry?.find(e => e.resource?.resourceType === 'CarePlan');
    const cp       = cpEntry?.resource as any;
    expect(cp.instantiatesCanonical[0]).toContain('cardio-onco-risk-stratification');
  });

  test('Cada Task tiene extension no-bundle-with-others = true', () => {
    const bundle      = buildCarePlanBundle(patientRef, practRef, 'high', mockQR);
    const taskEntries = bundle.entry?.filter(e => e.resource?.resourceType === 'Task') ?? [];
    for (const entry of taskEntries) {
      const task = entry.resource as any;
      const ext  = task.extension?.find(
        (e: any) => e.url.includes('no-bundle-with-others')
      );
      expect(ext?.valueBoolean).toBe(true);
    }
  });

  test('Bundle type es transaction', () => {
    const bundle = buildCarePlanBundle(patientRef, practRef, 'low', mockQR);
    expect(bundle.type).toBe('transaction');
  });
});
