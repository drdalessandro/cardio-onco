// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import type { Coding, MedicationRequest, Patient, ServiceRequest } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import {
  IconCalendar,
  IconCircleCheck,
  IconCircleOff,
  IconClockExclamation,
  IconPill,
  IconPlus,
  IconRefresh,
} from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { isOncologyMedication } from '../oncologyMedications';

// ---------------------------------------------------------------------------
// LOINC codes for monitoring types
// ---------------------------------------------------------------------------
const MONITORING_CODES: Record<string, Coding> = {
  echo:     { system: 'http://loinc.org', code: '8806-2',  display: 'Ecocardiograma — FEVI' },
  troponin: { system: 'http://loinc.org', code: '89579-7', display: 'Troponina I de alta sensibilidad' },
  bnp:      { system: 'http://loinc.org', code: '33762-6', display: 'NT-proBNP' },
  ecg:      { system: 'http://loinc.org', code: '11524-6', display: 'ECG de 12 derivaciones' },
  bp:       { system: 'http://loinc.org', code: '85354-9', display: 'Presión arterial' },
};

type MonitoringType = keyof typeof MONITORING_CODES;

// ---------------------------------------------------------------------------
// Drug class classification
// ---------------------------------------------------------------------------
type DrugClass = 'anthracycline' | 'her2' | 'checkpoint' | 'vegf' | 'bcr-abl' | 'other';

function normStr(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function classifyDrug(name: string): DrugClass {
  const n = normStr(name);
  if (['doxorrubicina', 'epirrubicina', 'idarrubicina', 'daunorrubicina', 'mitoxantrona'].some((d) => n.includes(normStr(d))))
    return 'anthracycline';
  if (['trastuzumab', 'pertuzumab', 'lapatinib', 'neratinib', 'tdm1', 't-dm1'].some((d) => n.includes(d)))
    return 'her2';
  if (['pembrolizumab', 'nivolumab', 'ipilimumab', 'atezolizumab', 'durvalumab', 'avelumab'].some((d) => n.includes(d)))
    return 'checkpoint';
  if (['bevacizumab', 'sunitinib', 'sorafenib', 'pazopanib', 'regorafenib', 'lenvatinib', 'cabozantinib'].some((d) => n.includes(d)))
    return 'vegf';
  if (['imatinib', 'dasatinib', 'nilotinib', 'bosutinib', 'ponatinib', 'ibrutinib', 'acalabrutinib'].some((d) => n.includes(d)))
    return 'bcr-abl';
  return 'other';
}

// ---------------------------------------------------------------------------
// Monitoring protocol: offsetDays relative to treatment start
// ---------------------------------------------------------------------------
interface ProtocolItem {
  offsetDays: number;
  type: MonitoringType;
  label: string;
  reason: string; // ESC 2022 section reference
}

const PROTOCOLS: Record<DrugClass, ProtocolItem[]> = {
  anthracycline: [
    { offsetDays: 0,   type: 'echo',     label: 'Eco basal — FEVI',            reason: 'ESC 2022 §5.2 — Evaluación basal obligatoria' },
    { offsetDays: 0,   type: 'troponin', label: 'Troponina basal',             reason: 'ESC 2022 §5.2 — Biomarcadores basales' },
    { offsetDays: 0,   type: 'bnp',      label: 'NT-proBNP basal',             reason: 'ESC 2022 §5.2 — Biomarcadores basales' },
    { offsetDays: 90,  type: 'echo',     label: 'Eco 3 meses post-tratamiento', reason: 'ESC 2022 §5.2 — Seguimiento post-tratamiento' },
    { offsetDays: 365, type: 'echo',     label: 'Eco 12 meses post-tratamiento', reason: 'ESC 2022 §5.2 — Control anual post-tratamiento' },
  ],
  her2: [
    { offsetDays: 0,   type: 'echo',     label: 'Eco basal — FEVI',      reason: 'ESC 2022 §6.2 — Evaluación basal obligatoria' },
    { offsetDays: 90,  type: 'echo',     label: 'Eco 3 meses (Ciclo 4)', reason: 'ESC 2022 §6.2 — Control cada 3 meses durante tratamiento' },
    { offsetDays: 180, type: 'echo',     label: 'Eco 6 meses',           reason: 'ESC 2022 §6.2 — Control cada 3 meses durante tratamiento' },
    { offsetDays: 270, type: 'echo',     label: 'Eco 9 meses',           reason: 'ESC 2022 §6.2 — Control cada 3 meses durante tratamiento' },
    { offsetDays: 365, type: 'echo',     label: 'Eco 12 meses post-tto', reason: 'ESC 2022 §6.2 — Control anual post-tratamiento' },
  ],
  checkpoint: [
    { offsetDays: 0,   type: 'ecg',      label: 'ECG basal',                  reason: 'ESC 2022 §8.3 — Evaluación basal ICI' },
    { offsetDays: 0,   type: 'troponin', label: 'Troponina basal',            reason: 'ESC 2022 §8.3 — Biomarcadores basales ICI' },
    { offsetDays: 0,   type: 'bnp',      label: 'NT-proBNP basal',            reason: 'ESC 2022 §8.3 — Biomarcadores basales ICI' },
    { offsetDays: 21,  type: 'troponin', label: 'Troponina pre-ciclo 2',      reason: 'ESC 2022 §8.3 — Troponina antes de cada ciclo' },
    { offsetDays: 42,  type: 'troponin', label: 'Troponina pre-ciclo 3',      reason: 'ESC 2022 §8.3 — Troponina antes de cada ciclo' },
    { offsetDays: 63,  type: 'troponin', label: 'Troponina pre-ciclo 4',      reason: 'ESC 2022 §8.3 — Troponina antes de cada ciclo' },
  ],
  vegf: [
    { offsetDays: 0,   type: 'echo',     label: 'Eco basal — FEVI',           reason: 'ESC 2022 §7.2 — Evaluación basal anti-VEGF' },
    { offsetDays: 0,   type: 'ecg',      label: 'ECG basal',                  reason: 'ESC 2022 §7.2 — Evaluación basal anti-VEGF' },
    { offsetDays: 0,   type: 'bp',       label: 'TA basal',                   reason: 'ESC 2022 §7.2 — TA en cada visita' },
    { offsetDays: 90,  type: 'echo',     label: 'Eco 3 meses',                reason: 'ESC 2022 §7.2 — FEVI cada 3 meses' },
    { offsetDays: 180, type: 'echo',     label: 'Eco 6 meses',                reason: 'ESC 2022 §7.2 — FEVI cada 3 meses' },
  ],
  'bcr-abl': [
    { offsetDays: 0,   type: 'echo',     label: 'Eco basal — FEVI',           reason: 'ESC 2022 §9.3 — Evaluación cardiovascular basal' },
    { offsetDays: 0,   type: 'ecg',      label: 'ECG basal (QTc)',            reason: 'ESC 2022 §9.3 — QTc basal obligatorio' },
    { offsetDays: 180, type: 'echo',     label: 'Eco 6 meses',                reason: 'ESC 2022 §9.3 — Seguimiento aterosclerótico' },
    { offsetDays: 365, type: 'echo',     label: 'Eco anual',                  reason: 'ESC 2022 §9.3 — Seguimiento cardiovascular anual' },
  ],
  other: [
    { offsetDays: 0,   type: 'echo',     label: 'Eco basal — FEVI',           reason: 'ESC 2022 — Evaluación cardiovascular basal recomendada' },
  ],
};

// ---------------------------------------------------------------------------
// Task model
// ---------------------------------------------------------------------------
interface MonitoringTask {
  id: string; // drug-class-offset-type
  drugName: string;
  drugClass: DrugClass;
  type: MonitoringType;
  label: string;
  reason: string;
  dueDateISO: string;
  status: 'pending' | 'overdue' | 'ordered';
  serviceRequestId?: string;
}

function addDays(dateISO: string, days: number): string {
  const d = new Date(dateISO);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function taskStatus(dueDateISO: string, serviceRequestId?: string): 'pending' | 'overdue' | 'ordered' {
  if (serviceRequestId) return 'ordered';
  return new Date(dueDateISO) < new Date() ? 'overdue' : 'pending';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
interface MonitoringScheduleProps {
  patient: Patient;
}

export function MonitoringSchedule({ patient }: MonitoringScheduleProps): JSX.Element {
  const medplum = useMedplum();
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<MonitoringTask[]>([]);
  const [activeDrugs, setActiveDrugs] = useState<{ name: string; class: DrugClass; startDate: string }[]>([]);
  const [creatingAll, setCreatingAll] = useState(false);
  const [creatingId, setCreatingId] = useState<string | undefined>();

  const loadSchedule = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const patientRef = `Patient/${patient.id}`;

      // Load active oncology medication requests
      const meds = await medplum.searchResources('MedicationRequest', {
        patient: patientRef,
        status: 'active',
        _count: '100',
      });

      const oncologyMeds = meds
        .filter((m) => {
          const name = m.medicationCodeableConcept?.text ?? m.medicationCodeableConcept?.coding?.[0]?.display ?? '';
          return isOncologyMedication(name, m.medicationCodeableConcept?.coding ?? []);
        })
        .map((m) => ({
          name: m.medicationCodeableConcept?.text ?? m.medicationCodeableConcept?.coding?.[0]?.display ?? 'Medicación oncológica',
          class: classifyDrug(
            m.medicationCodeableConcept?.text ?? m.medicationCodeableConcept?.coding?.[0]?.display ?? ''
          ),
          startDate: m.authoredOn ?? new Date().toISOString(),
          id: m.id ?? '',
        }));

      setActiveDrugs(oncologyMeds.map(({ name, class: c, startDate }) => ({ name, class: c, startDate })));

      // Load existing ServiceRequests for this patient (monitoring orders)
      const existingSR = await medplum.searchResources('ServiceRequest', {
        subject: patientRef,
        _count: '200',
      });

      // Build a lookup: loinc-code + approx-date → ServiceRequest.id
      const srLookup = new Map<string, string>();
      for (const sr of existingSR) {
        const code = sr.code?.coding?.[0]?.code ?? '';
        const date = (sr.occurrenceDateTime ?? '').slice(0, 10);
        if (code && date) srLookup.set(`${code}::${date}`, sr.id ?? '');
      }

      // Generate tasks from protocols
      const generatedTasks: MonitoringTask[] = [];
      const seen = new Set<string>();

      for (const drug of oncologyMeds) {
        const protocol = PROTOCOLS[drug.class];
        for (const item of protocol) {
          const dueISO = addDays(drug.startDate, item.offsetDays);
          const dueDate = dueISO.slice(0, 10);
          const loincCode = MONITORING_CODES[item.type].code ?? '';
          const taskId = `${drug.class}-${item.offsetDays}-${item.type}`;

          if (seen.has(taskId)) continue; // deduplicate same protocol items across identical drug classes
          seen.add(taskId);

          const srId = srLookup.get(`${loincCode}::${dueDate}`);
          generatedTasks.push({
            id: taskId,
            drugName: drug.name,
            drugClass: drug.class,
            type: item.type,
            label: item.label,
            reason: item.reason,
            dueDateISO: dueISO,
            status: taskStatus(dueISO, srId),
            serviceRequestId: srId,
          });
        }
      }

      // Sort by due date
      generatedTasks.sort((a, b) => a.dueDateISO.localeCompare(b.dueDateISO));
      setTasks(generatedTasks);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [medplum, patient.id]);

  useEffect(() => {
    loadSchedule().catch(console.error);
  }, [loadSchedule]);

  async function createServiceRequest(task: MonitoringTask): Promise<void> {
    if (!patient.id) return;
    const coding = MONITORING_CODES[task.type];
    const sr: ServiceRequest = {
      resourceType: 'ServiceRequest',
      status: 'active',
      intent: 'order',
      subject: { reference: `Patient/${patient.id}` },
      code: { coding: [coding], text: task.label },
      occurrenceDateTime: task.dueDateISO,
      reasonCode: [{ text: task.reason }],
      note: [{ text: `Generado por Plan de Monitoreo ESC 2022. Droga: ${task.drugName}` }],
    };
    await medplum.createResource(sr);
  }

  async function handleCreateOne(task: MonitoringTask): Promise<void> {
    setCreatingId(task.id);
    try {
      await createServiceRequest(task);
      showNotification({ icon: <IconCircleCheck />, color: 'green', title: 'Orden creada', message: task.label });
      await loadSchedule();
    } catch (err) {
      showNotification({ icon: <IconCircleOff />, color: 'red', title: 'Error', message: String(err) });
    } finally {
      setCreatingId(undefined);
    }
  }

  async function handleCreateAll(): Promise<void> {
    const pending = tasks.filter((t) => t.status !== 'ordered');
    if (pending.length === 0) return;
    setCreatingAll(true);
    try {
      await Promise.all(pending.map(createServiceRequest));
      showNotification({ icon: <IconCircleCheck />, color: 'green', title: 'Plan generado', message: `${pending.length} órdenes creadas` });
      await loadSchedule();
    } catch (err) {
      showNotification({ icon: <IconCircleOff />, color: 'red', title: 'Error', message: String(err) });
    } finally {
      setCreatingAll(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <Stack gap="md">
      <Group justify="space-between" align="center">
        <Group gap="xs">
          <IconCalendar size={18} />
          <Title order={5}>Calendario de Monitoreo ESC 2022</Title>
        </Group>
        <Group gap="xs">
          <ActionIcon variant="subtle" onClick={() => loadSchedule()} title="Actualizar" disabled={loading}>
            <IconRefresh size={16} />
          </ActionIcon>
          {tasks.some((t) => t.status !== 'ordered') && (
            <Button
              size="xs"
              leftSection={<IconPlus size={14} />}
              onClick={handleCreateAll}
              loading={creatingAll}
            >
              Generar Plan Completo
            </Button>
          )}
        </Group>
      </Group>

      {/* Active drugs detected */}
      {!loading && activeDrugs.length > 0 && (
        <Group gap="xs" wrap="wrap">
          <Text size="xs" c="dimmed" fw={600}>TRATAMIENTOS DETECTADOS:</Text>
          {activeDrugs.map((d, i) => (
            <Badge key={i} size="sm" variant="light" color="violet" leftSection={<IconPill size={10} />}>
              {d.name}
            </Badge>
          ))}
        </Group>
      )}

      <Divider />

      {loading ? (
        <Group><Loader size="sm" /><Text size="sm" c="dimmed">Generando calendario ESC 2022…</Text></Group>
      ) : tasks.length === 0 ? (
        <Alert color="gray" icon={<IconCalendar size={18} />} title="Sin tratamientos oncológicos activos">
          <Text size="sm">
            No se encontraron medicaciones oncológicas activas para este paciente. Registrá el tratamiento en
            MedicationRequest para generar el calendario de monitoreo automáticamente.
          </Text>
        </Alert>
      ) : (
        <Table highlightOnHover withTableBorder>
          <Table.Thead style={{ background: '#f8fafc' }}>
            <Table.Tr>
              {['Estudio / Control', 'Droga', 'Fecha Recomendada', 'Referencia ESC 2022', 'Estado', 'Acción'].map((h) => (
                <Table.Th
                  key={h}
                  style={{ fontWeight: 700, fontSize: 'var(--mantine-font-size-xs)', textTransform: 'uppercase', color: 'var(--mantine-color-dimmed)' }}
                >
                  {h}
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {tasks.map((task) => (
              <Table.Tr key={task.id}>
                <Table.Td>
                  <Group gap="xs">
                    <TypeIcon type={task.type} />
                    <Text size="sm" fw={500}>{task.label}</Text>
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c="dimmed">{task.drugName}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{formatDate(task.dueDateISO)}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed">{task.reason}</Text>
                </Table.Td>
                <Table.Td>
                  <StatusBadge status={task.status} />
                </Table.Td>
                <Table.Td>
                  {task.status !== 'ordered' ? (
                    <Tooltip label="Crear orden de monitoreo (ServiceRequest)">
                      <ActionIcon
                        size="sm"
                        variant="light"
                        color="blue"
                        loading={creatingId === task.id}
                        onClick={() => handleCreateOne(task)}
                      >
                        <IconPlus size={14} />
                      </ActionIcon>
                    </Tooltip>
                  ) : (
                    <Text size="xs" c="dimmed">—</Text>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Text size="xs" c="dimmed">
        Las fechas se calculan desde la fecha de prescripción (MedicationRequest.authoredOn). Las órdenes se almacenan
        como recursos FHIR R4 ServiceRequest vinculados al paciente.
      </Text>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Small helper components
// ---------------------------------------------------------------------------
function TypeIcon({ type }: { type: MonitoringType }): JSX.Element {
  const iconMap: Record<MonitoringType, { color: string; label: string }> = {
    echo:     { color: 'blue',   label: 'ECO' },
    troponin: { color: 'red',    label: 'TRP' },
    bnp:      { color: 'violet', label: 'BNP' },
    ecg:      { color: 'teal',   label: 'ECG' },
    bp:       { color: 'orange', label: 'TA'  },
  };
  const meta = iconMap[type];
  return (
    <ThemeIcon color={meta.color} size={22} radius="sm" variant="light">
      <Text size="8px" fw={800}>{meta.label}</Text>
    </ThemeIcon>
  );
}

function StatusBadge({ status }: { status: MonitoringTask['status'] }): JSX.Element {
  if (status === 'ordered') {
    return (
      <Badge color="green" variant="light" size="sm" leftSection={<IconCircleCheck size={10} />}>
        Ordenado
      </Badge>
    );
  }
  if (status === 'overdue') {
    return (
      <Badge color="red" variant="filled" size="sm" leftSection={<IconClockExclamation size={10} />}>
        Vencido
      </Badge>
    );
  }
  return (
    <Badge color="blue" variant="light" size="sm">
      Pendiente
    </Badge>
  );
}
