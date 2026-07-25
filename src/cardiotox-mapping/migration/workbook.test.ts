// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * Tests del join por DNI: spine + hojas seriadas + capa CKM → un Patient
 * longitudinal por persona, en un Bundle transaccional por paciente.
 */
import { describe, expect, it } from 'vitest';
import type { Bundle, Goal, MedicationStatement, Observation } from '@medplum/fhirtypes';
import { joinWorkbook } from './workbook';
import { measureAlias, splitBlocks } from './serial-sheets';
import { SYSTEMS } from '../data-dictionary';

const spineRow = {
  DNI: '11222333',
  Nombre: 'Testigo',
  Apellido: 'Uno',
  Sexo: 'F',
  Edad: '56',
  'Inicio seguimiento': '3/24',
  FEY: '60',
  TAS: '130',
};

/** Eco: bloque basal + 2 controles fechados (repite las mismas columnas). */
const echoRow = {
  DNI: '11222333',
  FEY: '60',
  'Vol AI': '48',
  'Fecha eco control': '9/24',
  'FEY 2': '52',
  'Vol AI 2': '50',
  'Fecha eco control 2': '3/25',
  'FEY 3': '45',
  'Vol AI 3': '55',
};

const ecgRow = {
  DNI: '11222333',
  Fecha: '9/24',
  'PR (mseg)': '160',
  QRS: '90',
  'QT (mseg)': '400',
  QTc: '430',
};

const frcvRow = {
  DNI: '11222333',
  IECA: 'Sí',
  Gliflozinas: 'Sí',
  Estatinas: 'Sí',
  'GLP-1': 'No',
  'LDL objetivo': '70',
  'Columna rara': 'algo',
};

const entriesOf = (b: Bundle, t: string): Array<{ resource: any }> =>
  (b.entry ?? []).filter((e) => e.resource?.resourceType === t) as Array<{ resource: any }>;

describe('joinWorkbook — un Patient longitudinal por DNI', () => {
  const r = joinWorkbook({
    sheets: {
      Cardiotox: [spineRow],
      Ecocardiogramas_control: [echoRow],
      Estudios_Complementarios: [ecgRow],
      FRCV: [frcvRow],
    },
  });

  it('arma un solo Bundle transaccional para el paciente', () => {
    expect(r.bundles).toHaveLength(1);
    expect(r.bundles[0].type).toBe('transaction');
    expect(r.stats.patients).toBe(1);
  });

  it('un solo Patient, aunque el DNI aparezca en 4 hojas', () => {
    expect(entriesOf(r.bundles[0], 'Patient')).toHaveLength(1);
  });

  it('todos los recursos referencian el mismo urn:uuid del Patient', () => {
    const patFullUrl = r.bundles[0].entry![0].fullUrl;
    const refs = (r.bundles[0].entry ?? [])
      .map((e) => (e.resource as { subject?: { reference?: string } }).subject?.reference)
      .filter(Boolean);
    expect(refs.length).toBeGreaterThan(5);
    expect(new Set(refs)).toEqual(new Set([patFullUrl]));
  });

  it('la FEVI queda como serie de 3 fechas (basal + 2 controles)', () => {
    const fey = entriesOf(r.bundles[0], 'Observation')
      .map((e) => e.resource as Observation)
      .filter((o) => o.code?.coding?.[0]?.code === '8806-2');
    expect(fey.map((o) => o.effectiveDateTime).sort()).toEqual(['2024-03', '2024-09', '2025-03']);
    expect(fey.map((o) => o.valueQuantity?.value).sort((a, b) => a! - b!)).toEqual([45, 52, 60]);
  });

  it('la FEY basal de la spine y la del eco colapsan en UN recurso', () => {
    // misma medición, misma fecha, dos hojas → un solo identifier
    expect(r.stats.deduped).toBeGreaterThan(0);
    const basal = entriesOf(r.bundles[0], 'Observation')
      .map((e) => e.resource as Observation)
      .filter((o) => o.code?.coding?.[0]?.code === '8806-2' && o.effectiveDateTime === '2024-03');
    expect(basal).toHaveLength(1);
  });

  it('no hay dos entries con la misma URL de request (lo prohíbe la transacción FHIR)', () => {
    const urls = (r.bundles[0].entry ?? []).map((e) => e.request?.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('el ECG se guarda fechado con LOINC', () => {
    const qtc = entriesOf(r.bundles[0], 'Observation')
      .map((e) => e.resource as Observation)
      .find((o) => o.code?.coding?.[0]?.code === '8636-3')!;
    expect(qtc.valueQuantity?.value).toBe(430);
    expect(qtc.effectiveDateTime).toBe('2024-09');
  });

  it('FRCV genera MedicationStatement con ATC (gliflozinas A10BK) y Goal de LDL', () => {
    const meds = entriesOf(r.bundles[0], 'MedicationStatement').map((e) => e.resource as MedicationStatement);
    const atcs = meds.map((m) => m.medicationCodeableConcept?.coding?.[0]?.code);
    expect(atcs).toContain('A10BK'); // gliflozinas — insignia CKM
    expect(atcs).toContain('C09A'); // IECA
    expect(atcs).toContain('C10AA'); // estatinas
    expect(atcs).not.toContain('A10BJ'); // GLP-1 = "No"

    const goal = entriesOf(r.bundles[0], 'Goal').map((e) => e.resource as Goal)[0];
    expect(goal.target?.[0]?.measure?.coding?.[0]?.code).toBe('13457-7');
    expect(goal.target?.[0]?.detailQuantity).toMatchObject({ value: 70, comparator: '<', unit: 'mg/dL' });
  });

  it('reporta las columnas no reconocidas en vez de inventarlas', () => {
    const frcv = r.coverage.find((c) => c.sheet === 'FRCV')!;
    expect(frcv.ignored).toContain('Columna rara');
    expect(frcv.matched).toContain('Gliflozinas');
  });
});

describe('joinWorkbook — huérfanos (DNI que no está en la spine)', () => {
  const wb = {
    Cardiotox: [spineRow],
    Ecocardiogramas_control: [{ ...echoRow, DNI: '99999999' }],
  };

  it('por defecto se omiten con advertencia', () => {
    const r = joinWorkbook({ sheets: wb });
    expect(r.bundles).toHaveLength(1);
    expect(r.stats.orphanDnis).toEqual(['99999999']);
    expect(r.warnings.join(' ')).toContain('no existe en Cardiotox');
  });

  it('con includeOrphans se crea un Patient mínimo con el DNI', () => {
    const r = joinWorkbook({ sheets: wb, includeOrphans: true });
    expect(r.bundles).toHaveLength(2);
    const orphan = r.bundles[1];
    const pat = entriesOf(orphan, 'Patient')[0].resource;
    expect(pat.identifier[0]).toMatchObject({ system: SYSTEMS.dniArgentina, value: '99999999' });
    expect(entriesOf(orphan, 'Observation').length).toBeGreaterThan(0);
  });
});

describe('joinWorkbook — sin hojas secundarias sigue funcionando', () => {
  it('sólo la spine', () => {
    const r = joinWorkbook({ sheets: { Cardiotox: [spineRow] } });
    expect(r.bundles).toHaveLength(1);
    expect(r.coverage.map((c) => c.sheet)).toEqual(['Cardiotox']);
  });
});

describe('splitBlocks — detección de bloques por columna de fecha', () => {
  const blocks = splitBlocks(Object.keys(echoRow), echoRow);
  it('bloque 0 = basal (sin fecha propia)', () => {
    expect(blocks[0].date).toBeUndefined();
    expect(blocks[0].columns).toContain('FEY');
  });
  it('cada Fecha abre un bloque con su fecha parseada', () => {
    expect(blocks).toHaveLength(3);
    expect(blocks[1].date).toBe('2024-09');
    expect(blocks[2].date).toBe('2025-03');
  });
});

describe('measureAlias — normaliza repeticiones al mismo alias', () => {
  it('ignora acentos, mayúsculas, sufijos numéricos y "control"', () => {
    expect(measureAlias('FEY')).toBe('fey');
    expect(measureAlias('FEY 2')).toBe('fey');
    expect(measureAlias('FEY control 3')).toBe('fey');
    expect(measureAlias('Vol AI 2')).toBe('vol-ai');
    expect(measureAlias('área AI')).toBe('area-ai');
  });
});
