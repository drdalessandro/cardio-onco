// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Button, Modal } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { showNotification } from '@mantine/notifications';
import { getQuestionnaireAnswers, normalizeErrorString } from '@medplum/core';
import type { PatchOperation } from '@medplum/core';
import type { CodeableConcept, Coding, Encounter, Questionnaire, QuestionnaireResponse } from '@medplum/fhirtypes';
import { QuestionnaireForm, useMedplum } from '@medplum/react';
import { IconCircleCheck, IconCircleOff } from '@tabler/icons-react';
import type { JSX } from 'react';

interface EditTypeProps {
  encounter: Encounter;
  onChange: (encounter: Encounter) => void;
}

export function EditType(props: EditTypeProps): JSX.Element {
  const medplum = useMedplum();
  const [opened, handlers] = useDisclosure(false);

  function handleQuestionnaireSubmit(formData: QuestionnaireResponse): void {
    const type = getQuestionnaireAnswers(formData)['type'].valueCoding;
    updateEncounterType(type);
    handlers.close();
  }

  function updateEncounterType(type?: Coding): void {
    if (!type) {
      throw new Error('Invalid type');
    }
    const encounterId = props.encounter.id as string;
    const typeConcept: CodeableConcept = {
      coding: [type],
    };

    const op = props.encounter.type ? 'replace' : 'add';
    const ops: PatchOperation[] = [
      { op: 'test', path: '/meta/versionId', value: props.encounter.meta?.versionId },
      { op, path: '/type', value: [typeConcept] },
    ];

    medplum
      .patchResource('Encounter', encounterId, ops)
      .then((encounter) => {
        props.onChange(encounter);
        showNotification({
          icon: <IconCircleCheck />,
          title: 'Éxito',
          message: 'Tipo de encuentro actualizado',
        });
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
    <div>
      <Button fullWidth onClick={handlers.open}>
        Editar Tipo de Encuentro
      </Button>
      <Modal opened={opened} onClose={handlers.close} title="Editar Tipo de Encuentro">
        <QuestionnaireForm questionnaire={editTypeQuestionnaire} onSubmit={handleQuestionnaireSubmit} />
      </Modal>
    </div>
  );
}

const editTypeQuestionnaire: Questionnaire = {
  resourceType: 'Questionnaire',
  status: 'active',
  id: 'edit-type',
  title: 'Editar Tipo de Encuentro',
  item: [
    {
      linkId: 'type',
      type: 'choice',
      text: 'Nuevo Tipo:',
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
