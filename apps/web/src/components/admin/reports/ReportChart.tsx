'use client';

import { formatReportValue, type ValueFormat } from '@zaraki/core';
import type { ReportChart as ChartSpec } from '@zaraki/db';
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';

/** Valores curtos para os eixos: "R$ 1,2 mil", "15%". */
function axisValue(value: number, format: ValueFormat) {
  if (format === 'money') {
    const reais = value / 100;
    return reais >= 1000
      ? `R$ ${(reais / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`
      : `R$ ${Math.round(reais).toLocaleString('pt-BR')}`;
  }
  return formatReportValue(value, format);
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Cores na ordem fixa da paleta validada; a cor acompanha a série, nunca o ranking. */
const color = (i: number) => `var(--chart-${(i % 5) + 1})`;

export function ReportChart({ spec, rows }: { spec: ChartSpec; rows: Record<string, unknown>[] }) {
  if (spec.type === 'heatmap') return <Heatmap spec={spec} rows={rows} />;

  const data = (spec.data ?? rows).map((r) => ({
    ...r,
    ...Object.fromEntries(spec.series.map((s) => [s.key, Number(r[s.key] ?? 0)])),
  }));
  if (!data.length) return <p className="py-12 text-center text-sm text-muted-foreground">Sem dados no período.</p>;

  const config: ChartConfig = Object.fromEntries(spec.series.map((s, i) => [s.key, { label: s.label, color: color(i) }]));
  const xLabel = (v: unknown) => (spec.xFormat ? formatReportValue(v, spec.xFormat) : String(v ?? ''));
  const tooltip = (
    <ChartTooltip
      content={
        <ChartTooltipContent
          labelFormatter={(_, payload) => xLabel(payload?.[0]?.payload?.[spec.x])}
          formatter={(value, name) => (
            <div className="flex w-full justify-between gap-4">
              <span className="text-muted-foreground">{config[String(name)]?.label}</span>
              <span className="font-mono font-medium tabular-nums">{formatReportValue(value, spec.format)}</span>
            </div>
          )}
        />
      }
    />
  );
  const legend = spec.series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null;

  if (spec.type === 'line') {
    return (
      <ChartContainer config={config} className="aspect-auto h-72 w-full">
        <LineChart data={data} margin={{ left: 8, right: 16, top: 8 }}>
          <CartesianGrid vertical={false} strokeOpacity={0.5} />
          <XAxis dataKey={spec.x} tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={xLabel} />
          <YAxis tickLine={false} axisLine={false} width={84} tickFormatter={(v) => axisValue(v, spec.format)} />
          {tooltip}
          {legend}
          {spec.series.map((s) => (
            <Line key={s.key} dataKey={s.key} type="monotone" stroke={`var(--color-${s.key})`} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
          ))}
        </LineChart>
      </ChartContainer>
    );
  }

  const horizontal = spec.horizontal;
  const last = spec.series.length - 1;
  // Eixo das categorias do tamanho dos rótulos (≈7px por caractere), entre 64 e 210px.
  const labelWidth = Math.min(210, Math.max(64, Math.max(...data.map((d) => xLabel(d[spec.x]).length)) * 7 + 12));
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height: horizontal ? Math.max(180, data.length * 40 + 40) : 288 }}>
      <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ left: 8, right: 16, top: 8 }} barCategoryGap="25%">
        <CartesianGrid vertical={!!horizontal} horizontal={!horizontal} strokeOpacity={0.5} />
        {horizontal ? (
          <>
            <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(v) => axisValue(v, spec.format)} />
            <YAxis type="category" dataKey={spec.x} tickLine={false} axisLine={false} width={labelWidth} tickFormatter={(v) => truncate(xLabel(v), 34)} />
          </>
        ) : (
          <>
            <XAxis dataKey={spec.x} tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} tickFormatter={xLabel} />
            <YAxis tickLine={false} axisLine={false} width={84} tickFormatter={(v) => axisValue(v, spec.format)} />
          </>
        )}
        {tooltip}
        {legend}
        {spec.series.map((s, i) => {
          // Ponta arredondada (4px) só na extremidade da barra; segmentos empilhados ficam retos.
          const end = !spec.stacked || i === last;
          const radius: [number, number, number, number] = !end ? [0, 0, 0, 0] : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0];
          return (
            <Bar
              key={s.key}
              dataKey={s.key}
              fill={`var(--color-${s.key})`}
              stackId={spec.stacked ? 'stack' : undefined}
              radius={radius}
              stroke="var(--card)"
              strokeWidth={spec.stacked ? 2 : 0}
              maxBarSize={48}
              isAnimationActive={false}
            />
          );
        })}
      </BarChart>
    </ChartContainer>
  );
}

/** Mapa de calor em escala sequencial de um único tom (claro = pouco, escuro = muito). */
function Heatmap({ spec, rows }: { spec: Extract<ChartSpec, { type: 'heatmap' }>; rows: Record<string, unknown>[] }) {
  if (!rows.length) return <p className="py-12 text-center text-sm text-muted-foreground">Sem dados no período.</p>;
  const value = new Map(rows.map((r) => [`${r[spec.y]}|${r[spec.x]}`, Number(r[spec.value] ?? 0)]));
  const max = Math.max(...value.values(), 1);
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-max gap-0.5 text-xs" style={{ gridTemplateColumns: `88px repeat(${spec.xOrder.length}, minmax(34px, 1fr))` }}>
        <div />
        {spec.xOrder.map((x) => (
          <div key={x} className="pb-1 text-center text-muted-foreground">
            {x}
          </div>
        ))}
        {spec.yOrder.map((y) => (
          <div key={y} className="contents">
            <div className="flex items-center pr-2 text-muted-foreground">{y}</div>
            {spec.xOrder.map((x) => {
              const v = value.get(`${y}|${x}`) ?? 0;
              const share = v / max;
              const label = `${y}, ${x}: ${formatReportValue(v, spec.format)} pedidos`;
              return (
                <div
                  key={x}
                  title={label}
                  aria-label={label}
                  className="flex h-9 items-center justify-center rounded-sm tabular-nums"
                  style={{
                    background: v ? `color-mix(in oklab, var(--chart-seq) ${Math.round(8 + share * 92)}%, white)` : 'var(--muted)',
                    color: share > 0.55 ? 'white' : 'var(--foreground)',
                  }}
                >
                  {v || ''}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
