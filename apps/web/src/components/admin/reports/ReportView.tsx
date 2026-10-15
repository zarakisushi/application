import { formatReportValue, type ValueFormat } from '@zaraki/core';
import type { ReportResult, ReportSummary } from '@zaraki/db';
import { ArrowDownRight, ArrowUpRight, Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { ReportChart } from './ReportChart';

const NUMERIC: ValueFormat[] = ['int', 'money', 'percent', 'decimal', 'days', 'minutes'];

/** Variação sobre o período anterior, com ícone e texto (nunca só a cor). */
function Delta({ value, previous }: { value: number; previous: number }) {
  if (!previous) return <span className="text-xs text-muted-foreground">sem base no período anterior</span>;
  const change = ((value - previous) / previous) * 100;
  const up = change >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', up ? 'text-emerald-700' : 'text-brand-red')}>
      <Icon className="size-3.5" />
      {up ? '+' : ''}
      {change.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% vs período anterior
    </span>
  );
}

export function SummaryTiles({ items, timezone }: { items: ReportSummary[]; timezone: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((s) => (
        <Card key={s.label} className="gap-2">
          <CardHeader>
            <CardDescription>{s.label}</CardDescription>
            <CardTitle className="font-display text-2xl tabular-nums">{formatReportValue(s.value, s.format, timezone)}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1">
            {typeof s.value === 'number' && s.previous !== undefined && s.previous !== null && <Delta value={s.value} previous={s.previous} />}
            {s.hint && <span className="text-xs text-muted-foreground">{s.hint}</span>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function ReportTable({ result, timezone }: { result: ReportResult; timezone: string }) {
  return (
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            {result.columns.map((c) => (
              <TableHead key={c.key} className={cn(c.format && NUMERIC.includes(c.format) && 'text-right')}>
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.rows.map((row, i) => (
            <TableRow key={i}>
              {result.columns.map((c) => (
                <TableCell key={c.key} className={cn('tabular-nums', c.format && NUMERIC.includes(c.format) && 'text-right')}>
                  {formatReportValue(row[c.key], c.format, timezone)}
                </TableCell>
              ))}
            </TableRow>
          ))}
          {!result.rows.length && (
            <TableRow>
              <TableCell colSpan={result.columns.length} className="py-12 text-center text-muted-foreground">
                Nenhum dado para os filtros escolhidos.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Card>
  );
}

/** Resumo + gráfico + tabela de um relatório. */
export function ReportView({ result, timezone }: { result: ReportResult; timezone: string }) {
  return (
    <div className="grid gap-6">
      {result.note && (
        <Alert>
          <Info />
          <AlertDescription>{result.note}</AlertDescription>
        </Alert>
      )}
      {result.summary?.length ? <SummaryTiles items={result.summary} timezone={timezone} /> : null}
      {result.chart && (
        <Card>
          <CardContent>
            <ReportChart spec={result.chart} rows={result.rows} />
          </CardContent>
        </Card>
      )}
      <ReportTable result={result} timezone={timezone} />
    </div>
  );
}
