// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * Catálogo de mediciones con seguimiento en el tiempo — Cardio-Oncología.
 *
 * Basado en `Measurement.data.ts` de FooMedical 5.1.27, con dos cambios:
 *   · en castellano y en unidades del sistema métrico (la planilla y los labs
 *     argentinos usan kg/cm, no lbs/in);
 *   · se agregan las mediciones cardio-oncológicas.
 *
 * FEVI y biomarcadores NO son páginas: el fork anterior tenía un componente por
 * medición (`EchoMeasurement.tsx`, `LabMeasurement.tsx`, ~250 líneas) con el
 * LOINC hardcodeado adentro. La página genérica `Measurement.tsx` del upstream
 * ya grafica cualquier entrada de este catálogo, así que agregar una medición
 * es agregar un objeto acá.
 *
 * ⚠️ Los códigos LOINC deben coincidir con `OBSERVATION_CODES` del diccionario
 * de datos del backend (repo cardio-onco, `src/cardiotox-mapping/
 * data-dictionary.ts`). Hay un test allá que lo verifica: si divergen, la
 * trayectoria queda vacía porque el front consulta un código que nadie escribe.
 */
export interface ObservationType {
  id: string;
  code: string;
  title: string;
  description: string;
  chartDatasets: {
    label: string;
    code?: string;
    unit: string;
    backgroundColor: string;
    borderColor: string;
  }[];
}

const backgroundColor = 'rgba(29, 112, 214, 0.7)';
const borderColor = 'rgba(29, 112, 214, 1)';
const secondBackgroundColor = 'rgba(255, 119, 0, 0.7)';
const secondBorderColor = 'rgba(255, 119, 0, 1)';

export const measurementsMeta: Record<string, ObservationType> = {
  // ── Cardio-oncología ────────────────────────────────────────────────────────
  fevi: {
    id: 'fevi',
    code: '8806-2',
    title: 'FEVI (ecocardiograma)',
    description:
      'La fracción de eyección del ventrículo izquierdo (FEVI) mide qué porcentaje de la sangre expulsa el corazón en cada latido. Es el parámetro principal para vigilar el efecto del tratamiento oncológico sobre el corazón. Se considera normal a partir de 53%. Una caída sostenida se detecta antes de que aparezcan síntomas, y por eso se repite el estudio durante el tratamiento.',
    chartDatasets: [
      {
        label: 'FEVI',
        unit: '%',
        backgroundColor,
        borderColor,
      },
    ],
  },
  'nt-probnp': {
    id: 'nt-probnp',
    code: '33762-6',
    title: 'NT-proBNP',
    description:
      'El NT-proBNP es una sustancia que el corazón libera cuando trabaja con más esfuerzo del habitual. Sirve como señal temprana: puede subir antes de que la FEVI baje o de que aparezcan síntomas. Se mide en sangre junto con los controles del tratamiento.',
    chartDatasets: [
      {
        label: 'NT-proBNP',
        unit: 'pg/mL',
        backgroundColor,
        borderColor,
      },
    ],
  },
  troponina: {
    id: 'troponina',
    code: '89579-7',
    title: 'Troponina ultrasensible',
    description:
      'La troponina es una proteína del músculo cardíaco. Aparece en sangre cuando alguna célula del corazón sufre daño, incluso mínimo. Durante la quimioterapia se mide para detectar en forma temprana un efecto sobre el corazón. El laboratorio puede informar hs-cTnI o hs-cTnT: son ensayos distintos y sus valores no se comparan entre sí.',
    chartDatasets: [
      {
        label: 'Troponina hs-cTnI',
        code: '89579-7',
        unit: 'ng/L',
        backgroundColor,
        borderColor,
      },
      {
        label: 'Troponina hs-cTnT',
        code: '67151-1',
        unit: 'ng/L',
        backgroundColor: secondBackgroundColor,
        borderColor: secondBorderColor,
      },
    ],
  },

  // ── Signos vitales ──────────────────────────────────────────────────────────
  'presion-arterial': {
    // El código de entrada es el de la sistólica, no el del panel 85354-9: este
    // backend escribe sistólica y diastólica como Observations separadas, no
    // como un panel con `component[]`. Cada serie consulta su propio código.
    id: 'presion-arterial',
    code: '8480-6',
    title: 'Presión arterial',
    description:
      'La presión arterial es la fuerza con la que la sangre empuja las paredes de las arterias. Varios tratamientos oncológicos pueden elevarla, y la presión alta sostenida daña el corazón y los vasos. Si la medís en casa, cargá el valor en el check-in.',
    chartDatasets: [
      {
        label: 'Diastólica',
        code: '8462-4',
        unit: 'mm[Hg]',
        backgroundColor: secondBackgroundColor,
        borderColor: secondBorderColor,
      },
      {
        label: 'Sistólica',
        code: '8480-6',
        unit: 'mm[Hg]',
        backgroundColor,
        borderColor,
      },
    ],
  },
  'frecuencia-cardiaca': {
    id: 'frecuencia-cardiaca',
    code: '8867-4',
    title: 'Frecuencia cardíaca',
    description: 'Cuántas veces late tu corazón por minuto, en reposo.',
    chartDatasets: [
      {
        label: 'Frecuencia cardíaca',
        unit: '/min',
        backgroundColor,
        borderColor,
      },
    ],
  },
  peso: {
    id: 'peso',
    code: '29463-7',
    title: 'Peso',
    description:
      'El peso se sigue durante todo el tratamiento: una baja involuntaria puede relacionarse con la enfermedad oncológica, y un aumento rápido en pocos días puede ser retención de líquido. Ambos le importan a tu equipo.',
    chartDatasets: [
      {
        label: 'Peso',
        unit: 'kg',
        backgroundColor,
        borderColor,
      },
    ],
  },
  altura: {
    id: 'altura',
    code: '8302-2',
    title: 'Altura',
    description: 'Tu altura, usada junto con el peso para calcular el índice de masa corporal.',
    chartDatasets: [
      {
        label: 'Altura',
        unit: 'cm',
        backgroundColor,
        borderColor,
      },
    ],
  },
  temperatura: {
    id: 'temperatura',
    code: '8310-5',
    title: 'Temperatura corporal',
    description: 'Tu temperatura corporal.',
    chartDatasets: [
      {
        label: 'Temperatura',
        unit: 'C',
        backgroundColor,
        borderColor,
      },
    ],
  },
  'frecuencia-respiratoria': {
    id: 'frecuencia-respiratoria',
    code: '9279-1',
    title: 'Frecuencia respiratoria',
    description: 'Cuántas respiraciones hacés por minuto.',
    chartDatasets: [
      {
        label: 'Frecuencia respiratoria',
        unit: '/min',
        backgroundColor,
        borderColor,
      },
    ],
  },
};
