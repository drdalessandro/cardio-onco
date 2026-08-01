// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * Trayectoria de una medición en el tiempo.
 *
 * Difiere del `Measurement.tsx` del upstream en **cómo consulta las series
 * múltiples**, y el motivo es de modelo de datos:
 *
 * El upstream, cuando hay más de una serie, busca UN Observation panel y lee
 * `obs.component[i]` (así modela la presión arterial: un recurso con dos
 * componentes). Este backend escribe **una Observation por medición** —
 * sistólica y diastólica son recursos separados, igual que troponina I y T—
 * porque es lo que corresponde al mapeo FHIR del proyecto (una Observation por
 * medición y por fecha) y lo que producen el migrador y el check-in.
 *
 * Con la lógica del upstream, la presión arterial mostraría un gráfico vacío y
 * la troponina rompería al leer `component[0]`. Acá cada serie consulta su
 * propio código y las fechas se alinean entre series.
 *
 * No incluye "agregar medición": la carga del paciente entra por el check-in
 * (`/check-in`), que es la vía única y la que dispara el recálculo de scores.
 */
import { Alert, Anchor, Box, Stack, Table, Text, Title } from '@mantine/core';
import { formatDate, getReferenceString } from '@medplum/core';
import type { Observation, Patient } from '@medplum/fhirtypes';
import { Document, useMedplum } from '@medplum/react';
import type { ChartData, ChartDataset } from 'chart.js';
import { IconAlertCircle } from '@tabler/icons-react';
import { useMemo } from 'react';
import type { JSX } from 'react';
import { Link, useParams } from 'react-router';
import { LineChart } from '../../components/LineChart';
import { measurementsMeta } from './Measurement.data';

/** Fecha de una observación, normalizada para ordenar y agrupar. */
function when(obs: Observation): string {
  return obs.effectiveDateTime ?? obs.meta?.lastUpdated ?? '';
}

export function Measurement(): JSX.Element | null {
  const { measurementId } = useParams();
  const meta = measurementsMeta[measurementId as string];
  const medplum = useMedplum();
  const patient = medplum.getProfile() as Patient;

  // Una consulta por serie: cada dataset trae su propio código (y si no lo
  // declara, usa el de la medición).
  const codes = (meta?.chartDatasets ?? []).map((d) => d.code ?? meta.code);
  const results = codes.map((code) =>
    medplum.searchResources('Observation', `code=${code}&patient=${getReferenceString(patient)}&_count=200`).read()
  );

  const { chartData, rows } = useMemo(() => {
    // Eje X: unión ordenada de las fechas de todas las series.
    const fechas = [...new Set(results.flatMap((obs) => obs.map(when)).filter(Boolean))].sort();

    const datasets: ChartDataset<'line', (number | null)[]>[] = (meta?.chartDatasets ?? []).map((ds, i) => {
      const porFecha = new Map(results[i].map((o) => [when(o), o.valueQuantity?.value]));
      return {
        label: `${ds.label}${ds.unit ? ` (${ds.unit})` : ''}`,
        backgroundColor: ds.backgroundColor,
        borderColor: ds.borderColor,
        // `null` deja el hueco visible en vez de inventar una línea recta entre
        // dos controles distantes.
        data: fechas.map((f) => porFecha.get(f) ?? null),
      };
    });

    const rows = fechas
      .map((f) => ({
        fecha: f,
        valores: (meta?.chartDatasets ?? []).map((ds, i) => {
          const obs = results[i].find((o) => when(o) === f);
          return obs?.valueQuantity?.value !== undefined ? `${obs.valueQuantity.value} ${ds.unit}` : '—';
        }),
      }))
      .reverse();

    return {
      chartData: { labels: fechas.map((f) => formatDate(f)), datasets } as ChartData<'line', number[]>,
      rows,
    };
  }, [meta, results]);

  if (!meta) {
    return (
      <Document>
        <Alert icon={<IconAlertCircle />} color="gray" title="Medición desconocida">
          <Anchor component={Link} to="/health-record/vitals">
            Volver a Mis mediciones
          </Anchor>
        </Alert>
      </Document>
    );
  }

  return (
    <Document>
      <Stack gap="md">
        <Title order={2}>{meta.title}</Title>

        {rows.length > 0 ? (
          <LineChart chartData={chartData} />
        ) : (
          <Alert color="gray" variant="light" title="Todavía no hay registros">
            Cuando cargues este valor en el{' '}
            <Anchor component={Link} to="/check-in">
              check-in
            </Anchor>{' '}
            o tu equipo lo registre en un control, vas a ver acá cómo evoluciona.
          </Alert>
        )}

        <Box>
          <Alert icon={<IconAlertCircle size={16} />} title="¿Qué estamos midiendo?" color="gray" radius="md">
            {meta.description}
          </Alert>
        </Box>

        {rows.length > 0 && (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Fecha</Table.Th>
                {meta.chartDatasets.map((ds) => (
                  <Table.Th key={ds.label}>{ds.label}</Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r) => (
                <Table.Tr key={r.fecha}>
                  <Table.Td>{formatDate(r.fecha)}</Table.Td>
                  {r.valores.map((v, i) => (
                    <Table.Td key={i}>{v}</Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}

        <Text size="xs" c="dimmed">
          Los valores que cargás vos y los que registra tu equipo se muestran juntos en esta serie.
        </Text>
      </Stack>
    </Document>
  );
}
