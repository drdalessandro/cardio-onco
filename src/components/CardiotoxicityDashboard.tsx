// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Alert, Badge, Card, Grid, Group, Paper, SimpleGrid, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { formatDate, getReferenceString } from '@medplum/core';
import type { MedicationAdministration, Observation, Patient } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { IconAlertTriangle, IconCircleCheck, IconHeart, IconHeartbeat, IconPill } from '@tabler/icons-react';
import type { ChartDataset } from 'chart.js';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { LVEFChart } from './graphs/LVEFChart';

interface CardiotoxicityDashboardProps {
  patient: Patient;
}

type ESCRiskLevel = 'red' | 'yellow' | 'green' | 'unknown';

interface RiskInfo {
  level: ESCRiskLevel;
  label: string;
  message: string;
  color: string;
  icon: JSX.Element;
}

/**
 * Classifies cardiotoxicity risk per ESC 2022 Guidelines on Cardio-Oncology.
 * Ref: https://doi.org/10.1093/eurheartj/ehac244
 *
 * RED   – Confirmed: LVEF drop ≥10 pp to <50%
 * YELLOW – Warning:  LVEF drop ≥10 pp (LVEF still ≥50%) OR new LVEF 50–54%
 * GREEN  – Normal:   LVEF ≥55% with <10 pp drop from baseline
 */
function computeESCRisk(observations: Observation[]): ESCRiskLevel {
  if (observations.length === 0) return 'unknown';

  const sorted = [...observations].sort(
    (a, b) => new Date(a.effectiveDateTime ?? '').getTime() - new Date(b.effectiveDateTime ?? '').getTime()
  );

  const baseline = sorted[0]?.valueQuantity?.value;
  const current = sorted[sorted.length - 1]?.valueQuantity?.value;

  if (baseline === undefined || current === undefined) return 'unknown';

  const drop = baseline - current;

  if (drop >= 10 && current < 50) return 'red';
  if ((drop >= 10 && current >= 50) || current < 55) return 'yellow';
  return 'green';
}

function getRiskInfo(level: ESCRiskLevel): RiskInfo {
  switch (level) {
    case 'red':
      return {
        level,
        label: 'Cardiotoxicidad Confirmada',
        message:
          'Caída de FEVI ≥10 puntos porcentuales a <50% (Criterios ESC 2022). Suspender quimioterapia y derivar a cardiología con carácter urgente.',
        color: 'red',
        icon: <IconAlertTriangle size={20} />,
      };
    case 'yellow':
      return {
        level,
        label: 'Riesgo Moderado — Alerta',
        message:
          'Caída de FEVI ≥10 pp (FEVI ≥50%) o FEVI entre 50–54%. Monitoreo cardiológico estrecho recomendado (Criterios ESC 2022).',
        color: 'yellow',
        icon: <IconAlertTriangle size={20} />,
      };
    case 'green':
      return {
        level,
        label: 'Sin Cardiotoxicidad',
        message: 'FEVI ≥55% sin caída significativa. Continuar tratamiento oncológico con monitoreo periódico.',
        color: 'green',
        icon: <IconCircleCheck size={20} />,
      };
    default:
      return {
        level,
        label: 'Sin Datos de FEVI',
        message:
          'No se encontraron observaciones de FEVI. Registrar ecocardiograma basal (LOINC 8806-2) antes de iniciar quimioterapia.',
        color: 'gray',
        icon: <IconHeart size={20} />,
      };
  }
}

function getMedicationName(med: MedicationAdministration): string {
  if (med.medicationCodeableConcept) {
    return (
      med.medicationCodeableConcept.text ??
      med.medicationCodeableConcept.coding?.[0]?.display ??
      'Medicación no especificada'
    );
  }
  return 'Medicación (referencia)';
}

function getMedicationDate(med: MedicationAdministration): string | undefined {
  if (med.effectiveDateTime) return med.effectiveDateTime;
  if (med.effectivePeriod?.start) return med.effectivePeriod.start;
  return undefined;
}

export function CardiotoxicityDashboard(props: CardiotoxicityDashboardProps): JSX.Element {
  const medplum = useMedplum();
  const [lvefObservations, setLvefObservations] = useState<Observation[]>([]);
  const [medications, setMedications] = useState<MedicationAdministration[]>([]);

  useEffect(() => {
    const patientRef = getReferenceString(props.patient);

    medplum
      .searchResources('Observation', {
        code: '8806-2',
        patient: patientRef,
        _sort: 'date',
        _count: '100',
      })
      .then(setLvefObservations)
      .catch(console.error);

    medplum
      .searchResources('MedicationAdministration', {
        patient: patientRef,
        _sort: '-effective-time',
        _count: '50',
      })
      .then(setMedications)
      .catch(console.error);
  }, [medplum, props.patient]);

  const riskLevel = computeESCRisk(lvefObservations);
  const riskInfo = getRiskInfo(riskLevel);

  const currentLVEF = lvefObservations.length > 0 ? lvefObservations[lvefObservations.length - 1]?.valueQuantity?.value : undefined;
  const baselineLVEF = lvefObservations.length > 0 ? lvefObservations[0]?.valueQuantity?.value : undefined;
  const lvefDrop = baselineLVEF !== undefined && currentLVEF !== undefined ? baselineLVEF - currentLVEF : undefined;

  // Build chart data with ESC threshold reference lines
  const labels = lvefObservations.map((obs) => formatDate(obs.effectiveDateTime));
  const lvefValues = lvefObservations.map((obs) => obs.valueQuantity?.value ?? 0);

  const datasets: ChartDataset<'line', number[]>[] = [
    {
      label: 'FEVI (%)',
      data: lvefValues,
      backgroundColor: 'rgba(29, 112, 214, 0.7)',
      borderColor: 'rgba(29, 112, 214, 1)',
      borderWidth: 2,
      pointRadius: 5,
      tension: 0.3,
    },
    {
      label: 'Umbral Normal ESC (55%)',
      data: labels.map(() => 55),
      backgroundColor: 'rgba(34, 197, 94, 0.1)',
      borderColor: 'rgba(34, 197, 94, 0.8)',
      borderWidth: 1,
      pointRadius: 0,
    },
    {
      label: 'Umbral Crítico ESC (50%)',
      data: labels.map(() => 50),
      backgroundColor: 'rgba(239, 68, 68, 0.1)',
      borderColor: 'rgba(239, 68, 68, 0.8)',
      borderWidth: 1,
      pointRadius: 0,
    },
  ];

  const chartData = { labels, datasets };

  return (
    <Stack gap="md">
      <Alert color={riskInfo.color} icon={riskInfo.icon} title={riskInfo.label} variant="filled">
        {riskInfo.message}
      </Alert>

      <SimpleGrid cols={3}>
        <Card shadow="sm" padding="md" radius="md" withBorder>
          <Group>
            <ThemeIcon color="blue" size="lg" radius="md">
              <IconHeartbeat size={20} />
            </ThemeIcon>
            <div>
              <Text size="xs" c="dimmed">
                FEVI Actual
              </Text>
              <Text fw={700} size="xl">
                {currentLVEF !== undefined ? `${currentLVEF}%` : 'N/D'}
              </Text>
            </div>
          </Group>
        </Card>

        <Card shadow="sm" padding="md" radius="md" withBorder>
          <Group>
            <ThemeIcon color="green" size="lg" radius="md">
              <IconHeart size={20} />
            </ThemeIcon>
            <div>
              <Text size="xs" c="dimmed">
                FEVI Basal
              </Text>
              <Text fw={700} size="xl">
                {baselineLVEF !== undefined ? `${baselineLVEF}%` : 'N/D'}
              </Text>
            </div>
          </Group>
        </Card>

        <Card shadow="sm" padding="md" radius="md" withBorder>
          <Group>
            <ThemeIcon color={lvefDrop !== undefined && lvefDrop >= 10 ? 'red' : 'orange'} size="lg" radius="md">
              <IconAlertTriangle size={20} />
            </ThemeIcon>
            <div>
              <Text size="xs" c="dimmed">
                Caída de FEVI
              </Text>
              <Text fw={700} size="xl" c={lvefDrop !== undefined && lvefDrop >= 10 ? 'red' : undefined}>
                {lvefDrop !== undefined ? `${lvefDrop.toFixed(1)} pp` : 'N/D'}
              </Text>
            </div>
          </Group>
        </Card>
      </SimpleGrid>

      <Paper p="md" radius="md" withBorder>
        <Title order={5} mb="sm">
          Tendencia de FEVI — Fracción de Eyección del Ventrículo Izquierdo
        </Title>
        {lvefObservations.length > 0 ? (
          <LVEFChart chartData={chartData} />
        ) : (
          <Text c="dimmed" ta="center" py="xl">
            No hay observaciones de FEVI registradas. Ingrese los datos usando el código LOINC 8806-2 en la sección
            Observaciones.
          </Text>
        )}
      </Paper>

      <Grid>
        <Grid.Col span={6}>
          <Paper p="md" radius="md" withBorder h="100%">
            <Title order={5} mb="sm">
              <Group gap="xs">
                <IconPill size={18} />
                Medicaciones Oncológicas
              </Group>
            </Title>
            {medications.length > 0 ? (
              <Stack gap="xs">
                {medications.slice(0, 10).map((med) => (
                  <Group key={med.id} justify="space-between">
                    <Text size="sm">{getMedicationName(med)}</Text>
                    <Badge size="sm" variant="light" color="blue">
                      {formatDate(getMedicationDate(med))}
                    </Badge>
                  </Group>
                ))}
              </Stack>
            ) : (
              <Text c="dimmed" size="sm">
                No se registraron administraciones de medicamentos.
              </Text>
            )}
          </Paper>
        </Grid.Col>

        <Grid.Col span={6}>
          <Paper p="md" radius="md" withBorder h="100%">
            <Title order={5} mb="sm">
              Criterios ESC 2022 de Cardiotoxicidad
            </Title>
            <Stack gap="xs">
              <Group align="flex-start">
                <Badge color="red" variant="filled" size="sm" mt={2}>
                  ROJO
                </Badge>
                <Text size="sm" style={{ flex: 1 }}>
                  Caída FEVI ≥10 pp a &lt;50%: Cardiotoxicidad confirmada — suspender y derivar urgente
                </Text>
              </Group>
              <Group align="flex-start">
                <Badge color="yellow" variant="filled" size="sm" mt={2}>
                  AMARILLO
                </Badge>
                <Text size="sm" style={{ flex: 1 }}>
                  Caída FEVI ≥10 pp (FEVI ≥50%) o FEVI 50–54%: Monitoreo cardiológico estrecho
                </Text>
              </Group>
              <Group align="flex-start">
                <Badge color="green" variant="filled" size="sm" mt={2}>
                  VERDE
                </Badge>
                <Text size="sm" style={{ flex: 1 }}>
                  FEVI ≥55% sin caída significativa: Continuar tratamiento con monitoreo periódico
                </Text>
              </Group>
            </Stack>
          </Paper>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
