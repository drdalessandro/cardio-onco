// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import {
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Loader,
  Modal,
  NumberInput,
  Progress,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { showNotification } from '@mantine/notifications';
import type { Coding, MedicationAdministration, Patient, ServiceRequest } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import {
  IconAlertTriangle,
  IconCalendar,
  IconCircleCheck,
  IconCircleOff,
  IconClockExclamation,
  IconPill,
  IconPlus,
} from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';

// ---------------------------------------------------------------------------
// Anthracycline drug table — doxorubicin equivalence factors (ESC 2022 Table 5)
// ---------------------------------------------------------------------------
const ANTHRACYCLINE_DRUGS = [
  { label: 'Doxorrubicina',           value: 'doxorrubicina',  keywords: ['doxorrubicin', 'doxorubicin', 'adriamicin'],  factor: 1.0 },
  { label: 'Epirrubicina',            value: 'epirrubicina',   keywords: ['epirrubicin', 'epirubicin'],                   factor: 0.5 },
  { label: 'Daunorrubicina',          value: 'daunorrubicina', keywords: ['daunorrubicin', 'daunorubicin'],                factor: 0.5 },
  { label: 'Idarrubicina',            value: 'idarrubicina',   keywords: ['idarrubicin', 'idarubicin'],                    factor: 5.0 },
  { label: 'Mitoxantrona',            value: 'mitoxantrona',   keywords: ['mitoxantron'],                                  factor: 4.0 },
  { label: 'Doxorrubicina liposomal', value: 'liposomal',      keywords: ['liposomal', 'doxil', 'caelyx'],                factor: 0.5 },
] as const;

type DrugValue = typeof ANTHRACYCLINE_DRUGS[number]['value'];

function normStr(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function getAnthracyclineEntry(drugName: string): typeof ANTHRACYCLINE_DRUGS[number] | undefined {
  const n = normStr(drugName);
  return ANTHRACYCLINE_DRUGS.find((d) => d.keywords.some((kw) => n.includes(kw)));
}

// ---------------------------------------------------------------------------
// Dose risk classification (ESC 2022 HFA-ICOS thresholds, §4.1)
// ---------------------------------------------------------------------------
const MAX_DOSE_DISPLAY = 500;

interface DoseRisk { label: string; color: string; message: string }

function getDoseRisk(dose: number): DoseRisk {
  if (dose === 0) return { label: 'Sin datos', color: 'gray', message: 'Registrá las administraciones para calcular la dosis acumulada.' };
  if (dose >= 350) return { label: 'Muy Alto', color: 'red',    message: 'Dosis ≥ 350 mg/m² — Factor de riesgo MUY ALTO (ESC 2022 §4.1). Monitoreo intensivo obligatorio.' };
  if (dose >= 250) return { label: 'Alto',     color: 'orange', message: 'Dosis 250–349 mg/m² — Factor de riesgo ALTO (HFA-ICOS ESC 2022). Interconsulta cardiológica.' };
  if (dose >= 100) return { label: 'Moderado', color: 'yellow', message: 'Dosis 100–249 mg/m² — Riesgo moderado. Monitoreo estándar con ecocardiograma según ESC 2022.' };
  return { label: 'Bajo', color: 'green', message: 'Dosis < 100 mg/m² — Riesgo cardiotóxico bajo. Seguimiento cardiovascular estándar.' };
}

// ---------------------------------------------------------------------------
// Survivor follow-up protocols (ESC 2022 §12.2)
// ---------------------------------------------------------------------------
type SurvivorType = 'echo' | 'troponin' | 'bnp';

const SURVIVOR_LOINC: Record<SurvivorType, Coding> = {
  echo:     { system: 'http://loinc.org', code: '8806-2',  display: 'Ecocardiograma — FEVI' },
  troponin: { system: 'http://loinc.org', code: '89579-7', display: 'Troponina I de alta sensibilidad' },
  bnp:      { system: 'http://loinc.org', code: '33762-6', display: 'NT-proBNP' },
};

interface SurvivorItem { offsetMonths: number; type: SurvivorType; label: string; reason: string }

const SURVIVOR_PROTOCOLS: Record<'very-high' | 'high' | 'low', SurvivorItem[]> = {
  'very-high': [
    { offsetMonths: 3,   type: 'echo',     label: 'Eco 3 meses post-tratamiento',   reason: 'ESC 2022 §12.2 — Dosis ≥ 250 mg/m²' },
    { offsetMonths: 3,   type: 'troponin', label: 'Troponina 3 meses',              reason: 'ESC 2022 §12.2 — Biomarcadores 3 meses' },
    { offsetMonths: 3,   type: 'bnp',      label: 'NT-proBNP 3 meses',              reason: 'ESC 2022 §12.2 — Biomarcadores 3 meses' },
    { offsetMonths: 12,  type: 'echo',     label: 'Eco 1 año',                      reason: 'ESC 2022 §12.2 — Control al año' },
    { offsetMonths: 12,  type: 'troponin', label: 'Troponina 1 año',                reason: 'ESC 2022 §12.2 — Biomarcadores 1 año' },
    { offsetMonths: 24,  type: 'echo',     label: 'Eco 2 años',                     reason: 'ESC 2022 §12.2 — Control anual años 2–5' },
    { offsetMonths: 36,  type: 'echo',     label: 'Eco 3 años',                     reason: 'ESC 2022 §12.2 — Control anual años 2–5' },
    { offsetMonths: 48,  type: 'echo',     label: 'Eco 4 años',                     reason: 'ESC 2022 §12.2 — Control anual años 2–5' },
    { offsetMonths: 60,  type: 'echo',     label: 'Eco 5 años',                     reason: 'ESC 2022 §12.2 — Control anual años 2–5' },
    { offsetMonths: 96,  type: 'echo',     label: 'Eco 8 años',                     reason: 'ESC 2022 §12.2 — Control tardío' },
    { offsetMonths: 120, type: 'echo',     label: 'Eco 10 años',                    reason: 'ESC 2022 §12.2 — Control tardío 10 años' },
  ],
  high: [
    { offsetMonths: 12,  type: 'echo',     label: 'Eco 1 año post-tratamiento',     reason: 'ESC 2022 §12.2 — Dosis 100–249 mg/m²' },
    { offsetMonths: 12,  type: 'troponin', label: 'Troponina 1 año',                reason: 'ESC 2022 §12.2 — Biomarcadores 1 año' },
    { offsetMonths: 24,  type: 'echo',     label: 'Eco 2 años',                     reason: 'ESC 2022 §12.2 — Control cada 2 años' },
    { offsetMonths: 60,  type: 'echo',     label: 'Eco 5 años',                     reason: 'ESC 2022 §12.2 — Control a 5 años' },
    { offsetMonths: 120, type: 'echo',     label: 'Eco 10 años',                    reason: 'ESC 2022 §12.2 — Control tardío 10 años' },
  ],
  low: [
    { offsetMonths: 12,  type: 'echo',     label: 'Eco 1 año post-tratamiento',     reason: 'ESC 2022 §12.2 — Evaluación basal tardía' },
    { offsetMonths: 60,  type: 'echo',     label: 'Eco 5 años',                     reason: 'ESC 2022 §12.2 — Control tardío a 5 años' },
  ],
};

const CARDIO_ONCO_SYSTEM = 'https://cardio-onco.epa-bienestar.com.ar/fhir';

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------
interface AdminRecord {
  id: string;
  drugName: string;
  dosePerM2: number;
  factor: number;
  doxoEquivalent: number;
  date: string;
}

interface SurvivorTask {
  taskId: string;
  type: SurvivorType;
  label: string;
  reason: string;
  dueDateISO: string;
  status: 'pending' | 'overdue' | 'ordered';
  serviceRequestId?: string;
}

function parseAdminRecord(ma: MedicationAdministration): AdminRecord | undefined {
  const drugName =
    ma.medicationCodeableConcept?.text ??
    ma.medicationCodeableConcept?.coding?.[0]?.display ?? '';
  const entry = getAnthracyclineEntry(drugName);
  if (!entry) return undefined;
  const dose = ma.dosage?.dose?.value ?? 0;
  if (dose === 0) return undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const effectiveDate = (ma as any).effectiveDateTime ?? (ma as any).effectivePeriod?.start ?? '';
  return { id: ma.id ?? '', drugName: entry.label, dosePerM2: dose, factor: entry.factor, doxoEquivalent: dose * entry.factor, date: effectiveDate };
}

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function taskStatus(dueDateISO: string, srId?: string): SurvivorTask['status'] {
  if (srId) return 'ordered';
  return new Date(dueDateISO) < new Date() ? 'overdue' : 'pending';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
interface AnthracyclineSurvivorDashboardProps {
  patient: Patient;
}

export function AnthracyclineSurvivorDashboard({ patient }: AnthracyclineSurvivorDashboardProps): JSX.Element {
  const medplum = useMedplum();
  const [loading, setLoading] = useState(true);
  const [adminRecords, setAdminRecords] = useState<AdminRecord[]>([]);
  const [existingSurvivorSRs, setExistingSurvivorSRs] = useState<ServiceRequest[]>([]);
  const [survivorTasks, setSurvivorTasks] = useState<SurvivorTask[]>([]);
  const [endDate, setEndDate] = useState('');
  const [creatingAll, setCreatingAll] = useState(false);

  // Add administration modal
  const [addOpened, { open: openAdd, close: closeAdd }] = useDisclosure(false);
  const [selectedDrug, setSelectedDrug] = useState<string | null>(null);
  const [doseInput, setDoseInput] = useState<number | string>(60);
  const [dateInput, setDateInput] = useState('');
  const [savingAdmin, setSavingAdmin] = useState(false);

  // Derived
  const totalDoxoEq = adminRecords.reduce((sum, r) => sum + r.doxoEquivalent, 0);
  const doseRisk = getDoseRisk(totalDoxoEq);
  const progressValue = Math.min((totalDoxoEq / MAX_DOSE_DISPLAY) * 100, 100);

  // ---------------------------------------------------------------------------
  // Data loading — does NOT depend on endDate to avoid re-render loops
  // ---------------------------------------------------------------------------
  const loadData = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const patientRef = `Patient/${patient.id}`;
      const [maResults, srResults, obsResults] = await Promise.all([
        medplum.searchResources('MedicationAdministration', { patient: patientRef, _count: '200' }),
        medplum.searchResources('ServiceRequest', { subject: patientRef, _count: '200' }),
        medplum.searchResources('Observation', {
          patient: patientRef,
          code: `${CARDIO_ONCO_SYSTEM}|anthracycline-treatment-end-date`,
          _sort: '-date',
          _count: '1',
        }),
      ]);

      const records = maResults.flatMap((ma) => { const r = parseAdminRecord(ma); return r ? [r] : []; });
      records.sort((a, b) => a.date.localeCompare(b.date));
      setAdminRecords(records);

      const survivorSRs = srResults.filter((sr) =>
        sr.code?.coding?.some((c) => c.system === CARDIO_ONCO_SYSTEM && c.code === 'survivor-cardiac-followup')
      );
      setExistingSurvivorSRs(survivorSRs);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const savedDate = ((obsResults[0] as any)?.valueDateTime as string | undefined)?.slice(0, 10) ?? '';
      if (savedDate) setEndDate(savedDate);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [medplum, patient.id]);

  useEffect(() => { loadData().catch(console.error); }, [loadData]);

  // ---------------------------------------------------------------------------
  // Recompute survivor tasks whenever inputs change
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!endDate) { setSurvivorTasks([]); return; }
    const totalDose = adminRecords.reduce((sum, r) => sum + r.doxoEquivalent, 0);
    const risk = totalDose >= 250 ? 'very-high' : totalDose >= 100 ? 'high' : 'low';
    const protocol = SURVIVOR_PROTOCOLS[risk];

    const srLookup = new Map<string, string>();
    for (const sr of existingSurvivorSRs) {
      const loincCode = sr.code?.coding?.find((c) => c.system === 'http://loinc.org')?.code ?? '';
      const date = (sr.occurrenceDateTime ?? '').slice(0, 10);
      if (loincCode && date) srLookup.set(`${loincCode}::${date}`, sr.id ?? '');
    }

    const tasks: SurvivorTask[] = protocol.map((item) => {
      const dueISO = addMonths(endDate, item.offsetMonths);
      const loincCode = SURVIVOR_LOINC[item.type].code ?? '';
      const srId = srLookup.get(`${loincCode}::${dueISO.slice(0, 10)}`);
      return { taskId: `${item.offsetMonths}-${item.type}`, type: item.type, label: item.label, reason: item.reason, dueDateISO: dueISO, status: taskStatus(dueISO, srId), serviceRequestId: srId };
    });
    setSurvivorTasks(tasks);
  }, [adminRecords, endDate, existingSurvivorSRs]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  async function handleSaveEndDate(): Promise<void> {
    if (!patient.id || !endDate) return;
    try {
      await medplum.createResource({
        resourceType: 'Observation',
        status: 'final',
        code: { coding: [{ system: CARDIO_ONCO_SYSTEM, code: 'anthracycline-treatment-end-date', display: 'Fecha fin tratamiento antraciclinas' }] },
        subject: { reference: `Patient/${patient.id}` },
        effectiveDateTime: new Date(endDate).toISOString(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        valueDateTime: new Date(endDate).toISOString() as any,
      });
      showNotification({ icon: <IconCircleCheck />, color: 'green', title: 'Fecha guardada', message: 'Plan de seguimiento actualizado' });
      await loadData();
    } catch (err) {
      showNotification({ icon: <IconCircleOff />, color: 'red', title: 'Error', message: String(err) });
    }
  }

  async function handleAddAdministration(): Promise<void> {
    if (!patient.id || !selectedDrug || !dateInput) return;
    const doseNum = typeof doseInput === 'number' ? doseInput : parseFloat(String(doseInput)) || 0;
    if (doseNum <= 0) return;
    const drugEntry = ANTHRACYCLINE_DRUGS.find((d) => d.value === selectedDrug as DrugValue);
    if (!drugEntry) return;

    setSavingAdmin(true);
    try {
      const ma: MedicationAdministration = {
        resourceType: 'MedicationAdministration',
        status: 'completed',
        medicationCodeableConcept: { text: drugEntry.label },
        subject: { reference: `Patient/${patient.id}` },
        effectiveDateTime: new Date(dateInput).toISOString(),
        dosage: { text: `${doseNum} mg/m²`, dose: { value: doseNum, unit: 'mg/m²', system: 'http://unitsofmeasure.org', code: 'mg/m2' } },
        note: [{ text: `Factor equivalencia doxorrubicina: ×${drugEntry.factor} — ESC 2022 Tabla 5` }],
      };
      await medplum.createResource(ma);
      showNotification({ icon: <IconCircleCheck />, color: 'green', title: 'Administración registrada', message: `${drugEntry.label} ${doseNum} mg/m²` });
      closeAdd();
      setSelectedDrug(null);
      setDoseInput(60);
      setDateInput('');
      await loadData();
    } catch (err) {
      showNotification({ icon: <IconCircleOff />, color: 'red', title: 'Error', message: String(err) });
    } finally {
      setSavingAdmin(false);
    }
  }

  async function createSurvivorSR(task: SurvivorTask): Promise<void> {
    if (!patient.id) return;
    const loinc = SURVIVOR_LOINC[task.type];
    const sr: ServiceRequest = {
      resourceType: 'ServiceRequest',
      status: 'active',
      intent: 'order',
      category: [{ coding: [{ system: 'http://snomed.info/sct', code: '308335008', display: 'Patient follow-up (procedure)' }], text: 'Seguimiento Sobreviviente Cardio-Oncológico' }],
      code: { coding: [{ system: CARDIO_ONCO_SYSTEM, code: 'survivor-cardiac-followup' }, loinc], text: task.label },
      subject: { reference: `Patient/${patient.id}` },
      occurrenceDateTime: task.dueDateISO,
      reasonCode: [{ text: task.reason }],
      note: [{ text: `Plan Sobreviviente ESC 2022 §12.2. Riesgo por dosis: ${doseRisk.label}. Dosis acumulada: ${totalDoxoEq.toFixed(1)} mg/m² eq. doxorrubicina.` }],
    };
    await medplum.createResource(sr);
  }

  async function handleGeneratePlan(): Promise<void> {
    const pending = survivorTasks.filter((t) => t.status !== 'ordered');
    if (pending.length === 0) return;
    setCreatingAll(true);
    try {
      await Promise.all(pending.map(createSurvivorSR));
      showNotification({ icon: <IconCircleCheck />, color: 'green', title: 'Plan generado', message: `${pending.length} controles programados (ServiceRequest FHIR)` });
      await loadData();
    } catch (err) {
      showNotification({ icon: <IconCircleOff />, color: 'red', title: 'Error', message: String(err) });
    } finally {
      setCreatingAll(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (loading) return <Group><Loader size="sm" /><Text size="sm" c="dimmed">Cargando datos de dosis…</Text></Group>;

  const overdueTasks  = survivorTasks.filter((t) => t.status === 'overdue');
  const pendingTasks  = survivorTasks.filter((t) => t.status === 'pending');
  const orderedTasks  = survivorTasks.filter((t) => t.status === 'ordered');

  return (
    <>
      <Stack gap="xl">
        {/* ── SECTION 1: Dosis acumulada ───────────────────────────────── */}
        <Stack gap="md">
          <Group justify="space-between" align="center">
            <Group gap="xs">
              <IconPill size={18} />
              <Title order={5}>Dosis Acumulada de Antraciclinas</Title>
            </Group>
            <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={openAdd}>
              Registrar Administración
            </Button>
          </Group>

          <Stack gap="xs">
            <Group justify="space-between">
              <Text size="sm" fw={600}>
                Total:{' '}
                <Text span fw={700} c={doseRisk.color !== 'gray' ? doseRisk.color : undefined}>
                  {totalDoxoEq.toFixed(1)} mg/m²
                </Text>
                <Text span size="xs" c="dimmed"> equivalente doxorrubicina</Text>
              </Text>
              {totalDoxoEq > 0 && (
                <Badge color={doseRisk.color} variant="light">Riesgo por dosis: {doseRisk.label}</Badge>
              )}
            </Group>

            <Progress value={progressValue} color={doseRisk.color} size="xl" radius="sm" />

            {/* Threshold markers */}
            <div style={{ position: 'relative', height: 16 }}>
              {[{ val: 100, label: '100' }, { val: 250, label: '250' }, { val: 350, label: '350' }].map(({ val, label }) => (
                <Text
                  key={val}
                  size="10px"
                  c="dimmed"
                  style={{ position: 'absolute', left: `${(val / MAX_DOSE_DISPLAY) * 100}%`, transform: 'translateX(-50%)' }}
                >
                  ▲{label}
                </Text>
              ))}
            </div>
            <Text size="xs" c="dimmed">
              Umbrales ESC 2022: 100 mg/m² (moderado) · 250 mg/m² (alto / factor riesgo HFA-ICOS) · 350 mg/m² (muy alto)
            </Text>

            {totalDoxoEq > 0 && (
              <Alert color={doseRisk.color} variant="light" p="xs">
                <Text size="sm">{doseRisk.message}</Text>
              </Alert>
            )}
          </Stack>

          {adminRecords.length === 0 ? (
            <Alert color="gray" icon={<IconPill size={18} />} title="Sin administraciones registradas">
              <Text size="sm">
                Registrá cada ciclo de antraciclinas para calcular la dosis acumulada. La ESC 2022 define umbrales de
                riesgo basados en equivalente doxorrubicina que determinan el protocolo de seguimiento cardiovascular.
              </Text>
            </Alert>
          ) : (
            <Table highlightOnHover withTableBorder>
              <Table.Thead style={{ background: '#f8fafc' }}>
                <Table.Tr>
                  {['Droga', 'Fecha', 'Dosis', 'Factor ×doxo', 'Eq. Doxorrubicina'].map((h) => (
                    <Table.Th key={h} style={{ fontWeight: 700, fontSize: 'var(--mantine-font-size-xs)', textTransform: 'uppercase', color: 'var(--mantine-color-dimmed)' }}>{h}</Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {adminRecords.map((r) => (
                  <Table.Tr key={r.id}>
                    <Table.Td><Text size="sm" fw={500}>{r.drugName}</Text></Table.Td>
                    <Table.Td><Text size="sm">{formatDate(r.date)}</Text></Table.Td>
                    <Table.Td><Text size="sm">{r.dosePerM2} mg/m²</Text></Table.Td>
                    <Table.Td><Badge size="sm" variant="light" color="violet">×{r.factor}</Badge></Table.Td>
                    <Table.Td>
                      <Text size="sm" fw={600} c={r.doxoEquivalent >= 100 ? 'orange' : undefined}>
                        {r.doxoEquivalent.toFixed(1)} mg/m²
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
                <Table.Tr style={{ background: 'var(--mantine-color-default-hover)' }}>
                  <Table.Td colSpan={4}><Text size="sm" fw={700}>TOTAL ACUMULADO</Text></Table.Td>
                  <Table.Td>
                    <Text size="sm" fw={700} c={doseRisk.color !== 'gray' ? doseRisk.color : undefined}>
                      {totalDoxoEq.toFixed(1)} mg/m²
                    </Text>
                  </Table.Td>
                </Table.Tr>
              </Table.Tbody>
            </Table>
          )}
        </Stack>

        <Divider />

        {/* ── SECTION 2: Seguimiento Sobreviviente ─────────────────────── */}
        <Stack gap="md">
          <Group gap="xs">
            <IconCalendar size={18} />
            <Title order={5}>Seguimiento Sobreviviente — ESC 2022 §12</Title>
          </Group>
          <Text size="sm" c="dimmed">
            Ingresá la fecha de fin de tratamiento para generar el calendario de seguimiento cardiovascular a largo plazo.
          </Text>

          <Group align="flex-end" gap="sm" wrap="wrap">
            <TextInput
              label="Fecha de fin de tratamiento"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.currentTarget.value)}
              style={{ minWidth: 220 }}
            />
            <Button variant="light" onClick={handleSaveEndDate} disabled={!endDate}>
              Guardar fecha
            </Button>
            {endDate && survivorTasks.some((t) => t.status !== 'ordered') && (
              <Button leftSection={<IconPlus size={14} />} onClick={handleGeneratePlan} loading={creatingAll}>
                Generar Plan ({survivorTasks.filter((t) => t.status !== 'ordered').length} controles)
              </Button>
            )}
          </Group>

          {!endDate && (
            <Alert color="gray" icon={<IconCalendar size={18} />} title="Sin fecha de fin de tratamiento">
              <Text size="sm">
                El seguimiento cardiovascular de sobrevivientes oncológicos (ESC 2022 §12) requiere programar controles
                a 3 meses, 1 año, y anualmente hasta 10 años según la dosis acumulada de antraciclinas.
              </Text>
            </Alert>
          )}

          {survivorTasks.length > 0 && (
            <Stack gap="sm">
              {overdueTasks.length > 0 && (
                <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />} p="xs">
                  <Text size="sm" fw={600}>{overdueTasks.length} control{overdueTasks.length > 1 ? 'es' : ''} vencido{overdueTasks.length > 1 ? 's' : ''} sin ordenar.</Text>
                </Alert>
              )}

              <Table highlightOnHover withTableBorder>
                <Table.Thead style={{ background: '#f8fafc' }}>
                  <Table.Tr>
                    {['Control', 'Fecha programada', 'Referencia ESC 2022', 'Estado'].map((h) => (
                      <Table.Th key={h} style={{ fontWeight: 700, fontSize: 'var(--mantine-font-size-xs)', textTransform: 'uppercase', color: 'var(--mantine-color-dimmed)' }}>{h}</Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {survivorTasks.map((task) => (
                    <Table.Tr key={task.taskId}>
                      <Table.Td>
                        <Group gap="xs">
                          <SurvivorTypeChip type={task.type} />
                          <Text size="sm" fw={500}>{task.label}</Text>
                        </Group>
                      </Table.Td>
                      <Table.Td><Text size="sm">{formatDate(task.dueDateISO)}</Text></Table.Td>
                      <Table.Td><Text size="xs" c="dimmed">{task.reason}</Text></Table.Td>
                      <Table.Td><SurvivorStatusBadge status={task.status} /></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>

              <Group gap="xs">
                {orderedTasks.length > 0 && <Badge color="green" variant="light" size="xs">Ordenados: {orderedTasks.length}</Badge>}
                {pendingTasks.length > 0 && <Badge color="blue"  variant="light" size="xs">Pendientes: {pendingTasks.length}</Badge>}
                {overdueTasks.length > 0 && <Badge color="red"   variant="light" size="xs">Vencidos: {overdueTasks.length}</Badge>}
              </Group>
            </Stack>
          )}
        </Stack>
      </Stack>

      {/* ── Add Administration Modal ── */}
      <Modal
        opened={addOpened}
        onClose={closeAdd}
        title={<Group gap="xs"><IconPill size={18} /><Text fw={700}>Registrar Administración de Antraciclina</Text></Group>}
        size="md"
      >
        <Stack gap="md">
          <Alert color="blue" variant="light" p="xs">
            <Text size="xs">
              Los factores de equivalencia son los de la ESC 2022 Tabla 5 (Lyon AR et al.). La dosis se convierte a
              equivalente doxorrubicina para calcular el riesgo acumulado.
            </Text>
          </Alert>

          <Select
            label="Droga"
            placeholder="Seleccioná la antraciclina"
            data={ANTHRACYCLINE_DRUGS.map((d) => ({ value: d.value, label: `${d.label} (×${d.factor})` }))}
            value={selectedDrug}
            onChange={setSelectedDrug}
            required
          />

          <NumberInput
            label="Dosis administrada (mg/m²)"
            placeholder="Ej: 60"
            value={doseInput}
            onChange={setDoseInput}
            min={0}
            max={1000}
            step={5}
            required
          />

          {selectedDrug && typeof doseInput === 'number' && doseInput > 0 && (
            <Alert color="violet" variant="light" p="xs">
              <Text size="xs">
                Equivalente doxorrubicina:{' '}
                <strong>
                  {(doseInput * (ANTHRACYCLINE_DRUGS.find((d) => d.value === selectedDrug)?.factor ?? 1)).toFixed(1)} mg/m²
                </strong>
              </Text>
            </Alert>
          )}

          <TextInput
            label="Fecha de administración"
            type="date"
            value={dateInput}
            onChange={(e) => setDateInput(e.currentTarget.value)}
            required
          />

          <Group justify="flex-end">
            <Button variant="subtle" onClick={closeAdd} disabled={savingAdmin}>Cancelar</Button>
            <Button
              onClick={handleAddAdministration}
              loading={savingAdmin}
              disabled={!selectedDrug || !dateInput || (typeof doseInput === 'number' ? doseInput <= 0 : true)}
            >
              Guardar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const TYPE_META: Record<SurvivorType, { color: string; label: string }> = {
  echo:     { color: 'blue',   label: 'ECO' },
  troponin: { color: 'red',    label: 'TRP' },
  bnp:      { color: 'violet', label: 'BNP' },
};

function SurvivorTypeChip({ type }: { type: SurvivorType }): JSX.Element {
  const meta = TYPE_META[type];
  return (
    <div style={{ width: 24, height: 22, borderRadius: 4, background: `var(--mantine-color-${meta.color}-1)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <Text size="8px" fw={800} c={`${meta.color}.7`}>{meta.label}</Text>
    </div>
  );
}

function SurvivorStatusBadge({ status }: { status: SurvivorTask['status'] }): JSX.Element {
  if (status === 'ordered') return <Badge color="green" variant="light" size="sm" leftSection={<IconCircleCheck size={10} />}>Ordenado</Badge>;
  if (status === 'overdue') return <Badge color="red"   variant="light" size="sm" leftSection={<IconClockExclamation size={10} />}>Vencido</Badge>;
  return <Badge color="blue" variant="light" size="sm">Pendiente</Badge>;
}
