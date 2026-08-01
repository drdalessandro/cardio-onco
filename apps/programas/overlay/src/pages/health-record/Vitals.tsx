// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * Mis mediciones — índice de trayectorias.
 *
 * El `Vitals.tsx` del upstream lista observaciones sueltas y no lleva a ningún
 * lado: la página de trayectoria (`Measurement.tsx`) queda inalcanzable. Acá se
 * muestra el catálogo, de modo que cada medición sea navegable, con su último
 * valor y fecha.
 *
 * Recorre `measurementsMeta`: agregar una medición al catálogo la hace aparecer
 * sola, sin tocar esta página.
 */
import { Badge, Card, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { formatDate, formatObservationValue, getReferenceString } from '@medplum/core';
import type { Observation, Patient } from '@medplum/fhirtypes';
import { Document, useMedplum } from '@medplum/react';
import { IconChartLine } from '@tabler/icons-react';
import type { JSX } from 'react';
import { Link } from 'react-router';
import { measurementsMeta } from './Measurement.data';

/** Última observación por código, para mostrar el valor actual en cada tarjeta. */
function lastByCode(observations: Observation[]): Map<string, Observation> {
  const latest = new Map<string, Observation>();
  for (const obs of observations) {
    const code = obs.code?.coding?.[0]?.code;
    if (!code) {
      continue;
    }
    const prev = latest.get(code);
    const when = obs.effectiveDateTime ?? obs.meta?.lastUpdated ?? '';
    const prevWhen = prev?.effectiveDateTime ?? prev?.meta?.lastUpdated ?? '';
    if (!prev || when > prevWhen) {
      latest.set(code, obs);
    }
  }
  return latest;
}

export function Vitals(): JSX.Element {
  const medplum = useMedplum();
  const patient = medplum.getProfile() as Patient;
  const observations = medplum
    .searchResources('Observation', 'patient=' + getReferenceString(patient) + '&_count=200')
    .read();

  const latest = lastByCode(observations);
  const entries = Object.values(measurementsMeta);

  return (
    <Document>
      <Stack gap="md">
        <div>
          <Title order={2}>Mis mediciones</Title>
          <Text c="dimmed" size="sm">
            Cómo evolucionan tus valores en el tiempo. Tocá una medición para ver el gráfico.
          </Text>
        </div>

        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          {entries.map((m) => {
            const obs = latest.get(m.code) ?? latest.get(m.chartDatasets[0]?.code ?? '');
            return (
              <Card
                key={m.id}
                withBorder
                radius="md"
                padding="md"
                component={Link}
                to={`/health-record/vitals/${m.id}`}
              >
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                  <div>
                    <Text fw={500}>{m.title}</Text>
                    {obs ? (
                      <>
                        <Text size="xl" fw={700} mt={4}>
                          {formatObservationValue(obs)}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {formatDate(obs.effectiveDateTime ?? obs.meta?.lastUpdated)}
                        </Text>
                      </>
                    ) : (
                      <Badge variant="light" color="gray" mt={6}>
                        Sin registros
                      </Badge>
                    )}
                  </div>
                  <IconChartLine size={20} opacity={0.5} />
                </Group>
              </Card>
            );
          })}
        </SimpleGrid>
      </Stack>
    </Document>
  );
}
