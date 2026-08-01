// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * Check-in cardio-oncológico — la página no sabe qué pregunta.
 *
 * El formulario se arma desde el `Questionnaire` del servidor
 * (`data/core/questionnaire-checkin-cardio-onco.json` del repo cardio-onco).
 * Agregar o cambiar una pregunta es editar ese recurso: esta página no cambia y
 * no hay que redeployar el front.
 *
 * La respuesta dispara la cadena que ya existe en el backend:
 *   QuestionnaireResponse → checkin-to-observations-bot → Observation (LOINC)
 *   → subscription de scores → RiskAssessment → lo ve el equipo clínico.
 */
import { Alert, Loader, Stack, Text, Title } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { getReferenceString, normalizeErrorString } from '@medplum/core';
import type { Patient, Questionnaire, QuestionnaireResponse } from '@medplum/fhirtypes';
import { Document, QuestionnaireForm, useMedplum, useMedplumProfile } from '@medplum/react';
import { IconAlertCircle, IconCircleCheck, IconCircleOff } from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { useNavigate } from 'react-router';

/** URL canónica del cuestionario sembrado por el bootstrap del backend. */
const CHECKIN_URL = 'https://api.epa-bienestar.com.ar/fhir/Questionnaire/checkin-cardio-onco';

export function CheckInPage(): JSX.Element {
  const medplum = useMedplum();
  const navigate = useNavigate();
  const profile = useMedplumProfile() as Patient | undefined;
  const [questionnaire, setQuestionnaire] = useState<Questionnaire>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    medplum
      .searchOne('Questionnaire', { url: CHECKIN_URL })
      .then((q) => {
        if (!q) {
          setError('El cuestionario de check-in no está cargado en el servidor. Ejecutá `npm run bootstrap` en el backend.');
          return;
        }
        setQuestionnaire(q);
      })
      .catch((e) => setError(normalizeErrorString(e)));
  }, [medplum]);

  const handleSubmit = useCallback(
    (response: QuestionnaireResponse) => {
      if (!profile) {
        return;
      }
      // El bot necesita estos dos campos: `subject` para saber de quién es cada
      // Observation, y `questionnaire` para resolver los códigos clínicos.
      const completed: QuestionnaireResponse = {
        ...response,
        status: 'completed',
        questionnaire: CHECKIN_URL,
        subject: { reference: getReferenceString(profile) },
        source: { reference: getReferenceString(profile) },
        authored: new Date().toISOString(),
      };

      medplum
        .createResource(completed)
        .then(() => {
          showNotification({
            icon: <IconCircleCheck />,
            title: 'Check-in enviado',
            message: 'Tu equipo va a ver esta información en su próxima revisión.',
          });
          navigate('/health-record/questionnaire-responses')?.catch(console.error);
          window.scrollTo(0, 0);
        })
        .catch((err) => {
          showNotification({
            color: 'red',
            icon: <IconCircleOff />,
            title: 'No se pudo enviar',
            message: normalizeErrorString(err),
          });
        });
    },
    [medplum, navigate, profile]
  );

  if (error) {
    return (
      <Document width={800}>
        <Alert icon={<IconAlertCircle />} color="red" title="Check-in no disponible">
          {error}
        </Alert>
      </Document>
    );
  }

  if (!questionnaire) {
    return (
      <Document width={800}>
        <Loader />
      </Document>
    );
  }

  return (
    <Document width={800}>
      <Stack gap="md">
        <div>
          <Title order={2}>{questionnaire.title ?? 'Check-in'}</Title>
          <Text c="dimmed" size="sm">
            Contanos cómo venís desde el último control. Si tenés un síntoma nuevo o que empeora,
            no esperes al turno: comunicate con tu equipo.
          </Text>
        </div>
        <QuestionnaireForm questionnaire={questionnaire} onSubmit={handleSubmit} />
      </Stack>
    </Document>
  );
}
