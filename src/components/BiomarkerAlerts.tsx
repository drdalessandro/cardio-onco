// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Loader,
  SimpleGrid,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import type { Flag, Observation, Patient } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconCircleOff,
  IconHeartbeat,
  IconRefresh,
  IconShieldX,
  IconX,
} from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';

// ---------------------------------------------------------------------------
// LOINC queries for each biomarker type
// ---------------------------------------------------------------------------
const BIOMARKER_QUERIES: Record<string, string[]> = {
  lvef:     ['8806-2'],
  troponin: ['89579-7', '10839-9'],  // hsTnI + standard TnI
  bnp:      ['33762-6', '30934-4'],  // NT-proBNP + BNP
  qtc:      ['8625-6'],
};

// ---------------------------------------------------------------------------
// Evaluation result
// ---------------------------------------------------------------------------
type AlertLevel = 'red' | 'yellow' | 'green' | 'unknown';

interface BiomarkerEval {
  id:           string;
  name:         string;
  level:        AlertLevel;
  title:        string;         // short headline
  message:      string;         // clinical recommendation
  currentValue: string;
  lastDateISO:  string | undefined;
  flagCode:     string;
}

// ---------------------------------------------------------------------------
// Pure evaluation functions — ESC 2022 thresholds
// ---------------------------------------------------------------------------

function latestObs(observations: Observation[]): Observation | undefined {
  return [...observations].sort(
    (a, b) =>
      new Date(b.effectiveDateTime ?? b.meta?.lastUpdated ?? '').getTime() -
      new Date(a.effectiveDateTime ?? a.meta?.lastUpdated ?? '').getTime()
  )[0];
}

function isAboveRefRange(obs: Observation): boolean {
  const value = obs.valueQuantity?.value;
  if (value === undefined) return false;
  // Check FHIR interpretation (H = High, HH = Critical)
  const interp = obs.interpretation?.[0]?.coding?.[0]?.code ?? '';
  if (['H', 'HH', 'A', 'AA'].includes(interp)) return true;
  // Check referenceRange.high
  const ref = obs.referenceRange?.[0]?.high?.value;
  if (ref !== undefined) return value > ref;
  return false;
}

function evaluateLVEF(observations: Observation[]): BiomarkerEval {
  const base: Omit<BiomarkerEval, 'level' | 'title' | 'message' | 'currentValue' | 'lastDateISO'> = {
    id: 'lvef', name: 'FEVI (Eco)', flagCode: 'alert-lvef',
  };

  if (observations.length === 0) {
    return { ...base, level: 'unknown', title: 'Sin datos', message: 'Registrar ecocardiograma basal (LOINC 8806-2) antes de iniciar quimioterapia.', currentValue: '—', lastDateISO: undefined };
  }

  const sorted = [...observations].sort(
    (a, b) => new Date(a.effectiveDateTime ?? '').getTime() - new Date(b.effectiveDateTime ?? '').getTime()
  );
  const baseline = sorted[0]?.valueQuantity?.value;
  const latest   = sorted[sorted.length - 1];
  const current  = latest?.valueQuantity?.value;

  if (baseline === undefined || current === undefined) {
    return { ...base, level: 'unknown', title: 'Sin valores numéricos', message: 'No se pudieron leer los valores de FEVI.', currentValue: '—', lastDateISO: latest?.effectiveDateTime };
  }

  const drop = baseline - current;
  const unit = latest.valueQuantity?.unit ?? '%';
  const displayVal = `${current} ${unit}  (basal: ${baseline} ${unit}  · Δ: ${drop >= 0 ? '-' : '+'}${Math.abs(drop).toFixed(1)} pp)`;

  if (drop >= 10 && current < 50) return { ...base, level: 'red',     title: 'Cardiotoxicidad Confirmada', message: 'Caída FEVI ≥10 pp a <50% — Suspender quimioterapia y derivar a cardiología urgente (ESC 2022 §4.2).', currentValue: displayVal, lastDateISO: latest.effectiveDateTime, flagCode: 'alert-lvef-red' };
  if (drop >= 15)                  return { ...base, level: 'yellow',  title: 'Caída Significativa de FEVI', message: 'Caída ≥15% desde basal (FEVI aún ≥50%) — Monitoreo cardiológico estrecho; considerar inicio de IECA + beta-bloqueante (ESC 2022 §4.2).', currentValue: displayVal, lastDateISO: latest.effectiveDateTime, flagCode: 'alert-lvef-yellow' };
  if (current < 50)                return { ...base, level: 'red',     title: 'FEVI Reducida', message: 'FEVI <50% sin datos de basal previo — Evaluación cardiológica urgente (ESC 2022 §4.2).', currentValue: displayVal, lastDateISO: latest.effectiveDateTime, flagCode: 'alert-lvef-red' };
  if (current < 55)                return { ...base, level: 'yellow',  title: 'FEVI Borderline', message: 'FEVI 50–54% — Riesgo HFA-ICOS elevado; monitoreo con biomarcadores (ESC 2022 §4.1).', currentValue: displayVal, lastDateISO: latest.effectiveDateTime, flagCode: 'alert-lvef-yellow' };
  return { ...base, level: 'green', title: 'FEVI Normal', message: 'FEVI ≥55% sin caída significativa. Continuar monitoreo periódico según protocolo ESC 2022.', currentValue: displayVal, lastDateISO: latest.effectiveDateTime };
}

function evaluateTroponin(observations: Observation[]): BiomarkerEval {
  const base: Omit<BiomarkerEval, 'level' | 'title' | 'message' | 'currentValue' | 'lastDateISO'> = {
    id: 'troponin', name: 'Troponina (hsTnI)', flagCode: 'alert-troponin',
  };

  const obs = latestObs(observations);
  if (!obs) return { ...base, level: 'unknown', title: 'Sin datos', message: 'Registrar troponina basal antes de iniciar tratamiento cardiotóxico (LOINC 89579-7 / 10839-9).', currentValue: '—', lastDateISO: undefined };

  const value = obs.valueQuantity?.value;
  const unit  = obs.valueQuantity?.unit ?? 'ng/mL';
  const displayVal = value !== undefined ? `${value} ${unit}` : '—';

  if (isAboveRefRange(obs)) {
    return { ...base, level: 'red', title: 'Troponina Elevada', message: 'Troponina sobre el límite superior normal — Evaluar cardiotoxicidad urgente. En pacientes con ICI, descartar miocarditis (ESC 2022 §8.3).', currentValue: displayVal, lastDateISO: obs.effectiveDateTime, flagCode: 'alert-troponin-elevated' };
  }
  return { ...base, level: 'green', title: 'Troponina Normal', message: 'Troponina dentro de límites normales. Continuar monitoreo según protocolo.', currentValue: displayVal, lastDateISO: obs.effectiveDateTime };
}

function evaluateBNP(observations: Observation[]): BiomarkerEval {
  const base: Omit<BiomarkerEval, 'level' | 'title' | 'message' | 'currentValue' | 'lastDateISO'> = {
    id: 'bnp', name: 'NT-proBNP / BNP', flagCode: 'alert-bnp',
  };

  const obs = latestObs(observations);
  if (!obs) return { ...base, level: 'unknown', title: 'Sin datos', message: 'Registrar NT-proBNP basal para pacientes de alto riesgo (LOINC 33762-6).', currentValue: '—', lastDateISO: undefined };

  const value = obs.valueQuantity?.value;
  const unit  = obs.valueQuantity?.unit ?? 'pg/mL';
  const displayVal = value !== undefined ? `${value} ${unit}` : '—';

  if (isAboveRefRange(obs) || (value !== undefined && value > 125 && (unit.includes('pg/mL') || unit.includes('ng/L')))) {
    return { ...base, level: 'yellow', title: 'NT-proBNP Elevado', message: 'NT-proBNP >125 pg/mL — Monitoreo cardiovascular estrecho. Evaluar congestión y función sistólica (ESC 2022 §4.3).', currentValue: displayVal, lastDateISO: obs.effectiveDateTime, flagCode: 'alert-bnp-elevated' };
  }
  return { ...base, level: 'green', title: 'NT-proBNP Normal', message: 'NT-proBNP dentro de límites normales.', currentValue: displayVal, lastDateISO: obs.effectiveDateTime };
}

function evaluateQTc(observations: Observation[]): BiomarkerEval {
  const base: Omit<BiomarkerEval, 'level' | 'title' | 'message' | 'currentValue' | 'lastDateISO'> = {
    id: 'qtc', name: 'Intervalo QTc', flagCode: 'alert-qtc',
  };

  const obs = latestObs(observations);
  if (!obs) return { ...base, level: 'unknown', title: 'Sin datos', message: 'Registrar QTc basal por ECG para pacientes con drogas QT-prolongantes (LOINC 8625-6).', currentValue: '—', lastDateISO: undefined };

  const value = obs.valueQuantity?.value;
  const unit  = obs.valueQuantity?.unit ?? 'ms';
  const displayVal = value !== undefined ? `${value} ${unit}` : '—';

  if (value !== undefined && value > 500) return { ...base, level: 'red',    title: 'QTc Crítico', message: `QTc ${value} ms > 500 ms — SUSPENDER droga QT-prolongante de inmediato. Corregir electrolitos, consulta cardiológica urgente (ESC 2022 §4.3).`, currentValue: displayVal, lastDateISO: obs.effectiveDateTime, flagCode: 'alert-qtc-critical' };
  if (value !== undefined && value > 480) return { ...base, level: 'yellow', title: 'QTc Prolongado', message: `QTc ${value} ms (480–500 ms) — Monitoreo estrecho; reducir dosis o cambiar droga si persiste (ESC 2022 §4.3).`, currentValue: displayVal, lastDateISO: obs.effectiveDateTime, flagCode: 'alert-qtc-prolonged' };
  return { ...base, level: 'green', title: 'QTc Normal', message: `QTc ${value ?? '—'} ms — Dentro de límites normales.`, currentValue: displayVal, lastDateISO: obs.effectiveDateTime };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const LEVEL_COLOR: Record<AlertLevel, string> = { red: 'red', yellow: 'yellow', green: 'green', unknown: 'gray' };
const ESC_SYSTEM = 'https://doi.org/10.1093/eurheartj/ehac244';

function formatDate(iso: string | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
interface BiomarkerAlertsProps {
  patient: Patient;
}

export function BiomarkerAlerts({ patient }: BiomarkerAlertsProps): JSX.Element {
  const medplum = useMedplum();
  const [loading, setLoading] = useState(true);
  const [evals, setEvals] = useState<BiomarkerEval[]>([]);
  const [activeFlags, setActiveFlags] = useState<Flag[]>([]);
  const [creatingSrId, setCreatingSrId] = useState<string | undefined>();
  const [resolvingFlagId, setResolvingFlagId] = useState<string | undefined>();

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const patRef = `Patient/${patient.id}`;
      const allCodes = Object.values(BIOMARKER_QUERIES).flat().join(',');

      const [obsBundle, flags] = await Promise.all([
        medplum.searchResources('Observation', {
          patient: patRef,
          code: allCodes,
          _sort: 'date',
          _count: '500',
        }),
        medplum.searchResources('Flag', {
          subject: patRef,
          status: 'active',
          _count: '50',
        }),
      ]);

      // Partition observations by biomarker type
      const byType: Record<string, Observation[]> = { lvef: [], troponin: [], bnp: [], qtc: [] };
      for (const obs of obsBundle) {
        for (const coding of obs.code?.coding ?? []) {
          const code = coding.code ?? '';
          if (BIOMARKER_QUERIES.lvef.includes(code))     byType.lvef.push(obs);
          if (BIOMARKER_QUERIES.troponin.includes(code)) byType.troponin.push(obs);
          if (BIOMARKER_QUERIES.bnp.includes(code))      byType.bnp.push(obs);
          if (BIOMARKER_QUERIES.qtc.includes(code))      byType.qtc.push(obs);
        }
      }

      setEvals([
        evaluateLVEF(byType.lvef),
        evaluateTroponin(byType.troponin),
        evaluateBNP(byType.bnp),
        evaluateQTc(byType.qtc),
      ]);
      setActiveFlags(flags);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [medplum, patient.id]);

  useEffect(() => { load().catch(console.error); }, [load]);

  async function handleRegisterFlag(ev: BiomarkerEval): Promise<void> {
    if (!patient.id) return;
    setCreatingSrId(ev.id);
    try {
      const flag: Flag = {
        resourceType: 'Flag',
        status: 'active',
        category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/flag-category', code: 'clinical', display: 'Clinical' }] }],
        code: {
          coding: [{ system: ESC_SYSTEM, code: ev.flagCode, display: ev.title }],
          text: `${ev.name}: ${ev.title} — ${ev.currentValue}`,
        },
        subject: { reference: `Patient/${patient.id}` },
        period: { start: new Date().toISOString() },
      };
      await medplum.createResource(flag);
      showNotification({ icon: <IconCircleCheck />, color: 'green', title: 'Alerta registrada', message: `${ev.name}: ${ev.title}` });
      await load();
    } catch (err) {
      showNotification({ icon: <IconCircleOff />, color: 'red', title: 'Error', message: String(err) });
    } finally {
      setCreatingSrId(undefined);
    }
  }

  async function handleResolveFlag(flag: Flag): Promise<void> {
    if (!flag.id) return;
    setResolvingFlagId(flag.id);
    try {
      await medplum.updateResource<Flag>({
        ...flag,
        status: 'inactive',
        period: { ...flag.period, end: new Date().toISOString() },
      });
      showNotification({ icon: <IconCircleCheck />, color: 'green', title: 'Alerta resuelta', message: flag.code?.text ?? '' });
      await load();
    } catch (err) {
      showNotification({ icon: <IconCircleOff />, color: 'red', title: 'Error', message: String(err) });
    } finally {
      setResolvingFlagId(undefined);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Group gap="xs">
          <IconHeartbeat size={18} />
          <Title order={5}>Alertas por Biomarcadores — ESC 2022</Title>
        </Group>
        <ActionIcon variant="subtle" onClick={() => load()} disabled={loading} title="Actualizar">
          <IconRefresh size={16} />
        </ActionIcon>
      </Group>

      {loading ? (
        <Group><Loader size="sm" /><Text size="sm" c="dimmed">Evaluando biomarcadores…</Text></Group>
      ) : (
        <SimpleGrid cols={2}>
          {evals.map((ev) => (
            <Card
              key={ev.id}
              withBorder
              padding="md"
              radius="md"
              style={{ borderLeft: `4px solid var(--mantine-color-${LEVEL_COLOR[ev.level]}-6)` }}
            >
              <Stack gap="xs">
                <Group justify="space-between" align="flex-start">
                  <Text fw={700} size="sm">{ev.name}</Text>
                  <Badge color={LEVEL_COLOR[ev.level]} variant={ev.level === 'unknown' ? 'light' : 'filled'} size="sm">
                    {ev.level === 'red' ? '🔴 Alerta' : ev.level === 'yellow' ? '🟡 Atención' : ev.level === 'green' ? '🟢 Normal' : '—'}
                  </Badge>
                </Group>

                <Text fw={700} size="xl" lh={1} c={ev.level === 'unknown' ? 'dimmed' : undefined}>
                  {ev.currentValue}
                </Text>

                <Text size="xs" fw={600} c={`${LEVEL_COLOR[ev.level]}.7`}>{ev.title}</Text>
                <Text size="xs" c="dimmed">{ev.message}</Text>

                <Group justify="space-between" align="center" mt="xs">
                  <Text size="xs" c="dimmed">Último: {formatDate(ev.lastDateISO)}</Text>
                  {(ev.level === 'red' || ev.level === 'yellow') && (
                    <Tooltip label="Registrar como alerta clínica activa (Flag FHIR)">
                      <Button
                        size="xs"
                        color={LEVEL_COLOR[ev.level]}
                        variant="light"
                        leftSection={<IconAlertTriangle size={12} />}
                        loading={creatingSrId === ev.id}
                        onClick={() => handleRegisterFlag(ev)}
                      >
                        Registrar Alerta
                      </Button>
                    </Tooltip>
                  )}
                </Group>
              </Stack>
            </Card>
          ))}
        </SimpleGrid>
      )}

      {/* Active Flags */}
      {activeFlags.length > 0 && (
        <>
          <Divider label="Alertas Clínicas Activas (Flag FHIR)" labelPosition="left" />
          <Stack gap="xs">
            {activeFlags.map((flag) => (
              <Alert
                key={flag.id}
                color="red"
                variant="light"
                icon={<IconShieldX size={16} />}
                title={flag.code?.text ?? 'Alerta'}
                styles={{ root: { padding: '0.6rem 1rem' } }}
              >
                <Group justify="space-between" align="center">
                  <Text size="xs" c="dimmed">
                    Desde: {formatDate(flag.period?.start)}
                  </Text>
                  <Tooltip label="Marcar como resuelta (Flag → inactive)">
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color="gray"
                      loading={resolvingFlagId === flag.id}
                      onClick={() => handleResolveFlag(flag)}
                    >
                      <IconX size={14} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Alert>
            ))}
          </Stack>
        </>
      )}
    </Stack>
  );
}
