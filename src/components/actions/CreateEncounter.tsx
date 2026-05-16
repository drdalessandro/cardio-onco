// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Modal } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { getDisplayString, getQuestionnaireAnswers, getReferenceString, normalizeErrorString } from '@medplum/core';
import type {
  Coding,
  Encounter,
  Patient,
  Practitioner,
  Questionnaire,
  QuestionnaireResponse,
  Reference,
} from '@medplum/fhirtypes';
import { QuestionnaireForm, useMedplum, useMedplumProfile } from '@medplum/react';
import { IconCircleCheck, IconCircleOff } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useNavigate } from 'react-router';

interface CreateEncounterProps {
  readonly opened: boolean;
  readonly handlers: {
    readonly open: () => void;
    readonly close: () => void;
    readonly toggle: () => void;
  };
}

export function CreateEncounter({ opened, handlers }: CreateEncounterProps): JSX.Element {
  const medplum = useMedplum();
  const profile = useMedplumProfile() as Practitioner;
  const navigate = useNavigate();

  function handleQuestionnaireSubmit(formData: QuestionnaireResponse): void {
    const answers = getQuestionnaireAnswers(formData);
    const patientReference = answers['patient'].valueReference as Reference<Patient>;
    const encounterClass = answers['class'].valueCoding as Coding;
    const encounterType = answers['type']?.valueCoding ?? undefined;
    const encounterDate = answers['date'].valueDate as string;
    createEncounter(patientReference, encounterClass, encounterDate, encounterType);
    handlers.close();
  }

  function createEncounter(patient: Reference<Patient>, encounterClass: Coding, date: string, type?: Coding): void {
    const encounterData: Encounter = {
      resourceType: 'Encounter',
      subject: patient,
      class: encounterClass,
      status: 'in-progress',
      period: {
        start: date,
      },
      type: type
        ? [
            {
              coding: [type],
            },
          ]
        : undefined,
      participant: [
        {
          type: [
            {
              coding: [
                {
                  system: 'http://terminology.hl7.org/CodeSystem/v3-ParticipationType',
                  code: 'ATND',
                  display: 'attender',
                },
              ],
            },
          ],
          individual: { reference: getReferenceString(profile), display: getDisplayString(profile) },
        },
      ],
    };

    medplum
      .createResource(encounterData)
      .then((encounter) => {
        showNotification({
          icon: <IconCircleCheck />,
          title: 'Éxito',
          message: 'Encuentro creado',
        });
        navigate(`/Encounter/${encounter.id}`)?.catch(console.error);
      })
      .catch((err) => {
        showNotification({
          color: 'red',
          icon: <IconCircleOff />,
          title: 'Error',
          message: normalizeErrorString(err),
        });
      });
  }

  return (
    <Modal opened={opened} onClose={handlers.close} title="Crear Encuentro">
      <QuestionnaireForm questionnaire={createEncounterQuestionnaire} onSubmit={handleQuestionnaireSubmit} />
    </Modal>
  );
}

const createEncounterQuestionnaire: Questionnaire = {
  resourceType: 'Questionnaire',
  status: 'active',
  title: 'Crear Encuentro',
  id: 'new-encounter',
  item: [
    {
      linkId: 'patient',
      type: 'reference',
      text: '¿Cuál es el paciente?',
      required: true,
      extension: [
        {
          url: 'http://hl7.org/fhir/StructureDefinition/questionnaire-referenceResource',
          valueCodeableConcept: {
            coding: [{ code: 'Patient' }],
          },
        },
      ],
    },
    {
      linkId: 'date',
      type: 'date',
      text: '¿Cuál es la fecha del encuentro?',
      required: true,
      initial: [{ valueDate: new Date().toISOString().slice(0, 10) }],
    },
    {
      linkId: 'class',
      type: 'choice',
      text: '¿Cuál es la modalidad del encuentro?',
      required: true,
      answerOption: [
        { valueCoding: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB',  display: 'Ambulatorio' } },
        { valueCoding: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'IMP',  display: 'Internación' } },
        { valueCoding: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'EMER', display: 'Emergencia' } },
        { valueCoding: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'VR',   display: 'Virtual / Telemedicina' } },
        { valueCoding: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'HH',   display: 'Atención Domiciliaria' } },
      ],
    },
    {
      linkId: 'type',
      type: 'choice',
      text: '¿Qué tipo de encuentro es?',
      answerOption: [
        { valueCoding: { system: 'http://snomed.info/sct', code: '11429006',  display: 'Consulta' } },
        { valueCoding: { system: 'http://snomed.info/sct', code: '308540004', display: 'Internación' } },
        { valueCoding: { system: 'http://snomed.info/sct', code: '371883000', display: 'Procedimiento Ambulatorio' } },
        { valueCoding: { system: 'http://snomed.info/sct', code: '185317003', display: 'Consulta Telefónica' } },
        { valueCoding: { system: 'http://snomed.info/sct', code: '439708006', display: 'Visita Domiciliaria' } },
        { valueCoding: { system: 'http://snomed.info/sct', code: '390906007', display: 'Seguimiento' } },
        { valueCoding: { system: 'http://snomed.info/sct', code: '50849002',  display: 'Guardia / Emergencia' } },
        { valueCoding: { system: 'http://snomed.info/sct', code: '255327002', display: 'Ambulatorio' } },
        { valueCoding: { system: 'http://snomed.info/sct', code: '110466009', display: 'Evaluación Preoperatoria' } },
        { valueCoding: { system: 'http://snomed.info/sct', code: '91251008',  display: 'Kinesiología / Fisioterapia' } },
        { valueCoding: { system: 'http://snomed.info/sct', code: '31205005',  display: 'Psiquiatría / Psicología' } },
        { valueCoding: { system: 'http://snomed.info/sct', code: '163497009', display: 'Obstetricia' } },
        { valueCoding: { system: 'http://snomed.info/sct', code: '83607001',  display: 'Ginecología' } },
        { valueCoding: { system: 'http://snomed.info/sct', code: '225362009', display: 'Odontología' } },
        { valueCoding: { system: 'http://snomed.info/sct', code: '304567001', display: 'Internación de Larga Estadía' } },
      ],
    },
  ],
};
