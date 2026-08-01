// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * Tests de las AccessPolicy del proyecto.
 *
 * No prueban el motor de Medplum (eso lo hace el servidor): prueban las
 * **invariantes de seguridad** del recurso que publicamos, para que nadie
 * afloje una política sin que un test se ponga en rojo. Con pacientes reales de
 * hospital público, aflojar esto por accidente es el peor escenario.
 *
 * Invariantes:
 *  1. El paciente sólo accede a su propio compartimento.
 *  2. Nadie escala privilegios (AccessPolicy, Bot, ClientApplication, User…).
 *  3. El perfil de investigación es de sólo lectura y sin identificadores.
 *  4. El perfil clínico cubre TODO lo que escriben el migrador y los bots.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import type { AccessPolicy, AccessPolicyResource, Bundle } from '@medplum/fhirtypes';

const bundle = JSON.parse(readFileSync('data/core/access-policies.json', 'utf-8')) as Bundle;
const policies = new Map<string, AccessPolicy>(
  (bundle.entry ?? []).map((e) => {
    const ap = e.resource as AccessPolicy;
    return [ap.name!, ap];
  })
);

const patient = policies.get('cardio-onco-patient')!;
const clinician = policies.get('cardio-onco-clinician')!;
const researcher = policies.get('cardio-onco-researcher')!;

/** Recursos que jamás debe alcanzar un usuario no administrador. */
const PRIVILEGE_ESCALATION = [
  'AccessPolicy', 'Bot', 'ClientApplication', 'User', 'ProjectMembership',
  'Project', 'Subscription', 'Login', 'PasswordChangeRequest', 'JsonWebKey',
];

/** Recursos que NO pertenecen al compartimento del paciente (son del sistema). */
const NON_COMPARTMENT_OK = ['Questionnaire', 'Schedule', 'Slot', 'Practitioner'];

const writes = (r: AccessPolicyResource): boolean =>
  r.readonly !== true && (!r.interaction || r.interaction.some((i) => ['create', 'update', 'delete'].includes(i)));

describe('Las tres políticas existen y son PUT idempotente por nombre', () => {
  it('paciente, clínico e investigador', () => {
    expect([...policies.keys()].sort()).toEqual([
      'cardio-onco-clinician',
      'cardio-onco-patient',
      'cardio-onco-researcher',
    ]);
  });
  it('se instalan por nombre (re-correr actualiza)', () => {
    for (const e of bundle.entry ?? []) {
      expect(e.request?.method).toBe('PUT');
      expect(e.request?.url).toMatch(/^AccessPolicy\?name=/);
    }
  });
});

describe('Invariante 1 — el paciente sólo ve lo suyo', () => {
  it('la política declara el compartimento del paciente en la raíz', () => {
    expect(patient.compartment?.reference).toBe('%patient');
  });

  it('TODO recurso clínico está acotado a %patient', () => {
    const sinCompartimento = (patient.resource ?? [])
      .filter((r) => !NON_COMPARTMENT_OK.includes(r.resourceType!))
      .filter((r) => r.compartment?.reference !== '%patient')
      .map((r) => r.resourceType);
    expect(sinCompartimento).toEqual([]);
  });

  it('los recursos fuera del compartimento son sólo lectura y no traen PHI de otros', () => {
    for (const name of NON_COMPARTMENT_OK) {
      const r = (patient.resource ?? []).find((x) => x.resourceType === name);
      if (!r) continue;
      expect(writes(r), `${name} no debería ser escribible por el paciente`).toBe(false);
    }
  });

  it('no puede escribir diagnósticos, informes, planes ni scores', () => {
    for (const name of ['Condition', 'DiagnosticReport', 'CarePlan', 'RiskAssessment', 'ServiceRequest', 'Goal']) {
      const r = (patient.resource ?? []).find((x) => x.resourceType === name)!;
      expect(writes(r), `${name} debe ser de sólo lectura para el paciente`).toBe(false);
    }
  });

  it('sí puede cargar sus propios datos (check-in y vitales)', () => {
    for (const name of ['Observation', 'QuestionnaireResponse']) {
      const r = (patient.resource ?? []).find((x) => x.resourceType === name)!;
      expect(r.interaction).toContain('create');
    }
  });

  it('no puede alterar su propia identidad ni marcarse fallecido', () => {
    const p = (patient.resource ?? []).find((x) => x.resourceType === 'Patient')!;
    expect(p.readonlyFields).toEqual(
      expect.arrayContaining(['identifier', 'deceasedBoolean', 'deceasedDateTime'])
    );
  });

  it('NO tiene acceso a Binary — el bootstrap guarda el código de los bots ahí', () => {
    const nombres = (patient.resource ?? []).map((r) => r.resourceType);
    expect(nombres).not.toContain('Binary');
  });
});

describe('Invariante 2 — nadie escala privilegios', () => {
  for (const [nombre, pol] of policies) {
    it(`${nombre} no concede recursos de administración`, () => {
      const concedidos = (pol.resource ?? []).map((r) => r.resourceType!);
      const prohibidos = concedidos.filter((r) => PRIVILEGE_ESCALATION.includes(r));
      expect(prohibidos).toEqual([]);
    });
  }
});

describe('Invariante 3 — investigación: sólo lectura y sin identificadores', () => {
  it('ninguna entrada permite escribir', () => {
    const escribibles = (researcher.resource ?? []).filter(writes).map((r) => r.resourceType);
    expect(escribibles).toEqual([]);
  });

  it('Patient oculta nombre, contacto, domicilio, foto e identificadores', () => {
    const p = (researcher.resource ?? []).find((r) => r.resourceType === 'Patient')!;
    expect(p.hiddenFields).toEqual(
      expect.arrayContaining(['name', 'telecom', 'address', 'photo', 'contact', 'identifier'])
    );
  });

  it('conserva lo que la investigación necesita (edad y sexo NO se ocultan)', () => {
    const p = (researcher.resource ?? []).find((r) => r.resourceType === 'Patient')!;
    expect(p.hiddenFields).not.toContain('birthDate');
    expect(p.hiddenFields).not.toContain('gender');
  });

  it('oculta el texto libre, que es donde se filtra PHI', () => {
    for (const name of ['Observation', 'Condition', 'RiskAssessment']) {
      const r = (researcher.resource ?? []).find((x) => x.resourceType === name)!;
      expect(r.hiddenFields, `${name} debería ocultar note`).toContain('note');
    }
    const dr = (researcher.resource ?? []).find((x) => x.resourceType === 'DiagnosticReport')!;
    expect(dr.hiddenFields).toEqual(expect.arrayContaining(['conclusion', 'presentedForm']));
  });

  it('da acceso a cohortes (Group / ResearchStudy / ResearchSubject)', () => {
    const nombres = (researcher.resource ?? []).map((r) => r.resourceType);
    expect(nombres).toEqual(expect.arrayContaining(['Group', 'ResearchStudy', 'ResearchSubject']));
  });
});

describe('Invariante 4 — el clínico puede escribir todo lo que produce el backend', () => {
  // Tipos que emiten el migrador (workbook.ts) y los bots de scores.
  const PRODUCIDOS_POR_EL_BACKEND = [
    'Patient', 'Observation', 'Condition', 'MedicationStatement', 'RiskAssessment', 'Goal',
  ];

  it('cubre con escritura todo lo que escribe el migrador', () => {
    const escribibles = (clinician.resource ?? []).filter(writes).map((r) => r.resourceType);
    for (const t of PRODUCIDOS_POR_EL_BACKEND) {
      expect(escribibles, `el clínico debe poder escribir ${t}`).toContain(t);
    }
  });

  it('las definiciones (Questionnaire, PlanDefinition, terminologías) son de sólo lectura', () => {
    for (const name of ['Questionnaire', 'PlanDefinition', 'ActivityDefinition', 'CodeSystem', 'ValueSet']) {
      const r = (clinician.resource ?? []).find((x) => x.resourceType === name)!;
      expect(writes(r), `${name} no debería editarse desde la app clínica`).toBe(false);
    }
  });

  it('accede a las cohortes de investigación en modo lectura', () => {
    const rs = (clinician.resource ?? []).find((x) => x.resourceType === 'ResearchStudy')!;
    expect(writes(rs)).toBe(false);
  });
});

describe('Cobertura del front del paciente', () => {
  // Recursos que el front del paciente consume (auditado sobre el repo programas).
  const USADOS_POR_EL_FRONT = [
    'Patient', 'Observation', 'MedicationRequest', 'Coverage', 'ServiceRequest',
    'QuestionnaireResponse', 'Practitioner', 'DiagnosticReport', 'CarePlan',
    'Appointment', 'Schedule', 'Immunization',
  ];

  it('la política cubre todo lo que el front pide (si no, la página da 403)', () => {
    const concedidos = (patient.resource ?? []).map((r) => r.resourceType);
    const faltantes = USADOS_POR_EL_FRONT.filter((t) => !concedidos.includes(t));
    expect(faltantes).toEqual([]);
  });
});
