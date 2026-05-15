// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
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
const thirdBackgroundColor = 'rgba(34, 139, 34, 0.7)';
const thirdBorderColor = 'rgba(34, 139, 34, 1)';

export const measurementStyles: Record<string, ObservationType> = {
  'presion-arterial': {
    id: 'presion-arterial',
    code: '85354-9',
    title: 'Presión Arterial',
    description:
      'La presión arterial es la fuerza ejercida por la sangre sobre las paredes de los vasos sanguíneos. Cuando esta presión es elevada, puede dañar los vasos sanguíneos y aumentar el riesgo de infarto o accidente cerebrovascular. Se mide periódicamente para controlar que no se mantenga alta. La hipertensión es una condición que refiere a una presión arterial consistentemente elevada.',
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
  altura: {
    id: 'altura',
    code: '8302-2',
    title: 'Altura',
    description: 'Valores de altura del paciente.',
    chartDatasets: [
      {
        label: 'Altura',
        unit: 'cm',
        backgroundColor,
        borderColor,
      },
    ],
  },
  peso: {
    id: 'peso',
    code: '29463-7',
    title: 'Peso',
    description: 'Valores de peso del paciente.',
    chartDatasets: [
      {
        label: 'Peso',
        unit: 'kg',
        backgroundColor,
        borderColor,
      },
    ],
  },
  imc: {
    id: 'imc',
    code: '39156-5',
    title: 'IMC',
    description: 'Indicador de densidad corporal determinado por la relación entre el peso y la altura.',
    chartDatasets: [
      {
        label: 'IMC',
        unit: 'kg/m²',
        backgroundColor,
        borderColor,
      },
    ],
  },
  'circunferencia-abdominal': {
    id: 'circunferencia-abdominal',
    code: '8280-0',
    title: 'Circunferencia Abdominal',
    description: 'Medida del perímetro de la cintura. Permite evaluar la acumulación de grasa abdominal y el riesgo cardiovascular asociado.',
    chartDatasets: [
      {
        label: 'Circunferencia Abdominal',
        unit: 'cm',
        backgroundColor: thirdBackgroundColor,
        borderColor: thirdBorderColor,
      },
    ],
  },
  'frecuencia-cardiaca': {
    id: 'frecuencia-cardiaca',
    code: '8867-4',
    title: 'Frecuencia Cardíaca',
    description: 'Número de latidos del corazón por minuto. Es un indicador fundamental del estado cardiovascular del paciente.',
    chartDatasets: [
      {
        label: 'Frecuencia Cardíaca',
        unit: 'lpm',
        backgroundColor,
        borderColor,
      },
    ],
  },
  'duracion-sueno': {
    id: 'duracion-sueno',
    code: '65981-9',
    title: 'Duración Sueño',
    description: 'Duración del período de sueño del paciente. Un sueño adecuado es fundamental para la recuperación y el bienestar general.',
    chartDatasets: [
      {
        label: 'Duración Sueño',
        unit: 'h',
        backgroundColor: secondBackgroundColor,
        borderColor: secondBorderColor,
      },
    ],
  },
  'duracion-ejercicio': {
    id: 'duracion-ejercicio',
    code: '55411-3',
    title: 'Duración Ejercicio',
    description: 'Tiempo dedicado a la actividad física por sesión. El ejercicio regular contribuye a reducir el riesgo cardiovascular y mejorar la calidad de vida.',
    chartDatasets: [
      {
        label: 'Duración Ejercicio',
        unit: 'min',
        backgroundColor: thirdBackgroundColor,
        borderColor: thirdBorderColor,
      },
    ],
  },
  'duracion-periodo': {
    id: 'duracion-periodo',
    code: '49033-4',
    title: 'Duración Período (Fem)',
    description: 'Duración del ciclo menstrual. Su seguimiento permite detectar irregularidades relacionadas con el tratamiento oncológico o condiciones ginecológicas.',
    chartDatasets: [
      {
        label: 'Duración Período',
        unit: 'días',
        backgroundColor: secondBackgroundColor,
        borderColor: secondBorderColor,
      },
    ],
  },
};
