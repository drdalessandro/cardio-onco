import { Alert, Badge, Button, Divider, Group, Loader, Stack, Table, Text, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { showNotification } from '@mantine/notifications';
import { getReferenceString, normalizeErrorString } from '@medplum/core';
import type { Patient, Questionnaire, QuestionnaireResponse } from '@medplum/fhirtypes';
import { QuestionnaireForm, useMedplum } from '@medplum/react';
import { IconAlertTriangle, IconCircleCheck, IconClipboardHeart, IconPlus } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';

const QUESTIONNAIRE_ID = 'cardio-onco-risk-stratification';

const STRATUM_LABELS: Record<string, { label: string; color: string }> = {
  'low':       { label: 'Riesgo Bajo',      color: 'green'  },
  'moderate':  { label: 'Riesgo Moderado',  color: 'yellow' },
  'high':      { label: 'Riesgo Alto',      color: 'orange' },
  'very-high': { label: 'Riesgo Muy Alto',  color: 'red'    },
};

interface CTRCDStratificationProps {
  patient: Patient;
}

export function CTRCDStratification({ patient }: CTRCDStratificationProps): JSX.Element {
  const medplum = useMedplum();
  const [questionnaire, setQuestionnaire] = useState<Questionnaire>();
  const [responses, setResponses] = useState<QuestionnaireResponse[]>();
  const [loading, setLoading] = useState(true);
  const [submitError, setSubmitError] = useState<string>();
  const [formOpen, { open: openForm, close: closeForm }] = useDisclosure(false);

  const patientRef = { reference: getReferenceString(patient), display: patient.name?.[0]?.text ?? patient.id };

  useEffect(() => {
    Promise.all([
      medplum.readResource('Questionnaire', QUESTIONNAIRE_ID),
      loadResponses(),
    ])
      .then(([q]) => setQuestionnaire(q as Questionnaire))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [medplum, patient.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadResponses(): Promise<void> {
    const rs = await medplum.searchResources('QuestionnaireResponse', {
      questionnaire: `Questionnaire/${QUESTIONNAIRE_ID}`,
      subject:       `Patient/${patient.id}`,
      _sort:         '-authored',
      _count:        '10',
    });
    setResponses(rs as QuestionnaireResponse[]);
  }

  async function handleSubmit(formData: QuestionnaireResponse): Promise<void> {
    setSubmitError(undefined);
    try {
      const toSave: QuestionnaireResponse = {
        resourceType: 'QuestionnaireResponse',
        questionnaire: `Questionnaire/${QUESTIONNAIRE_ID}`,
        status:    'completed',
        subject:   patientRef,
        authored:  new Date().toISOString(),
        item:      formData.item,
      };

      await medplum.createResource(toSave);

      showNotification({
        icon:    <IconCircleCheck />,
        title:   'Score CTRCD enviado',
        message: 'El Bot generará el CarePlan y Tasks en segundos.',
        color:   'green',
        autoClose: 5000,
      });

      await loadResponses();
      closeForm();
    } catch (err) {
      const msg = normalizeErrorString(err);
      setSubmitError(msg);
      showNotification({
        color:   'red',
        icon:    <IconAlertTriangle />,
        title:   'Error al guardar',
        message: msg,
        autoClose: false,
      });
    }
  }

  if (loading) {
    return (
      <Stack align="center" p="xl">
        <Loader />
        <Text c="dimmed">Cargando estratificación CTRCD ESC 2022...</Text>
      </Stack>
    );
  }

  if (!questionnaire) {
    return (
      <Alert color="red" icon={<IconAlertTriangle />} title="Questionnaire no encontrado">
        El recurso <b>Questionnaire/cardio-onco-risk-stratification</b> no está cargado en Medplum.
        Subilo desde el JSON del repositorio antes de continuar.
      </Alert>
    );
  }

  return (
    <Stack p="xs" gap="lg">
      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Group gap="xs">
            <IconClipboardHeart size={22} color="var(--mantine-color-red-6)" />
            <Title order={4}>Estratificación CTRCD — ESC 2022</Title>
          </Group>
          <Text c="dimmed" size="sm">
            Completá el score antes de iniciar el tratamiento oncológico.
            Al enviarlo el Bot generará automáticamente el CarePlan y las Tasks de seguimiento.
          </Text>
        </Stack>
        {!formOpen && (
          <Button leftSection={<IconPlus size={16} />} onClick={openForm} color="red">
            Nueva estratificación
          </Button>
        )}
      </Group>

      {formOpen && (
        <>
          <Divider label="Completar score CTRCD" labelPosition="left" />
          {submitError && (
            <Alert color="red" icon={<IconAlertTriangle />} title="Error al guardar">
              {submitError}
            </Alert>
          )}
          <QuestionnaireForm
            questionnaire={questionnaire}
            subject={patientRef}
            onSubmit={handleSubmit}
          />
          <Button variant="subtle" color="gray" onClick={() => { closeForm(); setSubmitError(undefined); }}>
            Cancelar
          </Button>
        </>
      )}

      {!formOpen && responses && responses.length > 0 && (
        <>
          <Divider label="Estratificaciones anteriores" labelPosition="left" />
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Fecha</Table.Th>
                <Table.Th>Estado</Table.Th>
                <Table.Th>Ver</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {responses.map((qr) => (
                <Table.Tr key={qr.id}>
                  <Table.Td>
                    {qr.authored ? new Date(qr.authored).toLocaleString('es-AR') : qr.id}
                  </Table.Td>
                  <Table.Td>
                    <Badge color="green" variant="light">{qr.status}</Badge>
                  </Table.Td>
                  <Table.Td>
                    <Button size="xs" variant="subtle" component="a"
                      href={`/QuestionnaireResponse/${qr.id}`} target="_blank">
                      Abrir
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </>
      )}

      {!formOpen && responses?.length === 0 && (
        <Alert color="blue" icon={<IconClipboardHeart />} title="Sin estratificaciones previas">
          Este paciente no tiene ningún score CTRCD registrado. Hacé click en{' '}
          <b>Nueva estratificación</b> para comenzar.
        </Alert>
      )}

      <Divider />
      <Stack gap={4}>
        <Text size="xs" c="dimmed" fw={600}>Estratos ESC 2022</Text>
        <Group gap="xs">
          {Object.entries(STRATUM_LABELS).map(([key, val]) => (
            <Badge key={key} color={val.color} variant="light">{val.label}</Badge>
          ))}
        </Group>
      </Stack>
    </Stack>
  );
}
