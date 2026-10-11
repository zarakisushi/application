import { formatCents } from './money';
import { formatBrPhone } from './phone';
import { todayInZone } from './time';

// ---------- Períodos ----------

export const PERIOD_PRESETS = {
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  '90d': 'Últimos 90 dias',
  mes: 'Este mês',
  'mes-anterior': 'Mês passado',
  ano: 'Este ano',
  personalizado: 'Personalizado',
} as const;
export type PeriodPreset = keyof typeof PERIOD_PRESETS;

export type Period = { preset: PeriodPreset; from: string; to: string; days: number };

const DAY = 86_400_000;
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => toIso(new Date(toDate(s).getTime() + n * DAY));
const isIsoDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toDate(s).getTime());

/** Intervalo de datas (inclusive, "AAAA-MM-DD") no fuso da unidade. */
export function resolvePeriod(
  input: { preset?: string; from?: string; to?: string },
  timeZone: string,
  now = new Date(),
): Period {
  const today = todayInZone(timeZone, now);
  const preset: PeriodPreset = input.preset && input.preset in PERIOD_PRESETS ? (input.preset as PeriodPreset) : '30d';
  let from: string;
  let to = today;
  switch (preset) {
    case '7d':
      from = addDays(today, -6);
      break;
    case '90d':
      from = addDays(today, -89);
      break;
    case 'mes':
      from = `${today.slice(0, 7)}-01`;
      break;
    case 'mes-anterior': {
      const firstThis = toDate(`${today.slice(0, 7)}-01`);
      to = toIso(new Date(firstThis.getTime() - DAY));
      from = `${to.slice(0, 7)}-01`;
      break;
    }
    case 'ano':
      from = `${today.slice(0, 4)}-01-01`;
      break;
    case 'personalizado':
      from = isIsoDate(input.from) ? input.from : addDays(today, -29);
      to = isIsoDate(input.to) ? input.to : today;
      if (from > to) [from, to] = [to, from];
      break;
    default:
      from = addDays(today, -29);
  }
  return { preset, from, to, days: Math.round((toDate(to).getTime() - toDate(from).getTime()) / DAY) + 1 };
}

/** Período imediatamente anterior, com o mesmo número de dias (para comparação). */
export function previousPeriod(p: Pick<Period, 'from' | 'days'>): { from: string; to: string } {
  const to = addDays(p.from, -1);
  return { from: addDays(to, -(p.days - 1)), to };
}

/** Agrupamento automático pelo tamanho do período. */
export const granularityFor = (days: number): 'day' | 'week' | 'month' => (days <= 45 ? 'day' : days <= 200 ? 'week' : 'month');

/** Todas as datas de início de agrupamento do período (para não deixar buracos no gráfico). */
export function periodBuckets(from: string, to: string, granularity: 'day' | 'week' | 'month'): string[] {
  const start = toDate(from);
  if (granularity === 'week') start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7)); // segunda-feira (como o Postgres)
  if (granularity === 'month') start.setUTCDate(1);
  const out: string[] = [];
  for (let d = start; toIso(d) <= to; ) {
    out.push(toIso(d));
    d = granularity === 'month' ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)) : new Date(d.getTime() + (granularity === 'week' ? 7 : 1) * DAY);
  }
  return out;
}

// ---------- Valores ----------

export type ValueFormat = 'text' | 'int' | 'money' | 'percent' | 'decimal' | 'date' | 'month' | 'datetime' | 'days' | 'minutes' | 'phone';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Valor de relatório para exibição. Dinheiro chega em centavos; percentual em 0–100. */
export function formatReportValue(value: unknown, format: ValueFormat = 'text', timeZone = 'America/Sao_Paulo'): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  switch (format) {
    case 'int':
      return Math.round(n).toLocaleString('pt-BR');
    case 'money':
      return formatCents(Math.round(n));
    case 'percent':
      return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
    case 'decimal':
      return n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    case 'days':
      return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${n === 1 ? 'dia' : 'dias'}`;
    case 'minutes': {
      if (n < 60) return `${Math.round(n)} min`;
      const h = Math.floor(n / 60);
      const m = Math.round(n % 60);
      return h < 24 ? `${h}h${m ? String(m).padStart(2, '0') : ''}` : `${(n / 1440).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`;
    }
    case 'date':
      return String(value).slice(0, 10).split('-').reverse().join('/');
    case 'month': {
      const [y, m] = String(value).split('-');
      return `${MONTHS[Number(m) - 1]}/${y}`;
    }
    case 'datetime':
      return new Intl.DateTimeFormat('pt-BR', { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(String(value)));
    case 'phone':
      return formatBrPhone(String(value));
    default:
      return String(value);
  }
}

// ---------- CSV ----------

export type CsvColumn = { key: string; label: string; format?: ValueFormat };

/** Valor "cru" para planilha: números com vírgula decimal, dinheiro em reais, datas dd/mm/aaaa. */
function csvValue(value: unknown, format: ValueFormat | undefined, timeZone: string): string {
  if (value === null || value === undefined) return '';
  const n = Number(value);
  switch (format) {
    case 'money':
      return (n / 100).toFixed(2).replace('.', ',');
    case 'percent':
    case 'decimal':
    case 'days':
    case 'minutes':
      return String(Math.round(n * 100) / 100).replace('.', ',');
    case 'int':
      return String(Math.round(n));
    case 'date':
    case 'month':
    case 'datetime':
    case 'phone':
      return formatReportValue(value, format, timeZone);
    default:
      return String(value);
  }
}

const escapeCsv = (s: string) => (/[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** CSV no padrão do Excel brasileiro: separador ";", vírgula decimal e BOM UTF-8 (acentos corretos). */
export function toCsv(columns: CsvColumn[], rows: Record<string, unknown>[], timeZone = 'America/Sao_Paulo'): string {
  const lines = [
    columns.map((c) => escapeCsv(c.label)).join(';'),
    ...rows.map((r) => columns.map((c) => escapeCsv(csvValue(r[c.key], c.format, timeZone))).join(';')),
  ];
  return `﻿${lines.join('\r\n')}\r\n`;
}
