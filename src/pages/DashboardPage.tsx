// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import type { Bundle, Condition, Encounter, MedicationRequest, Observation, Patient } from '@medplum/fhirtypes';
import { useMedplum, useMedplumProfile } from '@medplum/react';
import { IconAlertTriangle, IconCalendar, IconEye, IconPill, IconPlus, IconUser, IconUsers } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { Link, useNavigate } from 'react-router';
import { CreateEncounter } from '../components/actions/CreateEncounter';
import { isOncologyMedication } from '../oncologyMedications';

// ---------------------------------------------------------------------------
// Pure helper — copied inline from CardiotoxicityDashboard (no UI mixed in)
// ---------------------------------------------------------------------------
type ESCRiskLevel = 'red' | 'yellow' | 'green' | 'unknown';

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

// ---------------------------------------------------------------------------
// Bundle helper
// ---------------------------------------------------------------------------
function extractFromBundle<T extends { resourceType: string }>(bundle: Bundle, rt: string): T[] {
  return (bundle.entry ?? [])
    .filter((e) => e.resource?.resourceType === rt)
    .map((e) => e.resource as T);
}

// ---------------------------------------------------------------------------
// Oncology condition matcher
// ---------------------------------------------------------------------------
const ONCOLOGY_TEXT_KEYWORDS = [
  'cancer', 'cáncer', 'carcinoma', 'tumor', 'linfoma',
  'leucemia', 'melanoma', 'mama', 'pulmón', 'colon', 'mieloma',
];

function isOncologyCondition(condition: Condition): boolean {
  const codings = condition.code?.coding ?? [];
  for (const coding of codings) {
    const code = coding.code ?? '';
    if (/^C\d/.test(code)) return true;
    if (/^D([0-3]\d|4[0-9])/.test(code)) return true;
  }
  const text = (condition.code?.text ?? '').toLowerCase();
  return ONCOLOGY_TEXT_KEYWORDS.some((kw) => text.includes(kw));
}

// ---------------------------------------------------------------------------
// Period formatter
// ---------------------------------------------------------------------------
function formatPeriod(dateStr: string | undefined): string {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  const now = new Date();

  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();

  const hh = date.getHours().toString().padStart(2, '0');
  const mm = date.getMinutes().toString().padStart(2, '0');

  if (isToday) return `Hoy, ${hh}:${mm}`;
  if (isYesterday) return `Ayer, ${hh}:${mm}`;

  const day = date.getDate();
  const months = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];
  return `${day} de ${months[date.getMonth()]}`;
}

// ---------------------------------------------------------------------------
// Patient name formatter
// ---------------------------------------------------------------------------
function formatPatientName(patient: Patient | undefined): string {
  if (!patient) return '—';
  const name = patient.name?.[0];
  if (!name) return '—';
  const given = name.given?.join(' ') ?? '';
  const family = name.family ?? '';
  return [given, family].filter(Boolean).join(' ') || '—';
}

// ---------------------------------------------------------------------------
// Risk badge
// ---------------------------------------------------------------------------
function RiskBadge({ level }: { level: ESCRiskLevel }): JSX.Element {
  const borderColor: Record<ESCRiskLevel, string> = {
    red: 'var(--mantine-color-red-6)',
    yellow: 'var(--mantine-color-yellow-6)',
    green: 'var(--mantine-color-green-6)',
    unknown: 'var(--mantine-color-gray-4)',
  };

  const badge =
    level === 'red' ? (
      <Badge color="red" variant="filled">Riesgo Alto</Badge>
    ) : level === 'yellow' ? (
      <Badge color="yellow" variant="filled">Moderado</Badge>
    ) : level === 'green' ? (
      <Badge color="green" variant="filled">Estable</Badge>
    ) : (
      <Badge color="gray" variant="light">Sin FEVI</Badge>
    );

  return (
    <div style={{ borderLeft: `3px solid ${borderColor[level]}`, paddingLeft: 8 }}>
      {badge}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI card
// ---------------------------------------------------------------------------
interface KpiCardProps {
  label: string;
  value: number | string;
  sublabel?: string;
  icon: JSX.Element;
  color: string;
  loading: boolean;
}

function KpiCard({ label, value, sublabel, icon, color, loading }: KpiCardProps): JSX.Element {
  return (
    <Paper p="md" radius="md" withBorder>
      {loading ? (
        <Stack gap="xs">
          <Skeleton height={20} width="60%" />
          <Skeleton height={36} width="40%" />
          <Skeleton height={14} width="50%" />
        </Stack>
      ) : (
        <Group wrap="nowrap" align="flex-start">
          <ThemeIcon color={color} size={44} radius="md">
            {icon}
          </ThemeIcon>
          <div>
            <Text size="xs" c="dimmed" fw={600} tt="uppercase">
              {label}
            </Text>
            <Text fw={700} size="xl" lh={1.2}>
              {value}
            </Text>
            {sublabel && (
              <Text size="xs" c="dimmed" mt={2}>
                {sublabel}
              </Text>
            )}
          </div>
        </Group>
      )}
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Dashboard state
// ---------------------------------------------------------------------------
interface DashboardData {
  encounters: Encounter[];
  patientMap: Map<string, Patient>;
  lvefByPatient: Map<string, Observation[]>;
  oncologyConditionByPatient: Map<string, Condition>;
  totalPatients: number;
  todayEncounterCount: number;
  activeOncologyMedCount: number;
}

// ---------------------------------------------------------------------------
// DashboardPage
// ---------------------------------------------------------------------------
export function DashboardPage(): JSX.Element {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const navigate = useNavigate();
  const [opened, handlers] = useDisclosure(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [data, setData] = useState<DashboardData | undefined>(undefined);

  const firstName = (profile as Patient | undefined)?.name?.[0]?.given?.[0] ?? 'Doctor';
  const todayLabel = new Date().toLocaleDateString('es-AR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  useEffect(() => {
    async function loadDashboard(): Promise<void> {
      try {
        // 1. Recent encounters + linked Patients
        const encounterBundle = await medplum.search('Encounter', {
          _sort: '-date',
          _count: '20',
          _include: 'Encounter:subject',
        }) as Bundle;

        const encounters = extractFromBundle<Encounter>(encounterBundle, 'Encounter');
        const patients = extractFromBundle<Patient>(encounterBundle, 'Patient');

        const patientMap = new Map<string, Patient>();
        for (const p of patients) {
          if (p.id) patientMap.set(p.id, p);
        }

        // Collect patient IDs from encounters
        const patientIds = Array.from(
          new Set(
            encounters
              .map((e) => e.subject?.reference?.replace('Patient/', ''))
              .filter((id): id is string => Boolean(id))
          )
        );

        let lvefByPatient = new Map<string, Observation[]>();
        let oncologyConditionByPatient = new Map<string, Condition>();
        let activeOncologyMedCount = 0;

        if (patientIds.length > 0) {
          const idList = patientIds.join(',');

          // 2. LVEF observations for all patients
          const lvefBundle = await medplum.search('Observation', {
            code: '8806-2',
            patient: idList,
            _sort: 'date',
            _count: '200',
          }) as Bundle;

          const lvefObs = extractFromBundle<Observation>(lvefBundle, 'Observation');
          for (const obs of lvefObs) {
            const ref = obs.subject?.reference ?? '';
            const pid = ref.replace('Patient/', '');
            if (!pid) continue;
            const existing = lvefByPatient.get(pid) ?? [];
            existing.push(obs);
            lvefByPatient.set(pid, existing);
          }

          // 3. Conditions
          const condBundle = await medplum.search('Condition', {
            patient: idList,
            _count: '200',
          }) as Bundle;

          const conditions = extractFromBundle<Condition>(condBundle, 'Condition');
          for (const cond of conditions) {
            if (!isOncologyCondition(cond)) continue;
            const ref = cond.subject?.reference ?? '';
            const pid = ref.replace('Patient/', '');
            if (!pid) continue;
            if (!oncologyConditionByPatient.has(pid)) {
              oncologyConditionByPatient.set(pid, cond);
            }
          }

          // 4. Active medication requests
          const medBundle = await medplum.search('MedicationRequest', {
            patient: idList,
            status: 'active',
            _count: '200',
          }) as Bundle;

          const meds = extractFromBundle<MedicationRequest>(medBundle, 'MedicationRequest');
          for (const med of meds) {
            const name =
              med.medicationCodeableConcept?.text ??
              med.medicationCodeableConcept?.coding?.[0]?.display ??
              '';
            const codings = med.medicationCodeableConcept?.coding ?? [];
            if (isOncologyMedication(name, codings)) activeOncologyMedCount++;
          }
        }

        // 5. Total patient count
        const patientCountBundle = await medplum.search('Patient', {
          _count: '0',
          _summary: 'count',
        }) as Bundle;
        const totalPatients = patientCountBundle.total ?? 0;

        // 6. Today's encounter count
        const todayISO = new Date().toISOString().slice(0, 10);
        const todayBundle = await medplum.search('Encounter', {
          date: `ge${todayISO}`,
          _count: '0',
          _summary: 'count',
        }) as Bundle;
        const todayEncounterCount = todayBundle.total ?? 0;

        setData({
          encounters,
          patientMap,
          lvefByPatient,
          oncologyConditionByPatient,
          totalPatients,
          todayEncounterCount,
          activeOncologyMedCount,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }

    loadDashboard().catch(console.error);
  }, [medplum]);

  // Derived KPI: critical alerts
  const criticalAlerts = data
    ? Array.from(data.lvefByPatient.entries()).filter(
        ([, obs]) => computeESCRisk(obs) === 'red'
      ).length
    : 0;

  return (
    <Stack gap="xl" p="md">
      <CreateEncounter opened={opened} handlers={handlers} />

      {/* Greeting */}
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={2}>¡Buen día, Dr. {firstName}!</Title>
          <Text c="dimmed" size="sm" mt={4} tt="capitalize">
            {todayLabel}
          </Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={handlers.open}>
          Nuevo Encuentro
        </Button>
      </Group>

      {/* Error */}
      {error && (
        <Alert color="red" icon={<IconAlertTriangle size={18} />} title="Error al cargar datos">
          {error}
        </Alert>
      )}

      {/* KPI Cards */}
      <SimpleGrid cols={4}>
        <KpiCard
          label="Pacientes Registrados"
          value={data?.totalPatients ?? 0}
          icon={<IconUsers size={22} />}
          color="blue"
          loading={loading}
        />
        <KpiCard
          label="Alertas Críticas"
          value={criticalAlerts}
          sublabel="FEVI crítica (ESC 2022)"
          icon={<IconAlertTriangle size={22} />}
          color={criticalAlerts > 0 ? 'red' : 'gray'}
          loading={loading}
        />
        <KpiCard
          label="Encuentros Hoy"
          value={data?.todayEncounterCount ?? 0}
          icon={<IconCalendar size={22} />}
          color="violet"
          loading={loading}
        />
        <KpiCard
          label="Tratamientos Oncológicos Activos"
          value={data?.activeOncologyMedCount ?? 0}
          sublabel="Drogas cardiotóxicas"
          icon={<IconPill size={22} />}
          color="orange"
          loading={loading}
        />
      </SimpleGrid>

      {/* Encounter table */}
      <div>
        <Group justify="space-between" mb="sm">
          <Title order={4}>Encuentros Recientes</Title>
          <Text size="sm" component={Link} to="/Encounter" c="blue">
            Ver todos
          </Text>
        </Group>

        <Paper radius="md" withBorder style={{ overflow: 'hidden' }}>
          {loading ? (
            <Stack gap={0}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} style={{ padding: '12px 16px', borderBottom: '1px solid var(--mantine-color-gray-2)' }}>
                  <Skeleton height={18} width={`${60 + (i % 3) * 10}%`} />
                </div>
              ))}
            </Stack>
          ) : !data || data.encounters.length === 0 ? (
            <Stack align="center" py="xl" gap="xs">
              <IconCalendar size={32} style={{ color: 'var(--mantine-color-gray-5)' }} />
              <Text c="dimmed">No hay encuentros registrados</Text>
            </Stack>
          ) : (
            <Table highlightOnHover>
              <Table.Thead style={{ background: '#f8fafc' }}>
                <Table.Tr>
                  {['Paciente', 'Diagnóstico Oncológico', 'Riesgo FEVI', 'Período', 'Acciones'].map((col) => (
                    <Table.Th
                      key={col}
                      style={{
                        fontWeight: 700,
                        fontSize: 'var(--mantine-font-size-xs)',
                        textTransform: 'uppercase',
                        color: 'var(--mantine-color-dimmed)',
                      }}
                    >
                      {col}
                    </Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.encounters.map((encounter) => {
                  const patientId = encounter.subject?.reference?.replace('Patient/', '');
                  const patient = patientId ? data.patientMap.get(patientId) : undefined;
                  const patientName = formatPatientName(patient);

                  const oncoCond = patientId ? data.oncologyConditionByPatient.get(patientId) : undefined;
                  const diagText =
                    oncoCond?.code?.text ??
                    oncoCond?.code?.coding?.[0]?.display ??
                    '—';

                  const lvefObs = patientId ? (data.lvefByPatient.get(patientId) ?? []) : [];
                  const riskLevel = computeESCRisk(lvefObs);

                  const periodStr = formatPeriod(encounter.period?.start);

                  return (
                    <Table.Tr key={encounter.id} style={{ cursor: 'pointer' }}>
                      <Table.Td>
                        {patientId ? (
                          <Text
                            size="sm"
                            fw={500}
                            component={Link}
                            to={`/Patient/${patientId}`}
                            style={{ textDecoration: 'none', color: 'inherit' }}
                          >
                            {patientName}
                          </Text>
                        ) : (
                          <Text size="sm">{patientName}</Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" c={diagText === '—' ? 'dimmed' : undefined}>
                          {diagText}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <RiskBadge level={riskLevel} />
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{periodStr}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap="xs">
                          <ActionIcon
                            variant="subtle"
                            color="blue"
                            title="Ver encuentro"
                            onClick={() => navigate(`/Encounter/${encounter.id}`)?.catch(console.error)}
                          >
                            <IconEye size={16} />
                          </ActionIcon>
                          {patientId && (
                            <ActionIcon
                              variant="subtle"
                              color="gray"
                              title="Ver paciente"
                              onClick={() => navigate(`/Patient/${patientId}`)?.catch(console.error)}
                            >
                              <IconUser size={16} />
                            </ActionIcon>
                          )}
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          )}
        </Paper>
      </div>
    </Stack>
  );
}
