// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * Mis turnos — portado del fork anterior (Tailwind → Mantine 8).
 *
 * El `GetCarePage` del upstream permite **reservar** un turno (BaseScheduler),
 * pero no muestra los que el paciente ya tiene. Esta página cubre ese hueco:
 * lista los turnos separando próximos de anteriores.
 */
import { Badge, Card, Group, Stack, Text, Title } from '@mantine/core';
import { formatDateTime, getReferenceString } from '@medplum/core';
import type { Appointment, Patient } from '@medplum/fhirtypes';
import { Document, useMedplum } from '@medplum/react';
import { IconCalendar, IconCalendarOff } from '@tabler/icons-react';
import type { JSX } from 'react';

/** Nombre del profesional que figura entre los participantes del turno. */
export function getPractitionerName(appointment: Appointment): string | undefined {
  return appointment.participant?.find((p) => p.actor?.reference?.startsWith('Practitioner/'))?.actor?.display;
}

/** Etiqueta y color según el estado FHIR del turno. */
const STATUS: Record<string, { label: string; color: string }> = {
  booked: { label: 'Confirmado', color: 'teal' },
  pending: { label: 'A confirmar', color: 'yellow' },
  arrived: { label: 'Presente', color: 'blue' },
  fulfilled: { label: 'Realizado', color: 'gray' },
  cancelled: { label: 'Cancelado', color: 'red' },
  noshow: { label: 'No asistió', color: 'red' },
  proposed: { label: 'Propuesto', color: 'yellow' },
  waitlist: { label: 'En espera', color: 'yellow' },
};

function AppointmentCard({ appointment }: { appointment: Appointment }): JSX.Element {
  const status = STATUS[appointment.status ?? ''] ?? { label: appointment.status ?? '—', color: 'gray' };
  const practitioner = getPractitionerName(appointment);
  return (
    <Card withBorder radius="md" padding="md">
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <div>
          <Text fw={500}>{appointment.start ? formatDateTime(appointment.start) : 'Sin fecha'}</Text>
          {appointment.serviceType?.[0]?.text && (
            <Text size="sm" c="dimmed">
              {appointment.serviceType[0].text}
            </Text>
          )}
          {practitioner && (
            <Text size="sm" c="dimmed">
              {practitioner}
            </Text>
          )}
          {appointment.description && <Text size="sm">{appointment.description}</Text>}
        </div>
        <Badge color={status.color} variant="light">
          {status.label}
        </Badge>
      </Group>
    </Card>
  );
}

export function MyAppointmentsPage(): JSX.Element {
  const medplum = useMedplum();
  const patient = medplum.getProfile() as Patient;
  const appointments = medplum
    .searchResources('Appointment', `patient=${getReferenceString(patient)}&_sort=-date&_count=100`)
    .read();

  const now = new Date().toISOString();
  const upcoming = appointments.filter((a) => (a.start ?? '') >= now).reverse();
  const past = appointments.filter((a) => (a.start ?? '') < now);

  return (
    <Document width={800}>
      <Stack gap="lg">
        <div>
          <Title order={2}>Mis turnos</Title>
          <Text c="dimmed" size="sm">
            Tus controles con el equipo de cardio-oncología.
          </Text>
        </div>

        <Stack gap="xs">
          <Group gap={6}>
            <IconCalendar size={18} />
            <Title order={3} size="h4">
              Próximos
            </Title>
          </Group>
          {upcoming.length ? (
            upcoming.map((a) => <AppointmentCard key={a.id} appointment={a} />)
          ) : (
            <Text c="dimmed" size="sm">
              No tenés turnos programados.
            </Text>
          )}
        </Stack>

        {past.length > 0 && (
          <Stack gap="xs">
            <Group gap={6}>
              <IconCalendarOff size={18} />
              <Title order={3} size="h4">
                Anteriores
              </Title>
            </Group>
            {past.map((a) => (
              <AppointmentCard key={a.id} appointment={a} />
            ))}
          </Stack>
        )}
      </Stack>
    </Document>
  );
}
