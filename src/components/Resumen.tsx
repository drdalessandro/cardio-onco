import React, { useState } from 'react';
import type { JSX } from 'react';
import { Alert, Button, Group, Paper, SegmentedControl, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconAlertCircle, IconDownload } from '@tabler/icons-react';
import { useMedplum } from '@medplum/react';
import type { Patient } from '@medplum/fhirtypes';

type ExportFormat = 'fhir-everything' | 'ccda' | 'ccda-referral';

interface ResumenProps {
  patient: Patient;
}

export function Resumen({ patient }: ResumenProps): JSX.Element {
  const medplum = useMedplum();
  const [format, setFormat] = useState<ExportFormat>('fhir-everything');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async (): Promise<void> => {
    const id = patient.id;
    if (!id) return;

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (startDate) params.set('start', startDate);
      if (endDate) params.set('end', endDate);
      const query = params.toString() ? `?${params.toString()}` : '';

      if (format === 'fhir-everything') {
        const bundle = await medplum.get(`Patient/${id}/$everything${query}`);
        const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
        triggerDownload(blob, `paciente-${id}-everything.json`);
      } else {
        const operation = format === 'ccda' ? '$ccda' : '$ccda-referral';
        const accessToken = medplum.getAccessToken();
        const url = new URL(`fhir/R4/Patient/${id}/${operation}${query}`, medplum.getBaseUrl());
        const response = await fetch(url.toString(), {
          headers: {
            Authorization: `Bearer ${accessToken ?? ''}`,
            Accept: 'application/xml',
          },
        });
        if (!response.ok) {
          const message = await response.text();
          throw new Error(`Error ${response.status}: ${message}`);
        }
        const xml = await response.text();
        const blob = new Blob([xml], { type: 'application/xml' });
        const label = format === 'ccda' ? 'ccda' : 'ccda-referral';
        triggerDownload(blob, `paciente-${id}-${label}.xml`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al exportar los datos del paciente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Stack p="md" gap="xl">
      <Paper withBorder p="xl" radius="md" maw={700}>
        <Stack gap="lg">
          <Title order={4}>Exportar datos del paciente</Title>

          <Stack gap={4}>
            <Text size="sm" fw={500}>
              Formato de exportación{' '}
              <Text span c="red" fw={500}>
                *
              </Text>
            </Text>
            <Text size="xs" c="dimmed">
              Requerido
            </Text>
            <SegmentedControl
              value={format}
              onChange={(v: string) => setFormat(v as ExportFormat)}
              data={[
                { label: 'FHIR Everything', value: 'fhir-everything' },
                { label: 'C-CDA', value: 'ccda' },
                { label: 'C-CDA Referral', value: 'ccda-referral' },
              ]}
            />
          </Stack>

          <TextInput
            label="Fecha de inicio"
            description="Inicio del período de atención. Si no se especifica, se incluyen todos los registros anteriores a la fecha de fin."
            type="date"
            value={startDate}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setStartDate(e.currentTarget.value)}
          />

          <TextInput
            label="Fecha de fin"
            description="Fin del período de atención. Si no se especifica, se incluyen todos los registros posteriores a la fecha de inicio."
            type="date"
            value={endDate}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEndDate(e.currentTarget.value)}
          />

          {error && (
            <Alert icon={<IconAlertCircle size={16} />} color="red" title="Error al exportar">
              {error}
            </Alert>
          )}

          <Group justify="flex-end">
            <Button
              leftSection={<IconDownload size={16} />}
              loading={loading}
              onClick={() => {
                handleExport().catch(console.error);
              }}
              size="md"
            >
              Descargar exportación
            </Button>
          </Group>
        </Stack>
      </Paper>
    </Stack>
  );
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
