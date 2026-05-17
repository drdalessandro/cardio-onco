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
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { showNotification } from '@mantine/notifications';
import type { Condition, Patient, RiskAssessment } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { IconAlertTriangle, IconCircleCheck, IconCircleOff, IconEdit, IconShieldHalf } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';

// ---------------------------------------------------------------------------
// Risk factor definitions — ESC 2022 HFA-ICOS (Lyon AR et al., §4.1)
// ---------------------------------------------------------------------------
const VERY_HIGH_FACTORS = [
  { id: 'hf-reduced',       label: 'Insuficiencia cardíaca con FEVI reducida establecida' },
  { id: 'lvef-lt50',        label: 'FEVI < 50% documentada (ecocardiograma previo)' },
  { id: 'recent-event',     label: 'IAM, ACV o TIA en los últimos 12 meses' },
  { id: 'prior-anthracycline', label: 'Exposición previa a antraciclinas dosis alta (≥250 mg/m² doxorrubicina eq.)' },
  { id: 'prior-radiation',  label: 'Radioterapia torácica o mediastinal previa' },
] as const;

const HIGH_FACTORS = [
  { id: 'lvef-50-54',    label: 'FEVI 50–54% (borderline reducida)' },
  { id: 'stable-ihd',   label: 'Cardiopatía isquémica estable (IAM > 12 meses)' },
  { id: 'structural',   label: 'Cardiopatía estructural significativa (valvulopatía, miocardiopatía compensada)' },
] as const;

const CV_RISK_FACTORS = [
  { id: 'hypertension',  label: 'Hipertensión arterial' },
  { id: 'diabetes',      label: 'Diabetes mellitus' },
  { id: 'dyslipidemia',  label: 'Dislipemia / Hipercolesterolemia' },
  { id: 'obesity',       label: 'Obesidad (IMC ≥ 30 kg/m²)' },
  { id: 'smoking',       label: 'Tabaquismo activo o reciente (últimos 3 años)' },
  { id: 'age65',         label: 'Edad ≥ 65 años' },
  { id: 'ckd',           label: 'Enfermedad renal crónica (TFGe < 60 mL/min/1.73 m²)' },
  { id: 'female',        label: 'Sexo femenino' },
] as const;

const TX_FACTORS = [
  { id: 'tx-high-anthra', label: 'Antraciclinas dosis alta planificadas (≥ 250 mg/m² equivalente doxorrubicina)' },
  { id: 'tx-dual-her2',   label: 'Doble bloqueo HER2 con quimioterapia (trastuzumab + pertuzumab + QT)' },
  { id: 'tx-rt-combo',    label: 'Radioterapia torácica combinada con cardiotóxicos' },
  { id: 'tx-ici',         label: 'Inhibidores de checkpoint inmune (pembrolizumab, nivolumab, ipilimumab…)' },
] as const;

type RiskLevel = 'very-high' | 'high' | 'moderate' | 'low';

const RISK_META: Record<RiskLevel, { label: string; color: string; recommendation: string }> = {
  'very-high': {
    label: 'Muy Alto',
    color: 'red',
    recommendation:
      'Evaluación por equipo de Cardio-Oncología obligatoria antes de iniciar tratamiento. Monitoreo intensivo con biomarcadores y ecocardiograma frecuente. Considerar modificación del esquema oncológico.',
  },
  high: {
    label: 'Alto',
    color: 'orange',
    recommendation:
      'Interconsulta cardiológica recomendada. Optimizar factores de riesgo cardiovascular. Monitoreo con ecocardiograma y troponina reforzado según protocolo ESC 2022.',
  },
  moderate: {
    label: 'Moderado',
    color: 'yellow',
    recommendation:
      'Optimizar factores de riesgo modificables antes de iniciar tratamiento. Monitoreo estándar con ecocardiograma y biomarcadores según droga. Reevaluar si aparecen nuevos factores.',
  },
  low: {
    label: 'Bajo',
    color: 'green',
    recommendation:
      'Monitoreo cardiovascular estándar según protocolo ESC 2022 para el tipo de tratamiento oncológico planificado.',
  },
};

// ---------------------------------------------------------------------------
// Pure scoring function
// ---------------------------------------------------------------------------
function computeHFAIcos(
  veryHigh: string[],
  high: string[],
  cv: string[],
  tx: string[]
): RiskLevel {
  if (veryHigh.length > 0) return 'very-high';
  if (high.length > 0) return 'high';
  // ≥3 CV risk factors → High
  if (cv.length >= 3) return 'high';
  // Multiple treatment risk factors combined with ≥1 CV → High
  if (tx.length >= 2 && cv.length >= 1) return 'high';
  if (cv.length >= 1 || tx.length >= 1) return 'moderate';
  return 'low';
}

// ---------------------------------------------------------------------------
// FHIR helpers
// ---------------------------------------------------------------------------
const HFA_ICOS_SYSTEM = 'https://doi.org/10.1093/eurheartj/ehac244';
const HFA_ICOS_METHOD  = 'HFA-ICOS-ESC-2022';

function toRiskAssessment(
  patientId: string,
  level: RiskLevel,
  veryHigh: string[],
  high: string[],
  cv: string[],
  tx: string[]
): RiskAssessment {
  const meta = RISK_META[level];
  return {
    resourceType: 'RiskAssessment',
    status: 'final',
    subject: { reference: `Patient/${patientId}` },
    occurrenceDateTime: new Date().toISOString(),
    method: {
      coding: [{ system: HFA_ICOS_SYSTEM, code: HFA_ICOS_METHOD, display: 'HFA-ICOS ESC 2022' }],
      text: 'HFA-ICOS ESC 2022',
    },
    prediction: [
      {
        outcome: {
          coding: [{ system: HFA_ICOS_SYSTEM, code: level, display: meta.label }],
          text: meta.label,
        },
        qualitativeRisk: {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/risk-probability',
              code:
                level === 'low'
                  ? 'negligible'
                  : level === 'moderate'
                    ? 'low'
                    : level === 'high'
                      ? 'moderate'
                      : 'high',
            },
          ],
        },
      },
    ],
    note: [
      {
        text: [
          `Muy alto riesgo: ${veryHigh.join(', ') || 'ninguno'}`,
          `Alto riesgo: ${high.join(', ') || 'ninguno'}`,
          `Factores CV: ${cv.join(', ') || 'ninguno'}`,
          `Tratamiento: ${tx.join(', ') || 'ninguno'}`,
        ].join(' | '),
      },
    ],
  };
}

function parseExistingAssessment(ra: RiskAssessment): {
  level: RiskLevel;
  date: string;
  noteText: string;
} | undefined {
  const code = ra.prediction?.[0]?.outcome?.coding?.[0]?.code;
  if (!code || !['very-high', 'high', 'moderate', 'low'].includes(code)) return undefined;
  return {
    level: code as RiskLevel,
    date: ra.occurrenceDateTime ?? ra.meta?.lastUpdated ?? '—',
    noteText: ra.note?.[0]?.text ?? '',
  };
}

// ---------------------------------------------------------------------------
// ICD-10 → CV risk factor mapping (auto-prefill)
// Keys are ICD-10 prefixes; values are CV_RISK_FACTORS ids
// ---------------------------------------------------------------------------
const ICD10_TO_CV_FACTOR: Array<{ prefix: string; factorId: string }> = [
  { prefix: 'I10', factorId: 'hypertension' },
  { prefix: 'I11', factorId: 'hypertension' },
  { prefix: 'I12', factorId: 'hypertension' },
  { prefix: 'I13', factorId: 'hypertension' },
  { prefix: 'E10', factorId: 'diabetes' },
  { prefix: 'E11', factorId: 'diabetes' },
  { prefix: 'E13', factorId: 'diabetes' },
  { prefix: 'E78', factorId: 'dyslipidemia' },
  { prefix: 'E66', factorId: 'obesity' },
  { prefix: 'F17', factorId: 'smoking' },
  { prefix: 'Z87.891', factorId: 'smoking' },
  { prefix: 'N18', factorId: 'ckd' },
];

// ICD-10 → Very High / High factor mapping
const ICD10_TO_HIGH_FACTOR: Array<{ prefix: string; factorId: string }> = [
  { prefix: 'I50', factorId: 'hf-reduced' },   // Heart failure
  { prefix: 'I25', factorId: 'stable-ihd' },   // Chronic ischaemic heart disease
  { prefix: 'I21', factorId: 'recent-event' }, // Acute MI
  { prefix: 'I63', factorId: 'recent-event' }, // Stroke
  { prefix: 'G45', factorId: 'recent-event' }, // TIA
];

function prefillFromConditions(conditions: Condition[]): {
  cv: string[];
  high: string[];
  veryHigh: string[];
} {
  const cv = new Set<string>();
  const high = new Set<string>();
  const veryHigh = new Set<string>();

  for (const cond of conditions) {
    const codings = cond.code?.coding ?? [];
    for (const coding of codings) {
      const code = (coding.code ?? '').toUpperCase();
      for (const { prefix, factorId } of ICD10_TO_CV_FACTOR) {
        if (code.startsWith(prefix.toUpperCase())) cv.add(factorId);
      }
      for (const { prefix, factorId } of ICD10_TO_HIGH_FACTOR) {
        if (code.startsWith(prefix.toUpperCase())) high.add(factorId);
      }
    }
  }

  return { cv: [...cv], high: [...high], veryHigh: [...veryHigh] };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
interface HFAICOSCalculatorProps {
  patient: Patient;
}

export function HFAICOSCalculator({ patient }: HFAICOSCalculatorProps): JSX.Element {
  const medplum = useMedplum();
  const [opened, { open, close }] = useDisclosure(false);

  const [loadingAssessment, setLoadingAssessment] = useState(true);
  const [existing, setExisting] = useState<{ level: RiskLevel; date: string; noteText: string } | undefined>();
  const [saving, setSaving] = useState(false);
  const [prefilling, setPrefilling] = useState(false);

  // Form state
  const [selVeryHigh, setSelVeryHigh] = useState<string[]>([]);
  const [selHigh,     setSelHigh]     = useState<string[]>([]);
  const [selCV,       setSelCV]       = useState<string[]>([]);
  const [selTx,       setSelTx]       = useState<string[]>([]);

  const previewLevel = computeHFAIcos(selVeryHigh, selHigh, selCV, selTx);
  const previewMeta  = RISK_META[previewLevel];

  useEffect(() => {
    medplum
      .searchResources('RiskAssessment', {
        subject: `Patient/${patient.id}`,
        _sort:   '-date',
        _count:  '1',
      })
      .then((results) => {
        const found = results[0];
        setExisting(found ? parseExistingAssessment(found) : undefined);
      })
      .catch(console.error)
      .finally(() => setLoadingAssessment(false));
  }, [medplum, patient.id]);

  function handleOpen(): void {
    setSelVeryHigh([]);
    setSelHigh([]);
    setSelCV([]);
    setSelTx([]);
    open();

    // Auto-prefill from active FHIR Conditions
    setPrefilling(true);
    medplum
      .searchResources('Condition', {
        patient: `Patient/${patient.id}`,
        'clinical-status': 'active',
        _count: '100',
      })
      .then((conditions) => {
        const prefilled = prefillFromConditions(conditions);
        if (prefilled.cv.length > 0) setSelCV(prefilled.cv);
        if (prefilled.high.length > 0) setSelHigh(prefilled.high);
        if (prefilled.veryHigh.length > 0) setSelVeryHigh(prefilled.veryHigh);
      })
      .catch(console.error)
      .finally(() => setPrefilling(false));
  }

  async function handleSave(): Promise<void> {
    if (!patient.id) return;
    setSaving(true);
    try {
      const level = computeHFAIcos(selVeryHigh, selHigh, selCV, selTx);
      const resource = toRiskAssessment(patient.id, level, selVeryHigh, selHigh, selCV, selTx);
      await medplum.createResource(resource);
      setExisting({ level, date: new Date().toISOString(), noteText: resource.note?.[0]?.text ?? '' });
      showNotification({ icon: <IconCircleCheck />, color: 'green', title: 'Score guardado', message: `Riesgo HFA-ICOS: ${RISK_META[level].label}` });
      close();
    } catch (err) {
      showNotification({ icon: <IconCircleOff />, color: 'red', title: 'Error', message: String(err) });
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (loadingAssessment) {
    return <Group><Loader size="sm" /><Text size="sm" c="dimmed">Cargando evaluación HFA-ICOS…</Text></Group>;
  }

  const existingMeta = existing ? RISK_META[existing.level] : undefined;

  return (
    <>
      {/* Current Assessment Display */}
      <Stack gap="sm">
        <Group justify="space-between" align="center">
          <Group gap="xs">
            <IconShieldHalf size={18} />
            <Title order={5}>Score de Riesgo HFA-ICOS (ESC 2022)</Title>
          </Group>
          <Button
            size="xs"
            variant={existing ? 'light' : 'filled'}
            color="violet"
            leftSection={existing ? <IconEdit size={14} /> : <IconShieldHalf size={14} />}
            onClick={handleOpen}
          >
            {existing ? 'Actualizar evaluación' : '+ Evaluar Riesgo Basal'}
          </Button>
        </Group>

        {existing && existingMeta ? (
          <Alert
            color={existingMeta.color}
            icon={existingMeta.color === 'green' ? <IconCircleCheck size={18} /> : <IconAlertTriangle size={18} />}
            title={
              <Group gap="xs">
                <span>Riesgo Cardiovascular</span>
                <Badge color={existingMeta.color} variant="filled">{existingMeta.label}</Badge>
              </Group>
            }
          >
            <Text size="sm" mb="xs">{existingMeta.recommendation}</Text>
            <Text size="xs" c="dimmed">
              Evaluado:{' '}
              {new Date(existing.date).toLocaleDateString('es-AR', {
                day: 'numeric', month: 'long', year: 'numeric',
              })}
            </Text>
          </Alert>
        ) : (
          <Alert
            color="violet"
            variant="light"
            icon={<IconShieldHalf size={18} />}
            title="Sin evaluación registrada"
            styles={{ root: { borderLeft: '4px solid var(--mantine-color-violet-4)' } }}
          >
            <Text size="sm">
              No hay score HFA-ICOS registrado para este paciente. Evaluá el riesgo basal antes de iniciar el
              tratamiento oncológico (recomendación Clase I — ESC 2022).
            </Text>
          </Alert>
        )}
      </Stack>

      {/* Calculator Modal */}
      <Modal
        opened={opened}
        onClose={close}
        title={<Group gap="xs"><IconShieldHalf size={18} /><Text fw={700}>Calcular Score HFA-ICOS — ESC 2022</Text></Group>}
        size="lg"
        scrollAreaComponent={undefined}
      >
        <Stack gap="md">
          {prefilling && (
            <Group gap="xs">
              <Loader size="xs" />
              <Text size="xs" c="dimmed">Cargando condiciones activas del paciente…</Text>
            </Group>
          )}
          {!prefilling && (selCV.length > 0 || selHigh.length > 0 || selVeryHigh.length > 0) && (
            <Alert color="blue" variant="light" p="xs">
              <Text size="xs">
                Se pre-completaron factores detectados en las condiciones activas del paciente. Revisá y ajustá según criterio clínico.
              </Text>
            </Alert>
          )}

          {/* Section 1 */}
          <div>
            <Text fw={700} size="sm" c="red" mb="xs">
              Factores de Riesgo Muy Alto (cualquiera → Muy Alto)
            </Text>
            <Checkbox.Group value={selVeryHigh} onChange={setSelVeryHigh}>
              <Stack gap="xs">
                {VERY_HIGH_FACTORS.map((f) => (
                  <Checkbox key={f.id} value={f.id} label={<Text size="sm">{f.label}</Text>} />
                ))}
              </Stack>
            </Checkbox.Group>
          </div>

          <Divider />

          {/* Section 2 */}
          <div>
            <Text fw={700} size="sm" c="orange" mb="xs">
              Enfermedad Cardiovascular Previa (cualquiera → Alto)
            </Text>
            <Checkbox.Group value={selHigh} onChange={setSelHigh}>
              <Stack gap="xs">
                {HIGH_FACTORS.map((f) => (
                  <Checkbox key={f.id} value={f.id} label={<Text size="sm">{f.label}</Text>} />
                ))}
              </Stack>
            </Checkbox.Group>
          </div>

          <Divider />

          {/* Section 3 */}
          <div>
            <Text fw={700} size="sm" c="yellow.7" mb="xs">
              Factores de Riesgo Cardiovascular (≥ 3 → Alto / 1–2 → Moderado)
            </Text>
            <Checkbox.Group value={selCV} onChange={setSelCV}>
              <Stack gap="xs">
                {CV_RISK_FACTORS.map((f) => (
                  <Checkbox key={f.id} value={f.id} label={<Text size="sm">{f.label}</Text>} />
                ))}
              </Stack>
            </Checkbox.Group>
          </div>

          <Divider />

          {/* Section 4 */}
          <div>
            <Text fw={700} size="sm" c="violet" mb="xs">
              Factores del Tratamiento Oncológico Planificado
            </Text>
            <Checkbox.Group value={selTx} onChange={setSelTx}>
              <Stack gap="xs">
                {TX_FACTORS.map((f) => (
                  <Checkbox key={f.id} value={f.id} label={<Text size="sm">{f.label}</Text>} />
                ))}
              </Stack>
            </Checkbox.Group>
          </div>

          <Divider />

          {/* Live preview */}
          <Alert color={previewMeta.color} title={<Group gap="xs"><span>Resultado:</span><Badge color={previewMeta.color} variant="filled">Riesgo {previewMeta.label}</Badge></Group>}>
            <Text size="sm">{previewMeta.recommendation}</Text>
          </Alert>

          <Group justify="flex-end">
            <Button variant="subtle" onClick={close} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} loading={saving}>
              Guardar Evaluación
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
