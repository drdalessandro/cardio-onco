// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { showNotification } from '@mantine/notifications';
import type { Patient, ServiceRequest } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import {
  IconCheck,
  IconCircleCheck,
  IconCircleOff,
  IconClipboardHeart,
  IconPlus,
} from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CARDIO_ONCO_SYSTEM = 'https://cardio-onco.epa-bienestar.com.ar/fhir';
const CONSULTATION_CODE = {
  coding: [{ system: CARDIO_ONCO_SYSTEM, code: 'cardio-onco-interconsulta', display: 'Interconsulta Cardio-Oncología' }],
  text: 'Interconsulta Cardio-Oncología ESC 2022',
};
const CONSULTATION_CATEGORY = {
  coding: [{ system: 'http://snomed.info/sct', code: '11429006', display: 'Consultation' }],
  text: 'Interconsulta Cardio-Oncología',
};

const URGENCY_OPTIONS = [
  { value: 'routine', label: 'Rutinaria (dentro de 7 días)' },
  { value: 'urgent',  label: 'Urgente (dentro de 48 hs)' },
  { value: 'asap',    label: 'Prioritaria (hoy)' },
  { value: 'stat',    label: 'Inmediata / Emergencia' },
];

const URGENCY_META: Record<string, { label: string; color: string }> = {
  routine: { label: 'Rutinaria',  color: 'blue' },
  urgent:  { label: 'Urgente',    color: 'orange' },
  asap:    { label: 'Prioritaria', color: 'red' },
  stat:    { label: 'Inmediata',  color: 'red' },
};

const MOTIVOS_CONSULTA = [
  { id: 'lvef-drop',          label: 'Caída de FEVI ≥ 10 puntos porcentuales' },
  { id: 'lvef-lt50',          label: 'FEVI < 50% documentada' },
  { id: 'troponin-rise',      label: 'Elevación de troponina (> LSN)' },
  { id: 'bnp-rise',           label: 'Elevación de NT-proBNP / BNP (> LSN)' },
  { id: 'qtc-long',           label: 'QTc prolongado (> 480 ms)' },
  { id: 'hta-uncontrolled',   label: 'HTA no controlada durante tratamiento' },
  { id: 'basal-eval',         label: 'Evaluación cardiovascular basal pre-tratamiento' },
  { id: 'arrhythmia',         label: 'Arritmia detectada (FA, TV, BAV)' },
  { id: 'chest-pain',         label: 'Dolor torácico / síntomas cardiovasculares' },
  { id: 'decision-treatment', label: 'Decisión de continuar / modificar tratamiento oncológico' },
  { id: 'survivor-followup',  label: 'Seguimiento cardiovascular sobreviviente oncológico' },
] as const;

const RECOMENDACIONES = [
  { id: 'continue',          label: 'Continuar tratamiento oncológico sin modificaciones' },
  { id: 'continue-monitor',  label: 'Continuar con monitoreo cardiovascular reforzado' },
  { id: 'dose-reduce',       label: 'Reducir dosis del agente cardiotóxico' },
  { id: 'suspend-temp',      label: 'Suspender temporalmente el tratamiento (≤ 4 semanas)' },
  { id: 'suspend-def',       label: 'Suspender definitivamente el agente cardiotóxico' },
  { id: 'cardioprotection',  label: 'Iniciar cardioprotección (IECA / BB / SGLT2i)' },
  { id: 'echo-urgent',       label: 'Ecocardiograma urgente' },
  { id: 'holter',            label: 'Holter / monitoreo ECG ambulatorio' },
  { id: 'hospitalization',   label: 'Derivación para internación cardiológica' },
] as const;

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------
interface ParsedConsulta {
  id: string;
  priority: string;
  motivos: string[];
  pregunta: string;
  contextNote: string;
  responseNote: string;
  recomendaciones: string[];
  date: string;
  status: 'active' | 'completed' | 'revoked';
}

function parseServiceRequest(sr: ServiceRequest): ParsedConsulta {
  const notes = sr.note ?? [];
  const pregunta = notes[0]?.text ?? '';
  const contextNote = notes[1]?.text ?? '';
  const responseNote = notes.find((n) => n.text?.startsWith('RESPUESTA:'))?.text ?? '';
  const motivos = (sr.orderDetail ?? []).map((d) => d.text ?? '').filter(Boolean);
  const recomendaciones = (sr.reasonCode ?? [])
    .filter((rc) => rc.coding?.some((c) => c.system === CARDIO_ONCO_SYSTEM))
    .map((rc) => rc.coding?.find((c) => c.system === CARDIO_ONCO_SYSTEM)?.code ?? '')
    .filter(Boolean);
  return {
    id: sr.id ?? '',
    priority: sr.priority ?? 'routine',
    motivos,
    pregunta,
    contextNote,
    responseNote,
    recomendaciones,
    date: sr.authoredOn ?? sr.meta?.lastUpdated ?? '',
    status: (sr.status as ParsedConsulta['status']) ?? 'active',
  };
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
interface InterconsultaCardioOncoProps {
  patient: Patient;
}

export function InterconsultaCardioOnco({ patient }: InterconsultaCardioOncoProps): JSX.Element {
  const medplum = useMedplum();
  const [loading, setLoading] = useState(true);
  const [consultas, setConsultas] = useState<ParsedConsulta[]>([]);

  // Context data for auto-populate
  const [riskLevel, setRiskLevel] = useState('');
  const [activeDrugs, setActiveDrugs] = useState('');
  const [lvefText, setLvefText] = useState('');

  // New consultation modal
  const [newOpened, { open: openNew, close: closeNew }] = useDisclosure(false);
  const [urgency, setUrgency] = useState('routine');
  const [selMotivos, setSelMotivos] = useState<string[]>([]);
  const [pregunta, setPregunta] = useState('');
  const [saving, setSaving] = useState(false);

  // Response modal
  const [respOpened, { open: openResp, close: closeResp }] = useDisclosure(false);
  const [activeConsulta, setActiveConsulta] = useState<ParsedConsulta | undefined>();
  const [selRecomendaciones, setSelRecomendaciones] = useState<string[]>([]);
  const [respText, setRespText] = useState('');
  const [savingResp, setSavingResp] = useState(false);

  const loadData = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const patientRef = `Patient/${patient.id}`;

      const [srResults, raResults, medResults, obsResults] = await Promise.all([
        medplum.searchResources('ServiceRequest', { subject: patientRef, _count: '200', _sort: '-authored' }),
        medplum.searchResources('RiskAssessment', { subject: patientRef, _sort: '-date', _count: '1' }),
        medplum.searchResources('MedicationRequest', { patient: patientRef, status: 'active', _count: '10' }),
        medplum.searchResources('Observation', { patient: patientRef, code: '8806-2', _sort: '-date', _count: '1' }),
      ]);

      const filteredSR = srResults.filter((sr) =>
        sr.code?.coding?.some((c) => c.system === CARDIO_ONCO_SYSTEM && c.code === 'cardio-onco-interconsulta')
      );
      setConsultas(filteredSR.map(parseServiceRequest));

      const ra = raResults[0];
      if (ra) {
        const display = ra.prediction?.[0]?.outcome?.coding?.[0]?.display ?? '';
        setRiskLevel(display ? `Riesgo HFA-ICOS: ${display}` : '');
      }

      const names = medResults
        .map((m) => m.medicationCodeableConcept?.text ?? m.medicationCodeableConcept?.coding?.[0]?.display ?? '')
        .filter(Boolean)
        .join(', ');
      setActiveDrugs(names);

      const obs = obsResults[0];
      if (obs?.valueQuantity?.value !== undefined) {
        const val = obs.valueQuantity.value;
        const date = obs.effectiveDateTime ? new Date(obs.effectiveDateTime).toLocaleDateString('es-AR') : '';
        setLvefText(`FEVI: ${val}% (${date})`);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [medplum, patient.id]);

  useEffect(() => {
    loadData().catch(console.error);
  }, [loadData]);

  function buildContextNote(): string {
    return [
      riskLevel,
      activeDrugs ? `Tratamientos activos: ${activeDrugs}` : '',
      lvefText,
    ].filter(Boolean).join(' | ') || 'Sin contexto adicional registrado';
  }

  function handleOpenNew(): void {
    setSelMotivos([]);
    setPregunta('');
    setUrgency('routine');
    openNew();
  }

  async function handleSaveConsulta(): Promise<void> {
    if (!patient.id || !pregunta.trim()) return;
    setSaving(true);
    try {
      const sr: ServiceRequest = {
        resourceType: 'ServiceRequest',
        status: 'active',
        intent: 'order',
        priority: urgency as ServiceRequest['priority'],
        category: [CONSULTATION_CATEGORY],
        code: CONSULTATION_CODE,
        subject: { reference: `Patient/${patient.id}` },
        authoredOn: new Date().toISOString(),
        orderDetail: selMotivos.map((m) => ({ text: m })),
        note: [
          { text: pregunta.trim() },
          { text: buildContextNote() },
        ],
      };
      await medplum.createResource(sr);
      showNotification({ icon: <IconCircleCheck />, color: 'green', title: 'Interconsulta enviada', message: 'Registrada como ServiceRequest FHIR R4' });
      closeNew();
      await loadData();
    } catch (err) {
      showNotification({ icon: <IconCircleOff />, color: 'red', title: 'Error', message: String(err) });
    } finally {
      setSaving(false);
    }
  }

  function handleOpenResp(consulta: ParsedConsulta): void {
    setActiveConsulta(consulta);
    setSelRecomendaciones([]);
    setRespText('');
    openResp();
  }

  async function handleSaveResponse(): Promise<void> {
    if (!activeConsulta || !respText.trim()) return;
    setSavingResp(true);
    try {
      const sr = await medplum.readResource('ServiceRequest', activeConsulta.id);
      const updated: ServiceRequest = {
        ...sr,
        status: 'completed',
        note: [
          ...(sr.note ?? []),
          { text: `RESPUESTA: ${respText.trim()}` },
        ],
        reasonCode: [
          ...(sr.reasonCode ?? []),
          ...selRecomendaciones.map((r) => ({
            coding: [{ system: CARDIO_ONCO_SYSTEM, code: r }],
            text: RECOMENDACIONES.find((rec) => rec.id === r)?.label ?? r,
          })),
        ],
      };
      await medplum.updateResource(updated);
      showNotification({ icon: <IconCircleCheck />, color: 'green', title: 'Respuesta guardada', message: 'Interconsulta completada' });
      closeResp();
      await loadData();
    } catch (err) {
      showNotification({ icon: <IconCircleOff />, color: 'red', title: 'Error', message: String(err) });
    } finally {
      setSavingResp(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (loading) {
    return <Group><Loader size="sm" /><Text size="sm" c="dimmed">Cargando interconsultas…</Text></Group>;
  }

  const pending   = consultas.filter((c) => c.status === 'active');
  const completed = consultas.filter((c) => c.status === 'completed');
  const hasContext = riskLevel || activeDrugs || lvefText;

  return (
    <>
      <Stack gap="md">
        <Group justify="space-between" align="center">
          <Group gap="xs">
            <IconClipboardHeart size={18} />
            <Title order={5}>Interconsulta Cardio-Oncología</Title>
          </Group>
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={handleOpenNew}>
            Nueva Interconsulta
          </Button>
        </Group>

        {/* Patient context summary */}
        {hasContext && (
          <Alert color="blue" variant="light" p="xs">
            <Group gap="xs" wrap="wrap">
              {riskLevel && <Badge variant="light" color="violet" size="sm">{riskLevel}</Badge>}
              {lvefText && <Badge variant="light" color="blue" size="sm">{lvefText}</Badge>}
              {activeDrugs && <Text size="xs" c="dimmed">Tratamientos: {activeDrugs}</Text>}
            </Group>
          </Alert>
        )}

        <Divider />

        {/* Pending */}
        <Stack gap="xs">
          <Text fw={700} size="sm">
            Pendientes de respuesta{' '}
            {pending.length > 0 && <Badge color="orange" variant="filled" size="xs" ml={4}>{pending.length}</Badge>}
          </Text>
          {pending.length === 0 ? (
            <Text size="sm" c="dimmed">No hay interconsultas pendientes.</Text>
          ) : (
            <Table highlightOnHover withTableBorder>
              <Table.Thead style={{ background: '#f8fafc' }}>
                <Table.Tr>
                  {['Fecha', 'Urgencia', 'Motivos', 'Pregunta clínica', 'Acción'].map((h) => (
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
                {pending.map((c) => {
                  const urgMeta = URGENCY_META[c.priority] ?? URGENCY_META.routine;
                  return (
                    <Table.Tr key={c.id}>
                      <Table.Td><Text size="sm" style={{ whiteSpace: 'nowrap' }}>{formatDate(c.date)}</Text></Table.Td>
                      <Table.Td><Badge color={urgMeta.color} variant="light" size="sm">{urgMeta.label}</Badge></Table.Td>
                      <Table.Td>
                        <Stack gap={2}>
                          {c.motivos.slice(0, 2).map((m) => (
                            <Text key={m} size="xs" c="dimmed">
                              {MOTIVOS_CONSULTA.find((mc) => mc.id === m)?.label ?? m}
                            </Text>
                          ))}
                          {c.motivos.length > 2 && (
                            <Text size="xs" c="dimmed">+{c.motivos.length - 2} más</Text>
                          )}
                          {c.motivos.length === 0 && <Text size="xs" c="dimmed">—</Text>}
                        </Stack>
                      </Table.Td>
                      <Table.Td><Text size="sm" lineClamp={2}>{c.pregunta}</Text></Table.Td>
                      <Table.Td>
                        <Button
                          size="compact-xs"
                          variant="light"
                          color="green"
                          leftSection={<IconCheck size={12} />}
                          onClick={() => handleOpenResp(c)}
                        >
                          Responder
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          )}
        </Stack>

        {/* Completed */}
        {completed.length > 0 && (
          <>
            <Divider />
            <Stack gap="xs">
              <Text fw={700} size="sm">Respondidas ({completed.length})</Text>
              <Table highlightOnHover withTableBorder>
                <Table.Thead style={{ background: '#f8fafc' }}>
                  <Table.Tr>
                    {['Fecha', 'Urgencia', 'Pregunta', 'Respuesta cardiológica'].map((h) => (
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
                  {completed.map((c) => {
                    const urgMeta = URGENCY_META[c.priority] ?? URGENCY_META.routine;
                    const respClean = c.responseNote.replace(/^RESPUESTA: /, '');
                    return (
                      <Table.Tr key={c.id}>
                        <Table.Td><Text size="sm" style={{ whiteSpace: 'nowrap' }}>{formatDate(c.date)}</Text></Table.Td>
                        <Table.Td><Badge color={urgMeta.color} variant="light" size="sm">{urgMeta.label}</Badge></Table.Td>
                        <Table.Td><Text size="sm" lineClamp={2}>{c.pregunta}</Text></Table.Td>
                        <Table.Td>
                          <Stack gap={4}>
                            <Text size="sm" lineClamp={2}>{respClean || '—'}</Text>
                            {c.recomendaciones.length > 0 && (
                              <Group gap={4} wrap="wrap">
                                {c.recomendaciones.map((r) => (
                                  <Badge key={r} size="xs" variant="light" color="green">
                                    {RECOMENDACIONES.find((rec) => rec.id === r)?.label ?? r}
                                  </Badge>
                                ))}
                              </Group>
                            )}
                          </Stack>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Stack>
          </>
        )}

        {consultas.length === 0 && (
          <Alert
            color="gray"
            icon={<IconClipboardHeart size={18} />}
            title="Sin interconsultas registradas"
          >
            <Text size="sm">
              No hay interconsultas cardio-oncológicas para este paciente. Creá una nueva solicitud para
              coordinar la evaluación cardiovascular con el equipo de Cardiología (ESC 2022 — Recomendación Clase I
              para pacientes de alto y muy alto riesgo antes de iniciar tratamiento cardiotóxico).
            </Text>
          </Alert>
        )}
      </Stack>

      {/* ── New Consultation Modal ── */}
      <Modal
        opened={newOpened}
        onClose={closeNew}
        title={
          <Group gap="xs">
            <IconClipboardHeart size={18} />
            <Text fw={700}>Nueva Interconsulta Cardio-Oncología</Text>
          </Group>
        }
        size="lg"
      >
        <Stack gap="md">
          {hasContext && (
            <Alert color="blue" variant="light" title="Contexto clínico del paciente" p="sm">
              <Stack gap={2}>
                {riskLevel   && <Text size="xs">{riskLevel}</Text>}
                {lvefText    && <Text size="xs">{lvefText}</Text>}
                {activeDrugs && <Text size="xs">Tratamientos activos: {activeDrugs}</Text>}
              </Stack>
            </Alert>
          )}

          <Select
            label="Urgencia"
            data={URGENCY_OPTIONS}
            value={urgency}
            onChange={(v) => setUrgency(v ?? 'routine')}
            required
          />

          <div>
            <Text fw={600} size="sm" mb="xs">Motivo(s) de consulta</Text>
            <Checkbox.Group value={selMotivos} onChange={setSelMotivos}>
              <Stack gap="xs">
                {MOTIVOS_CONSULTA.map((m) => (
                  <Checkbox key={m.id} value={m.id} label={<Text size="sm">{m.label}</Text>} />
                ))}
              </Stack>
            </Checkbox.Group>
          </div>

          <Divider />

          <Textarea
            label="Pregunta clínica específica"
            description="Describí la duda o decisión que requiere la opinión del cardiólogo"
            placeholder="Ej: Paciente con doxorrubicina acumulada 300 mg/m², FEVI 48% en último eco. ¿Continuar tratamiento? ¿Iniciar IECA?"
            minRows={3}
            value={pregunta}
            onChange={(e) => setPregunta(e.currentTarget.value)}
            required
          />

          <Group justify="flex-end">
            <Button variant="subtle" onClick={closeNew} disabled={saving}>Cancelar</Button>
            <Button onClick={handleSaveConsulta} loading={saving} disabled={!pregunta.trim()}>
              Enviar Interconsulta
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* ── Response Modal ── */}
      <Modal
        opened={respOpened}
        onClose={closeResp}
        title={
          <Group gap="xs">
            <IconCircleCheck size={18} />
            <Text fw={700}>Responder Interconsulta</Text>
          </Group>
        }
        size="lg"
      >
        {activeConsulta && (
          <Stack gap="md">
            <Alert color="gray" variant="light" p="sm">
              <Text size="xs" fw={600} mb={4}>Pregunta del equipo oncológico:</Text>
              <Text size="sm">{activeConsulta.pregunta}</Text>
              {activeConsulta.contextNote && (
                <Text size="xs" c="dimmed" mt={4}>{activeConsulta.contextNote}</Text>
              )}
            </Alert>

            <div>
              <Text fw={600} size="sm" mb="xs">Recomendación(es) ESC 2022</Text>
              <Checkbox.Group value={selRecomendaciones} onChange={setSelRecomendaciones}>
                <Stack gap="xs">
                  {RECOMENDACIONES.map((r) => (
                    <Checkbox key={r.id} value={r.id} label={<Text size="sm">{r.label}</Text>} />
                  ))}
                </Stack>
              </Checkbox.Group>
            </div>

            <Divider />

            <Textarea
              label="Respuesta / Evaluación cardiológica"
              description="Incluí hallazgos, plan terapéutico y seguimiento recomendado"
              placeholder="Ej: Se evalúa paciente con FEVI 48%. Dada caída > 10 puntos, se recomienda suspender temporalmente trastuzumab e iniciar IECA + betabloqueante. Control ecocardiográfico en 4 semanas."
              minRows={4}
              value={respText}
              onChange={(e) => setRespText(e.currentTarget.value)}
              required
            />

            <Group justify="flex-end">
              <Button variant="subtle" onClick={closeResp} disabled={savingResp}>Cancelar</Button>
              <Button color="green" onClick={handleSaveResponse} loading={savingResp} disabled={!respText.trim()}>
                Guardar Respuesta
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
}
