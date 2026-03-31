// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { ChartData, ChartOptions } from 'chart.js';
import { lazy, Suspense } from 'react';
import type { ComponentType, JSX } from 'react';

interface LVEFChartProps {
  readonly chartData: ChartData<'line', number[], string>;
}

const AsyncLine = lazy(async () => {
  const { CategoryScale, Chart, Legend, LinearScale, LineElement, PointElement, Title, Tooltip } = await import(
    'chart.js'
  );
  Chart.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);
  const { Line } = await import('react-chartjs-2');
  return {
    default: Line as ComponentType<{ data: ChartData<'line', number[], string>; options: ChartOptions<'line'> }>,
  };
});

const lvefChartOptions: ChartOptions<'line'> = {
  responsive: true,
  scales: {
    y: {
      min: 0,
      max: 100,
      title: { display: true, text: 'FEVI (%)' },
      ticks: {
        callback: (value) => `${value}%`,
      },
    },
    x: {
      title: { display: true, text: 'Fecha' },
    },
  },
  plugins: {
    legend: {
      position: 'bottom' as const,
    },
    tooltip: {
      callbacks: {
        label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}%`,
      },
    },
  },
};

export function LVEFChart({ chartData }: LVEFChartProps): JSX.Element {
  return (
    <div className="my-5">
      <Suspense fallback={<div>Cargando gráfico...</div>}>
        <AsyncLine options={lvefChartOptions} data={chartData} />
      </Suspense>
    </div>
  );
}
