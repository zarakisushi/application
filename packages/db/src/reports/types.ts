import type { Permission, ValueFormat } from '@zaraki/core';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../client';

export type ReportColumn = { key: string; label: string; format?: ValueFormat };

export type ReportSeries = { key: string; label: string };

export type ReportChart =
  | {
      type: 'line' | 'bar';
      /** Coluna do eixo X (categoria ou data). */
      x: string;
      xFormat?: ValueFormat;
      series: ReportSeries[];
      /** Formato dos valores (eixo Y e dicas). Todas as séries usam o mesmo eixo. */
      format: ValueFormat;
      stacked?: boolean;
      horizontal?: boolean;
      /** Dados próprios do gráfico (quando diferem das linhas da tabela). */
      data?: Record<string, unknown>[];
    }
  | { type: 'heatmap'; x: string; y: string; value: string; format: ValueFormat; xOrder: string[]; yOrder: string[] };

export type ReportSummary = {
  label: string;
  value: number | string | null;
  format?: ValueFormat;
  /** Valor no período anterior, para mostrar a variação. */
  previous?: number | null;
  hint?: string;
};

export type ReportResult = {
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  chart?: ReportChart;
  summary?: ReportSummary[];
  /** Aviso sobre os dados (ex.: custo não cadastrado). */
  note?: string;
};

export type ReportParams = {
  tenantIds: string[];
  timezone: string;
  /** Período inclusive, "AAAA-MM-DD" no fuso da unidade. */
  from: string;
  to: string;
  days: number;
  previous: { from: string; to: string };
  extra: Record<string, string>;
};

export type ExtraParam = {
  name: string;
  label: string;
  options: { value: string; label: string }[];
  /** Valor padrão (pode depender da data de hoje no fuso da unidade). */
  default: (today: string) => string;
};

export type ReportDefinition = {
  slug: string;
  group: 'Vendas' | 'Cardápio' | 'Clientes' | 'Operação' | 'Financeiro' | 'Estoque' | 'Franquia' | 'Governança';
  title: string;
  description: string;
  permission: Permission;
  /** Relatório da rede (todas as unidades, só a Matriz). */
  network?: boolean;
  /** false = o relatório não usa o filtro de período. */
  usesPeriod?: boolean;
  extraParams?: ExtraParam[];
  run: (tx: Tx, p: ReportParams) => Promise<ReportResult>;
};

// ---------- SQL comum ----------

export async function query<T extends Record<string, unknown>>(tx: Tx, q: SQL): Promise<T[]> {
  return (await tx.execute(q)).rows as T[];
}

/** Lista de unidades como parâmetro de array do Postgres. */
export const tenantArray = (p: Pick<ReportParams, 'tenantIds'>) => sql`${`{${p.tenantIds.join(',')}}`}::uuid[]`;

/** Pedidos ativos das unidades do relatório (alias "o"). */
export const scope = (p: ReportParams) => sql`o.status and o.tenant_id = any(${tenantArray(p)})`;

/** Data do pedido no fuso da unidade: o dia agendado (encomendas/festas) ou o dia do recebimento. */
export const orderDay = (p: Pick<ReportParams, 'timezone'>) =>
  sql`(coalesce(o.scheduled_at, o.created_at) at time zone ${p.timezone})::date`;

export const inPeriod = (p: ReportParams, range: { from: string; to: string } = p) =>
  sql`${orderDay(p)} between ${range.from}::date and ${range.to}::date`;

/** Faturamento realizado = pedidos entregues. */
export const delivered = sql`o.stage = 'ENTREGUE'`;

export const pct = (part: number, total: number) => (total ? (part / total) * 100 : 0);
