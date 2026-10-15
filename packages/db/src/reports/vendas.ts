import { ORDER_SOURCE_LABEL, ORDER_TYPE_LABEL, granularityFor, periodBuckets } from '@zaraki/core';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../client';
import { delivered, inPeriod, orderDay, pct, query, scope, type ReportDefinition, type ReportParams } from './types';

type Totals = { pedidos: number; faturamento: number };

/** Pedidos entregues e faturamento num intervalo. */
export async function salesTotals(tx: Tx, p: ReportParams, range: { from: string; to: string } = p): Promise<Totals> {
  const [row] = await query<Totals>(
    tx,
    sql`select count(*)::int as pedidos, coalesce(sum(o.total_cents), 0)::float8 as faturamento
          from orders o where ${scope(p)} and ${delivered} and ${inPeriod(p, range)}`,
  );
  return row ?? { pedidos: 0, faturamento: 0 };
}

const ticket = (t: Totals) => (t.pedidos ? t.faturamento / t.pedidos : null);

export async function revenueSeries(tx: Tx, p: ReportParams) {
  const g = granularityFor(p.days);
  const rows = await query<{ periodo: string; pedidos: number; faturamento: number }>(
    tx,
    sql`select to_char(date_trunc(${g}, d), 'YYYY-MM-DD') as periodo, count(*)::int as pedidos, sum(total)::float8 as faturamento
          from (select ${orderDay(p)} as d, o.total_cents as total from orders o
                 where ${scope(p)} and ${delivered} and ${inPeriod(p)}) t
         group by 1 order by 1`,
  );
  const byBucket = new Map(rows.map((r) => [r.periodo, r]));
  // Intervalos sem venda aparecem com zero (o gráfico não "pula" dias).
  const series = periodBuckets(p.from, p.to, g).map((periodo) => {
    const r = byBucket.get(periodo);
    const pedidos = r?.pedidos ?? 0;
    const faturamento = r?.faturamento ?? 0;
    return { periodo, pedidos, faturamento, ticket: pedidos ? faturamento / pedidos : null };
  });
  return { g, series };
}

const faturamento: ReportDefinition = {
  slug: 'faturamento',
  group: 'Vendas',
  title: 'Faturamento',
  description: 'Vendas realizadas (pedidos entregues) ao longo do tempo, com ticket médio e comparação com o período anterior.',
  permission: 'reports:read',
  async run(tx, p) {
    const { g, series } = await revenueSeries(tx, p);
    const [now, before] = [await salesTotals(tx, p), await salesTotals(tx, p, p.previous)];
    const [carteira] = await query<{ total: number; pedidos: number }>(
      tx,
      sql`select coalesce(sum(o.total_cents), 0)::float8 as total, count(*)::int as pedidos from orders o
           where ${scope(p)} and o.scheduled_at > now() and o.stage not in ('ENTREGUE', 'CANCELADO')`,
    );
    const xFormat = g === 'month' ? 'month' : 'date';
    return {
      summary: [
        { label: 'Faturamento', value: now.faturamento, previous: before.faturamento, format: 'money' },
        { label: 'Pedidos entregues', value: now.pedidos, previous: before.pedidos, format: 'int' },
        { label: 'Ticket médio', value: ticket(now), previous: ticket(before), format: 'money' },
        {
          label: 'Carteira (encomendas futuras)',
          value: carteira?.total ?? 0,
          format: 'money',
          hint: `${carteira?.pedidos ?? 0} encomendas e festas ainda não entregues`,
        },
      ],
      chart: { type: 'line', x: 'periodo', xFormat, series: [{ key: 'faturamento', label: 'Faturamento' }], format: 'money' },
      columns: [
        { key: 'periodo', label: g === 'day' ? 'Dia' : g === 'week' ? 'Semana de' : 'Mês', format: xFormat },
        { key: 'pedidos', label: 'Pedidos entregues', format: 'int' },
        { key: 'faturamento', label: 'Faturamento', format: 'money' },
        { key: 'ticket', label: 'Ticket médio', format: 'money' },
      ],
      rows: series,
    };
  },
};

/** Vendas realizadas agrupadas por uma dimensão do pedido. */
async function salesBy(tx: Tx, p: ReportParams, dimension: SQL, labels: Record<string, string>) {
  const rows = await query<{ chave: string; pedidos: number; faturamento: number }>(
    tx,
    sql`select ${dimension} as chave, count(*)::int as pedidos, sum(o.total_cents)::float8 as faturamento
          from orders o where ${scope(p)} and ${delivered} and ${inPeriod(p)}
         group by 1 order by faturamento desc`,
  );
  const total = rows.reduce((s, r) => s + r.faturamento, 0);
  return rows.map((r) => ({
    nome: labels[r.chave] ?? r.chave,
    pedidos: r.pedidos,
    faturamento: r.faturamento,
    ticket: r.faturamento / r.pedidos,
    participacao: pct(r.faturamento, total),
  }));
}

const salesByColumns = (label: string) => [
  { key: 'nome', label },
  { key: 'pedidos', label: 'Pedidos entregues', format: 'int' as const },
  { key: 'faturamento', label: 'Faturamento', format: 'money' as const },
  { key: 'ticket', label: 'Ticket médio', format: 'money' as const },
  { key: 'participacao', label: '% do faturamento', format: 'percent' as const },
];

const porTipo: ReportDefinition = {
  slug: 'vendas-por-tipo',
  group: 'Vendas',
  title: 'Vendas por tipo',
  description: 'Delivery, encomendas e festas: quanto cada tipo vende e o ticket médio de cada um.',
  permission: 'reports:read',
  async run(tx, p) {
    const rows = await salesBy(tx, p, sql`o.type::text`, ORDER_TYPE_LABEL);
    return {
      chart: { type: 'bar', x: 'nome', series: [{ key: 'faturamento', label: 'Faturamento' }], format: 'money', horizontal: true },
      columns: salesByColumns('Tipo'),
      rows,
    };
  },
};

const porOrigem: ReportDefinition = {
  slug: 'vendas-por-origem',
  group: 'Vendas',
  title: 'Vendas por origem',
  description: 'Site, WhatsApp, balcão/telefone e painel: de onde vêm as vendas.',
  permission: 'reports:read',
  async run(tx, p) {
    const rows = await salesBy(tx, p, sql`o.source::text`, ORDER_SOURCE_LABEL);
    return {
      chart: { type: 'bar', x: 'nome', series: [{ key: 'faturamento', label: 'Faturamento' }], format: 'money', horizontal: true },
      columns: salesByColumns('Origem'),
      rows,
    };
  },
};

const WEEKDAYS = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

const horarios: ReportDefinition = {
  slug: 'dias-e-horarios',
  group: 'Vendas',
  title: 'Dias e horários de pico',
  description: 'Mapa de calor da demanda (pedidos não cancelados) por dia da semana e horário, para planejar equipe e produção.',
  permission: 'reports:read',
  async run(tx, p) {
    const rows = await query<{ dow: number; hora: number; pedidos: number; faturamento: number }>(
      tx,
      sql`select extract(isodow from local)::int as dow, extract(hour from local)::int as hora,
                 count(*)::int as pedidos, sum(total)::float8 as faturamento
            from (select coalesce(o.scheduled_at, o.created_at) at time zone ${p.timezone} as local, o.total_cents as total
                    from orders o where ${scope(p)} and o.stage <> 'CANCELADO' and ${inPeriod(p)}) t
           group by 1, 2 order by 1, 2`,
    );
    const data = rows.map((r) => ({ ...r, dia: WEEKDAYS[r.dow]!, horario: `${String(r.hora).padStart(2, '0')}h` }));
    const peak = [...data].sort((a, b) => b.pedidos - a.pedidos)[0];
    const byDay = new Map<string, number>();
    for (const r of data) byDay.set(r.dia, (byDay.get(r.dia) ?? 0) + r.pedidos);
    const peakDay = [...byDay].sort((a, b) => b[1] - a[1])[0];
    const hours = [...new Set(data.map((r) => r.hora))].sort((a, b) => a - b);
    return {
      summary: [
        { label: 'Horário de pico', value: peak ? `${peak.dia}, ${peak.horario}` : null, hint: peak ? `${peak.pedidos} pedidos` : undefined },
        { label: 'Dia mais movimentado', value: peakDay?.[0] ?? null, hint: peakDay ? `${peakDay[1]} pedidos` : undefined },
      ],
      chart: {
        type: 'heatmap',
        x: 'horario',
        y: 'dia',
        value: 'pedidos',
        format: 'int',
        xOrder: hours.map((h) => `${String(h).padStart(2, '0')}h`),
        yOrder: WEEKDAYS.slice(1),
      },
      columns: [
        { key: 'dia', label: 'Dia da semana' },
        { key: 'horario', label: 'Horário' },
        { key: 'pedidos', label: 'Pedidos', format: 'int' },
        { key: 'faturamento', label: 'Valor dos pedidos', format: 'money' },
      ],
      rows: data,
    };
  },
};

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const sazonalidade: ReportDefinition = {
  slug: 'sazonalidade',
  group: 'Vendas',
  title: 'Sazonalidade e comparativo anual',
  description: 'Faturamento mês a mês do ano escolhido comparado ao ano anterior.',
  permission: 'reports:read',
  usesPeriod: false,
  extraParams: [
    {
      name: 'ano',
      label: 'Ano',
      options: Array.from({ length: 6 }, (_, i) => String(new Date().getFullYear() - i)).map((y) => ({ value: y, label: y })),
      default: (today) => today.slice(0, 4),
    },
  ],
  async run(tx, p) {
    const year = Number(p.extra.ano);
    const rows = await query<{ ano: number; mes: number; faturamento: number }>(
      tx,
      sql`select extract(year from d)::int as ano, extract(month from d)::int as mes, sum(total)::float8 as faturamento
            from (select ${orderDay(p)} as d, o.total_cents as total from orders o
                   where ${scope(p)} and ${delivered}
                     and ${orderDay(p)} between ${`${year - 1}-01-01`}::date and ${`${year}-12-31`}::date) t
           group by 1, 2`,
    );
    const value = (y: number, m: number) => rows.find((r) => r.ano === y && r.mes === m)?.faturamento ?? 0;
    const data = MONTHS.map((nome, i) => {
      const atual = value(year, i + 1);
      const anterior = value(year - 1, i + 1);
      return { mes: nome, atual, anterior, variacao: anterior ? ((atual - anterior) / anterior) * 100 : null };
    });
    const totalAtual = data.reduce((s, r) => s + r.atual, 0);
    const totalAnterior = data.reduce((s, r) => s + r.anterior, 0);
    return {
      summary: [{ label: `Faturamento ${year}`, value: totalAtual, previous: totalAnterior, format: 'money', hint: `comparado a ${year - 1}` }],
      chart: {
        type: 'line',
        x: 'mes',
        series: [
          { key: 'atual', label: String(year) },
          { key: 'anterior', label: String(year - 1) },
        ],
        format: 'money',
      },
      columns: [
        { key: 'mes', label: 'Mês' },
        { key: 'atual', label: String(year), format: 'money' },
        { key: 'anterior', label: String(year - 1), format: 'money' },
        { key: 'variacao', label: 'Variação', format: 'percent' },
      ],
      rows: data,
    };
  },
};

const cupons: ReportDefinition = {
  slug: 'cupons',
  group: 'Vendas',
  title: 'Cupons de desconto',
  description: 'Quanto cada cupom foi usado, o desconto concedido e o valor dos pedidos que ele trouxe (pedidos não cancelados).',
  permission: 'reports:read',
  async run(tx, p) {
    const rows = await query<{ cupom: string; usos: number; desconto: number; valor: number }>(
      tx,
      sql`select o.coupon_code as cupom, count(*)::int as usos, sum(o.discount_cents)::float8 as desconto,
                 sum(o.total_cents)::float8 as valor
            from orders o where ${scope(p)} and o.coupon_id is not null and o.stage <> 'CANCELADO' and ${inPeriod(p)}
           group by o.coupon_code order by usos desc, valor desc`,
    );
    const [all] = await query<{ pedidos: number }>(
      tx,
      sql`select count(*)::int as pedidos from orders o where ${scope(p)} and o.stage <> 'CANCELADO' and ${inPeriod(p)}`,
    );
    const usos = rows.reduce((s, r) => s + r.usos, 0);
    return {
      summary: [
        { label: 'Pedidos com cupom', value: usos, format: 'int', hint: `${pct(usos, all?.pedidos ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% dos pedidos do período` },
        { label: 'Desconto concedido', value: rows.reduce((s, r) => s + r.desconto, 0), format: 'money' },
        { label: 'Valor dos pedidos com cupom', value: rows.reduce((s, r) => s + r.valor, 0), format: 'money' },
      ],
      chart: { type: 'bar', x: 'cupom', series: [{ key: 'usos', label: 'Usos' }], format: 'int', horizontal: true, data: rows.slice(0, 10) },
      columns: [
        { key: 'cupom', label: 'Cupom' },
        { key: 'usos', label: 'Usos', format: 'int' },
        { key: 'desconto', label: 'Desconto concedido', format: 'money' },
        { key: 'valor', label: 'Valor dos pedidos', format: 'money' },
        { key: 'ticket', label: 'Ticket médio', format: 'money' },
      ],
      rows: rows.map((r) => ({ ...r, ticket: r.valor / r.usos })),
    };
  },
};

export const vendasReports = [faturamento, porTipo, porOrigem, horarios, sazonalidade, cupons];
