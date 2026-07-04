// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * Panel "Scores de Riesgo" — muestra todos los scores cardio-oncológicos juntos
 * al abrir un paciente en seguimiento (objetivo del proyecto).
 *
 * Precarga los inputs desde los recursos FHIR del paciente (Patient +
 * Observations + Conditions), permite completarlos/ajustarlos, calcula en vivo
 * PREVENT 2023, Framingham 2008 y ESC SCORE2/OP, y guarda los RiskAssessment.
 */
import {
  Alert, Badge, Button, Card, Divider, Group, Loader, NumberInput, SimpleGrid,
  Stack, Switch, Select, Text, Title, Tooltip,
} from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { getReferenceString, normalizeErrorString } from '@medplum/core';
import type { Condition, Observation, Patient, Reference, RiskAssessment } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { IconAlertTriangle, IconCircleCheck, IconDeviceFloppy, IconHeartRateMonitor } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { buildPreventRiskAssessment, computePrevent } from '../cardiotox-mapping/scores/prevent';
import { buildFraminghamRiskAssessment, computeFramingham } from '../cardiotox-mapping/scores/framingham';
import { buildScore2RiskAssessment, computeScore2, mgDlToMmolChol } from '../cardiotox-mapping/scores/score2';
import type { Score2Region } from '../cardiotox-mapping/scores/score2';
import { buildGloboriskRiskAssessment, computeGloborisk } from '../cardiotox-mapping/scores/globorisk';

interface RiskScoresPanelProps {
  patient: Patient;
}

interface ClinicalInputs {
  age: number;
  sex: 'female' | 'male';
  totalChol?: number; // mg/dL
  hdl?: number; // mg/dL
  sbp?: number; // mmHg
  egfr?: number; // mL/min/1.73m²
  bmi?: number; // kg/m²
  hba1c?: number; // %
  uacr?: number; // mg/g
  diabetes: boolean;
  smoking: boolean;
  bpTreated: boolean;
  statin: boolean;
  score2Region: Score2Region;
}

const CATEGORY_COLOR: Record<string, string> = {
  low: 'green',
  intermediate: 'yellow',
  moderate: 'orange',
  high: 'red',
  'very-high': 'red.9',
};

function ageFromBirthDate(birthDate?: string): number | undefined {
  if (!birthDate) return undefined;
  const bd = new Date(birthDate);
  const diff = Date.now() - bd.getTime();
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
}

function obsValue(obs?: Observation): number | undefined {
  return obs?.valueQuantity?.value;
}

export function RiskScoresPanel({ patient }: RiskScoresPanelProps): JSX.Element {
  const medplum = useMedplum();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [inputs, setInputs] = useState<ClinicalInputs>();
  const basisRefs: Reference[] = [];

  useEffect(() => {
    async function load(): Promise<void> {
      const patientId = patient.id as string;
      const latest = async (code: string): Promise<Observation | undefined> => {
        const r = await medplum.searchResources('Observation', {
          patient: `Patient/${patientId}`, code, _sort: '-date', _count: '1',
        });
        return r[0];
      };

      const [chol, hdl, bpPanel, sbpDirect, egfr, bmi, hba1c, uacr, smokingObs, conditions] = await Promise.all([
        latest('2093-3'),
        latest('2085-9'),
        latest('85354-9'),
        latest('8480-6'),
        latest('98979-8'),
        latest('39156-5'),
        latest('4548-4'),
        latest('14959-1'),
        latest('72166-2'),
        medplum.searchResources('Condition', { patient: `Patient/${patientId}`, 'clinical-status': 'active', _count: '100' }),
      ]);

      // Systolic: del panel de PA (componente 8480-6) o de una Observation directa.
      const sbpFromPanel = bpPanel?.component?.find((c) => c.code?.coding?.some((cd) => cd.code === '8480-6'))
        ?.valueQuantity?.value;
      const sbp = sbpFromPanel ?? obsValue(sbpDirect);

      // Diabetes: Condition activa ICD-10 E10/E11/E13.
      const diabetes = (conditions as Condition[]).some((c) =>
        c.code?.coding?.some((cd) => /^E1[013]/i.test(cd.code ?? ''))
      );

      // Tabaquismo: Observation 72166-2 con valor "current smoker".
      const smokingText = (
        smokingObs?.valueCodeableConcept?.text ??
        smokingObs?.valueCodeableConcept?.coding?.[0]?.display ??
        smokingObs?.valueCodeableConcept?.coding?.[0]?.code ??
        ''
      ).toLowerCase();
      const smoking = /current|fumador|smoker|77176002|449868002/.test(smokingText) && !/never|ex|former|no fum/.test(smokingText);

      const found = [chol, hdl, bpPanel ?? sbpDirect, egfr].filter(Boolean) as Observation[];
      for (const o of found) {
        basisRefs.push({ reference: getReferenceString(o) });
      }

      setInputs({
        age: ageFromBirthDate(patient.birthDate) ?? 55,
        sex: patient.gender === 'female' ? 'female' : 'male',
        totalChol: obsValue(chol),
        hdl: obsValue(hdl),
        sbp,
        egfr: obsValue(egfr),
        bmi: obsValue(bmi),
        hba1c: obsValue(hba1c),
        uacr: obsValue(uacr),
        diabetes,
        smoking,
        bpTreated: false,
        statin: false,
        score2Region: 'Low',
      });
      setLoading(false);
    }
    load().catch((err) => {
      console.error(err);
      setLoading(false);
    });
  }, [medplum, patient.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || !inputs) {
    return (
      <Stack align="center" p="xl">
        <Loader />
        <Text c="dimmed">Cargando datos del paciente y calculando scores…</Text>
      </Stack>
    );
  }

  const set = <K extends keyof ClinicalInputs>(key: K, value: ClinicalInputs[K]): void =>
    setInputs((prev) => (prev ? { ...prev, [key]: value } : prev));

  const num = (v: number | undefined): number | undefined => (typeof v === 'number' && !Number.isNaN(v) ? v : undefined);

  // ── Cálculos (con manejo de datos faltantes / fuera de rango) ──
  const results = computeAll(inputs);

  async function handleSave(): Promise<void> {
    if (!inputs) return;
    setSaving(true);
    try {
      const subject: RiskAssessment['subject'] = {
        reference: `Patient/${patient.id}`,
        display: patient.name?.[0]?.text,
      };
      const toSave: RiskAssessment[] = [];
      if (results.prevent.ok) toSave.push(buildPreventRiskAssessment(results.prevent.value, subject, basisRefs));
      if (results.framingham.ok) toSave.push(buildFraminghamRiskAssessment(results.framingham.value, subject, basisRefs));
      if (results.score2.ok) toSave.push(buildScore2RiskAssessment(results.score2.value, subject, basisRefs));
      if (results.globorisk.ok) toSave.push(buildGloboriskRiskAssessment(results.globorisk.value, subject, basisRefs));

      for (const ra of toSave) {
        await medplum.createResource(ra);
      }
      showNotification({
        icon: <IconCircleCheck />, color: 'green', title: 'Scores guardados',
        message: `Se guardaron ${toSave.length} RiskAssessment en Medplum.`,
      });
    } catch (err) {
      showNotification({
        color: 'red', icon: <IconAlertTriangle />, title: 'Error al guardar',
        message: normalizeErrorString(err), autoClose: false,
      });
    } finally {
      setSaving(false);
    }
  }

  const anyOk = results.prevent.ok || results.framingham.ok || results.score2.ok || results.globorisk.ok;

  return (
    <Stack p="xs" gap="lg">
      <Group justify="space-between" align="flex-start">
        <Group gap="xs">
          <IconHeartRateMonitor size={22} color="var(--mantine-color-red-6)" />
          <div>
            <Title order={4}>Scores de Riesgo Cardio-Oncológico</Title>
            <Text c="dimmed" size="sm">
              Precargados desde los datos FHIR del paciente. Ajustá lo que falte y guardá para
              registrar los <b>RiskAssessment</b>.
            </Text>
          </div>
        </Group>
        <Button
          leftSection={<IconDeviceFloppy size={16} />}
          onClick={handleSave}
          loading={saving}
          disabled={!anyOk}
          color="red"
        >
          Guardar scores
        </Button>
      </Group>

      {/* Formulario de inputs clínicos */}
      <Card withBorder padding="md">
        <Text fw={600} size="sm" mb="sm">Datos clínicos</Text>
        <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="sm">
          <NumberInput label="Edad (años)" value={inputs.age} onChange={(v) => set('age', Number(v))} min={18} max={100} />
          <Select label="Sexo" value={inputs.sex} data={[{ value: 'female', label: 'Femenino' }, { value: 'male', label: 'Masculino' }]}
            onChange={(v) => set('sex', (v as 'female' | 'male') ?? 'male')} />
          <NumberInput label="Colesterol total (mg/dL)" value={inputs.totalChol} onChange={(v) => set('totalChol', num(Number(v)))} />
          <NumberInput label="HDL (mg/dL)" value={inputs.hdl} onChange={(v) => set('hdl', num(Number(v)))} />
          <NumberInput label="TA sistólica (mmHg)" value={inputs.sbp} onChange={(v) => set('sbp', num(Number(v)))} />
          <NumberInput label="eGFR (mL/min/1.73)" value={inputs.egfr} onChange={(v) => set('egfr', num(Number(v)))} />
          <NumberInput label="IMC (kg/m²)" value={inputs.bmi} onChange={(v) => set('bmi', num(Number(v)))} />
          <NumberInput label="HbA1c (%) — opc." value={inputs.hba1c} onChange={(v) => set('hba1c', num(Number(v)))} />
          <NumberInput label="UACR (mg/g) — opc." value={inputs.uacr} onChange={(v) => set('uacr', num(Number(v)))} />
          <Select label="Región SCORE2" value={inputs.score2Region}
            data={['Low', 'Moderate', 'High', 'Very high'].map((r) => ({ value: r, label: r }))}
            onChange={(v) => set('score2Region', (v as Score2Region) ?? 'Low')} />
        </SimpleGrid>
        <Group mt="md" gap="lg">
          <Switch label="Diabetes" checked={inputs.diabetes} onChange={(e) => set('diabetes', e.currentTarget.checked)} />
          <Switch label="Fumador actual" checked={inputs.smoking} onChange={(e) => set('smoking', e.currentTarget.checked)} />
          <Switch label="Trat. antihipertensivo" checked={inputs.bpTreated} onChange={(e) => set('bpTreated', e.currentTarget.checked)} />
          <Switch label="Estatina" checked={inputs.statin} onChange={(e) => set('statin', e.currentTarget.checked)} />
        </Group>
      </Card>

      <Divider label="Resultados" labelPosition="left" />

      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
        {/* PREVENT */}
        <ScoreCard title="PREVENT 2023" subtitle="ECV total (AHA)">
          {results.prevent.ok ? (
            <Stack gap={4}>
              <BigRisk percent={results.prevent.value.tenYear.totalCvd * 100} category={results.prevent.value.category} label="10 años" />
              <Text size="xs" c="dimmed">30 años: {(results.prevent.value.thirtyYear.totalCvd * 100).toFixed(1)}% · ASCVD 10a: {(results.prevent.value.tenYear.ascvd * 100).toFixed(1)}%</Text>
              <Text size="xs" c="dimmed">Modelo: {results.prevent.value.model}</Text>
            </Stack>
          ) : <Missing reason={results.prevent.reason} />}
        </ScoreCard>

        {/* Framingham */}
        <ScoreCard title="Framingham 2008" subtitle="ECV general 10 años">
          {results.framingham.ok ? (
            <BigRisk percent={results.framingham.value.risk10yr * 100} category={results.framingham.value.category} label="10 años" />
          ) : <Missing reason={results.framingham.reason} />}
        </ScoreCard>

        {/* SCORE2 */}
        <ScoreCard title="ESC SCORE2 / OP" subtitle={results.score2.ok ? `${results.score2.value.model} · ${inputs.score2Region}` : 'ESC 2021'}>
          {results.score2.ok ? (
            <BigRisk percent={results.score2.value.risk10yr * 100} category={results.score2.value.category} label="10 años" />
          ) : <Missing reason={results.score2.reason} />}
        </ScoreCard>

        {/* OPS / Globorisk */}
        <ScoreCard title="OPS / Globorisk" subtitle="Motor OPS/OMS · Argentina">
          {results.globorisk.ok ? (
            <Stack gap={4}>
              <BigRisk percent={results.globorisk.value.risk10yr * 100} category={results.globorisk.value.category} label="10 años · ECV" />
              <Text size="xs" c="dimmed">Globorisk (Ueda 2017), recalibrado Argentina. Variante por país — puede diferir de la app oficial OPS.</Text>
            </Stack>
          ) : <Missing reason={results.globorisk.reason} />}
        </ScoreCard>

        {/* SAC — pendiente */}
        <ScoreCard title="SAC (cardiotoxicidad)" subtitle="Consenso SAC · DVATC">
          <Pending reason="Pendiente: umbrales bajo/moderado/alto de la pág. 34 del Consenso SAC (la Tabla 2 aporta factores, no cut-points)." />
        </ScoreCard>
      </SimpleGrid>

      <Text size="xs" c="dimmed">
        Nota: PREVENT y Framingham usan colesterol en mg/dL; SCORE2 convierte a mmol/L internamente.
        SCORE2 no tiene región oficial para Argentina — la selección es un juicio clínico.
      </Text>
    </Stack>
  );
}

// ── Subcomponentes ──

function ScoreCard({ title, subtitle, children }: { title: string; subtitle: string; children: JSX.Element }): JSX.Element {
  return (
    <Card withBorder padding="md" radius="md">
      <Text fw={700}>{title}</Text>
      <Text size="xs" c="dimmed" mb="sm">{subtitle}</Text>
      {children}
    </Card>
  );
}

function BigRisk({ percent, category, label }: { percent: number; category: string; label: string }): JSX.Element {
  const color = CATEGORY_COLOR[category] ?? 'gray';
  return (
    <Group justify="space-between" align="center">
      <div>
        <Text size="1.8rem" fw={700} c={color}>{percent.toFixed(1)}%</Text>
        <Text size="xs" c="dimmed">{label}</Text>
      </div>
      <Badge color={color} variant="filled" size="lg">{category}</Badge>
    </Group>
  );
}

function Missing({ reason }: { reason: string }): JSX.Element {
  return <Text size="sm" c="dimmed"><IconAlertTriangle size={14} style={{ verticalAlign: 'middle' }} /> {reason}</Text>;
}

function Pending({ reason }: { reason: string }): JSX.Element {
  return (
    <Tooltip label={reason} multiline w={280} withArrow>
      <Badge color="gray" variant="light">Pendiente de fuente</Badge>
    </Tooltip>
  );
}

// ── Cálculo de todos los scores con manejo de errores ──

type ScoreOutcome<T> = { ok: true; value: T } | { ok: false; reason: string };

function safe<T>(fn: () => T): ScoreOutcome<T> {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    return { ok: false, reason: normalizeErrorString(err) };
  }
}

function computeAll(i: ClinicalInputs): {
  prevent: ScoreOutcome<ReturnType<typeof computePrevent>>;
  framingham: ScoreOutcome<ReturnType<typeof computeFramingham>>;
  score2: ScoreOutcome<ReturnType<typeof computeScore2>>;
  globorisk: ScoreOutcome<ReturnType<typeof computeGloborisk>>;
} {
  const need = (...vals: Array<number | undefined>): boolean => vals.every((v) => typeof v === 'number' && !Number.isNaN(v));

  const prevent = need(i.totalChol, i.hdl, i.sbp, i.egfr, i.bmi)
    ? safe(() => computePrevent({
        age: i.age, sex: i.sex, totalCholesterol: i.totalChol as number, hdl: i.hdl as number,
        systolicBP: i.sbp as number, bpTreated: i.bpTreated, statin: i.statin, diabetes: i.diabetes,
        smoking: i.smoking, egfr: i.egfr as number, bmi: i.bmi as number, hba1c: i.hba1c, uacr: i.uacr,
      }))
    : { ok: false as const, reason: 'Faltan datos (colesterol, HDL, TAS, eGFR, IMC).' };

  const framingham = need(i.totalChol, i.hdl, i.sbp)
    ? safe(() => computeFramingham({
        age: i.age, sex: i.sex, totalCholesterol: i.totalChol as number, hdl: i.hdl as number,
        systolicBP: i.sbp as number, bpTreated: i.bpTreated, smoking: i.smoking, diabetes: i.diabetes,
      }))
    : { ok: false as const, reason: 'Faltan datos (colesterol, HDL, TAS).' };

  const score2 = need(i.totalChol, i.hdl, i.sbp)
    ? safe(() => computeScore2({
        age: i.age, sex: i.sex, smoking: i.smoking, systolicBP: i.sbp as number, diabetes: i.diabetes,
        totalCholesterol: mgDlToMmolChol(i.totalChol as number), hdl: mgDlToMmolChol(i.hdl as number),
      }, i.score2Region))
    : { ok: false as const, reason: 'Faltan datos (colesterol, HDL, TAS).' };

  const globorisk = need(i.totalChol, i.sbp)
    ? safe(() => computeGloborisk({
        age: i.age, sex: i.sex, systolicBP: i.sbp as number,
        totalCholesterol: mgDlToMmolChol(i.totalChol as number), diabetes: i.diabetes, smoking: i.smoking,
      }))
    : { ok: false as const, reason: 'Faltan datos (colesterol, TAS).' };

  return { prevent, framingham, score2, globorisk };
}
