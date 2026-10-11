import { granularityFor, periodBuckets } from '@zaraki/core';
import { sql } from 'drizzle-orm';
import { delivered, inPeriod, orderDay, pct, query, scope, tenantArray, type ReportDefinition } from './types';

const novosRecorrentes: ReportDefinition = {
  slug: 'clientes-novos-recorrentes',
  group: 'Clientes',
  title: 'Clientes novos × recorrentes',
  description: 'Quem comprou pela primeira vez e quem voltou a comprar em cada período, e quanto cada grupo gerou.',
  permission: 'reports:read',
  async run(tx, p) {
    const g = granularityFor(p.days);
    const raw = await query<{ periodo: string; novos: number; recorrentes: number; faturamentoNovos: number; faturamentoRecorrentes: number }>(
      tx,
      sql`with valid as (
            select o.customer_id, ${orderDay(p)} as d, o.total_cents as total
              from orders o where ${scope(p)} and o.stage <> 'CANCELADO'),
          first as (select customer_id, min(d) as first_day from valid group by customer_id)
          select to_char(date_trunc(${g}, v.d), 'YYYY-MM-DD') as periodo,
                 count(distinct v.customer_id) filter (where date_trunc(${g}, f.first_day) = date_trunc(${g}, v.d))::int as novos,
                 count(distinct v.customer_id) filter (where date_trunc(${g}, f.first_day) < date_trunc(${g}, v.d))::int as recorrentes,
                 coalesce(sum(v.total) filter (where date_trunc(${g}, f.first_day) = date_trunc(${g}, v.d)), 0)::float8 as "faturamentoNovos",
                 coalesce(sum(v.total) filter (where date_trunc(${g}, f.first_day) < date_trunc(${g}, v.d)), 0)::float8 as "faturamentoRecorrentes"
            from valid v join first f using (customer_id)
           where v.d between ${p.from}::date and ${p.to}::date
           group by 1 order by 1`,
    );
    const byBucket = new Map(raw.map((r) => [r.periodo, r]));
    const rows = periodBuckets(p.from, p.to, g).map(
      (periodo) => byBucket.get(periodo) ?? { periodo, novos: 0, recorrentes: 0, faturamentoNovos: 0, faturamentoRecorrentes: 0 },
    );
    const [totals] = await query<{ novos: number; ativos: number }>(
      tx,
      sql`with valid as (select o.customer_id, ${orderDay(p)} as d from orders o where ${scope(p)} and o.stage <> 'CANCELADO')
          select count(*) filter (where first_day between ${p.from}::date and ${p.to}::date)::int as novos,
                 count(*) filter (where last_in_period)::int as ativos
            from (select customer_id, min(d) as first_day,
                         bool_or(d between ${p.from}::date and ${p.to}::date) as last_in_period
                    from valid group by customer_id) c`,
    );
    const xFormat = g === 'month' ? 'month' : 'date';
    return {
      summary: [
        { label: 'Clientes que compraram', value: totals?.ativos ?? 0, format: 'int' },
        { label: 'Clientes novos', value: totals?.novos ?? 0, format: 'int', hint: 'primeira compra no período' },
        { label: 'Recorrentes', value: (totals?.ativos ?? 0) - (totals?.novos ?? 0), format: 'int' },
      ],
      chart: {
        type: 'bar',
        x: 'periodo',
        xFormat,
        series: [
          { key: 'novos', label: 'Novos' },
          { key: 'recorrentes', label: 'Recorrentes' },
        ],
        format: 'int',
        stacked: true,
      },
      columns: [
        { key: 'periodo', label: g === 'day' ? 'Dia' : g === 'week' ? 'Semana de' : 'Mês', format: xFormat },
        { key: 'novos', label: 'Clientes novos', format: 'int' },
        { key: 'recorrentes', label: 'Recorrentes', format: 'int' },
        { key: 'faturamentoNovos', label: 'Valor (novos)', format: 'money' },
        { key: 'faturamentoRecorrentes', label: 'Valor (recorrentes)', format: 'money' },
      ],
      rows,
    };
  },
};

const recompra: ReportDefinition = {
  slug: 'recompra',
  group: 'Clientes',
  title: 'Recompra e frequência',
  description: 'Dos clientes que compraram no período, quantos já voltaram a comprar (em todo o histórico) e de quanto em quanto tempo.',
  permission: 'reports:read',
  async run(tx, p) {
    const rows = await query<{ pedidos: number; intervalo: number | null }>(
      tx,
      sql`with valid as (
            select o.customer_id, ${orderDay(p)} as d from orders o
             where ${scope(p)} and o.stage <> 'CANCELADO' and ${orderDay(p)} <= ${p.to}::date),
          period_customers as (select distinct customer_id from valid where d between ${p.from}::date and ${p.to}::date),
          gaps as (select customer_id, d - lag(d) over (partition by customer_id order by d) as gap from valid)
          select count(*)::int as pedidos, avg(g.gap)::float8 as intervalo
            from period_customers pc join valid v using (customer_id)
            left join lateral (select avg(gap) as gap from gaps where gaps.customer_id = pc.customer_id) g on true
           group by pc.customer_id`,
    );
    const total = rows.length;
    const bucket = (n: number) => (n >= 5 ? '5 ou mais' : `${n} ${n === 1 ? 'pedido' : 'pedidos'}`);
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(bucket(r.pedidos), (counts.get(bucket(r.pedidos)) ?? 0) + 1);
    const data = ['1 pedido', '2 pedidos', '3 pedidos', '4 pedidos', '5 ou mais'].map((faixa) => ({
      faixa,
      clientes: counts.get(faixa) ?? 0,
      participacao: pct(counts.get(faixa) ?? 0, total),
    }));
    const repeat = rows.filter((r) => r.pedidos >= 2);
    const intervals = repeat.map((r) => r.intervalo).filter((v): v is number => v !== null);
    return {
      summary: [
        { label: 'Taxa de recompra', value: pct(repeat.length, total), format: 'percent', hint: `${repeat.length} de ${total} clientes já compraram mais de uma vez` },
        {
          label: 'Intervalo médio entre pedidos',
          value: intervals.length ? intervals.reduce((s, v) => s + v, 0) / intervals.length : null,
          format: 'days',
        },
        { label: 'Pedidos por cliente', value: total ? rows.reduce((s, r) => s + r.pedidos, 0) / total : null, format: 'decimal' },
      ],
      chart: { type: 'bar', x: 'faixa', series: [{ key: 'clientes', label: 'Clientes' }], format: 'int' },
      columns: [
        { key: 'faixa', label: 'Pedidos no histórico' },
        { key: 'clientes', label: 'Clientes', format: 'int' },
        { key: 'participacao', label: '% dos clientes', format: 'percent' },
      ],
      rows: data,
    };
  },
};

const SEGMENTS = ['Campeões', 'Fiéis', 'Novos', 'Em risco', 'Inativos', 'Ocasionais'] as const;

const rfm: ReportDefinition = {
  slug: 'rfm',
  group: 'Clientes',
  title: 'Segmentação RFM (campanhas)',
  description:
    'Clientes por recência, frequência e valor. Use a lista (com telefone) para campanhas no WhatsApp: reconquistar quem está em risco, agradecer os campeões.',
  permission: 'reports:read',
  usesPeriod: false,
  async run(tx, p) {
    const rows = await query<Record<string, unknown> & { segmento: string }>(
      tx,
      sql`select c.name as cliente, c.phone as telefone, s.ultimo, s.recencia, s.pedidos, s.total,
                 case
                   when s.recencia <= 30 and s.pedidos >= 4 then 'Campeões'
                   when s.recencia <= 60 and s.pedidos >= 3 then 'Fiéis'
                   when s.recencia <= 30 and s.pedidos = 1 then 'Novos'
                   when s.recencia between 61 and 120 and s.pedidos >= 2 then 'Em risco'
                   when s.recencia > 120 then 'Inativos'
                   else 'Ocasionais'
                 end as segmento
            from (select o.customer_id, max(${orderDay(p)}) as ultimo,
                         ((now() at time zone ${p.timezone})::date - max(${orderDay(p)}))::int as recencia,
                         count(*)::int as pedidos, sum(o.total_cents)::float8 as total
                    from orders o where ${scope(p)} and o.stage <> 'CANCELADO' and coalesce(o.scheduled_at, o.created_at) <= now()
                   group by o.customer_id) s
            join customers c on c.id = s.customer_id and c.status
           order by s.total desc`,
    );
    const data = SEGMENTS.map((segmento) => ({ segmento, clientes: rows.filter((r) => r.segmento === segmento).length }));
    return {
      summary: [
        { label: 'Campeões', value: data[0]!.clientes, format: 'int', hint: 'compraram nos últimos 30 dias e 4+ vezes' },
        { label: 'Em risco', value: data[3]!.clientes, format: 'int', hint: 'compravam e sumiram há 2 a 4 meses' },
        { label: 'Inativos', value: data[4]!.clientes, format: 'int', hint: 'sem comprar há mais de 4 meses' },
      ],
      chart: { type: 'bar', x: 'segmento', series: [{ key: 'clientes', label: 'Clientes' }], format: 'int', data },
      columns: [
        { key: 'cliente', label: 'Cliente' },
        { key: 'telefone', label: 'WhatsApp', format: 'phone' },
        { key: 'segmento', label: 'Segmento' },
        { key: 'ultimo', label: 'Última compra', format: 'date' },
        { key: 'recencia', label: 'Dias sem comprar', format: 'int' },
        { key: 'pedidos', label: 'Pedidos', format: 'int' },
        { key: 'total', label: 'Total gasto', format: 'money' },
      ],
      rows,
    };
  },
};

const topClientes: ReportDefinition = {
  slug: 'top-clientes',
  group: 'Clientes',
  title: 'Melhores clientes (LTV)',
  description: 'Os 50 clientes que mais compraram em todo o histórico (valor total dos pedidos entregues).',
  permission: 'reports:read',
  usesPeriod: false,
  async run(tx, p) {
    const rows = await query(
      tx,
      sql`select c.name as cliente, c.phone as telefone, count(*)::int as pedidos, sum(o.total_cents)::float8 as total,
                 (sum(o.total_cents) / count(*))::float8 as ticket, min(${orderDay(p)}) as primeiro, max(${orderDay(p)}) as ultimo
            from orders o join customers c on c.id = o.customer_id and c.status
           where ${scope(p)} and ${delivered}
           group by c.id order by total desc limit 50`,
    );
    return {
      columns: [
        { key: 'cliente', label: 'Cliente' },
        { key: 'telefone', label: 'WhatsApp', format: 'phone' },
        { key: 'pedidos', label: 'Pedidos', format: 'int' },
        { key: 'total', label: 'Total gasto', format: 'money' },
        { key: 'ticket', label: 'Ticket médio', format: 'money' },
        { key: 'primeiro', label: 'Primeira compra', format: 'date' },
        { key: 'ultimo', label: 'Última compra', format: 'date' },
      ],
      rows,
    };
  },
};

const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const aniversariantes: ReportDefinition = {
  slug: 'aniversariantes',
  group: 'Clientes',
  title: 'Aniversariantes do mês',
  description: 'Clientes que fazem aniversário no mês escolhido — para mandar um mimo ou um cupom.',
  permission: 'reports:read',
  usesPeriod: false,
  extraParams: [
    {
      name: 'mes',
      label: 'Mês',
      options: MONTH_NAMES.map((label, i) => ({ value: String(i + 1), label })),
      default: (today) => String(Number(today.slice(5, 7))),
    },
  ],
  async run(tx, p) {
    const rows = await query(
      tx,
      sql`select extract(day from c.birthday)::int as dia, c.name as cliente, c.phone as telefone,
                 count(o.id) filter (where o.status and o.stage <> 'CANCELADO')::int as pedidos,
                 max(o.created_at) filter (where o.status and o.stage <> 'CANCELADO') as ultimo
            from customers c left join orders o on o.customer_id = c.id
           where c.status and c.tenant_id = any(${tenantArray(p)}) and extract(month from c.birthday) = ${Number(p.extra.mes)}
           group by c.id order by dia, cliente`,
    );
    return {
      columns: [
        { key: 'dia', label: 'Dia', format: 'int' },
        { key: 'cliente', label: 'Cliente' },
        { key: 'telefone', label: 'WhatsApp', format: 'phone' },
        { key: 'pedidos', label: 'Pedidos', format: 'int' },
        { key: 'ultimo', label: 'Último pedido', format: 'datetime' },
      ],
      rows,
    };
  },
};

const bairros: ReportDefinition = {
  slug: 'bairros',
  group: 'Clientes',
  title: 'Vendas por bairro',
  description: 'Onde estão os clientes: pedidos entregues, faturamento e ticket por bairro (o do pedido ou, se vazio, o do cadastro).',
  permission: 'reports:read',
  async run(tx, p) {
    const rows = await query<{ bairro: string; clientes: number; pedidos: number; faturamento: number }>(
      tx,
      sql`select coalesce(nullif(trim(o.neighborhood), ''), nullif(trim(c.neighborhood), ''), 'Não informado') as bairro,
                 count(distinct o.customer_id)::int as clientes, count(*)::int as pedidos, sum(o.total_cents)::float8 as faturamento
            from orders o join customers c on c.id = o.customer_id
           where ${scope(p)} and ${delivered} and ${inPeriod(p)}
           group by 1 order by faturamento desc`,
    );
    const data = rows.map((r) => ({ ...r, ticket: r.faturamento / r.pedidos }));
    return {
      chart: { type: 'bar', x: 'bairro', series: [{ key: 'faturamento', label: 'Faturamento' }], format: 'money', horizontal: true, data: data.slice(0, 10) },
      columns: [
        { key: 'bairro', label: 'Bairro' },
        { key: 'clientes', label: 'Clientes', format: 'int' },
        { key: 'pedidos', label: 'Pedidos entregues', format: 'int' },
        { key: 'faturamento', label: 'Faturamento', format: 'money' },
        { key: 'ticket', label: 'Ticket médio', format: 'money' },
      ],
      rows: data,
    };
  },
};

export const clientesReports = [novosRecorrentes, recompra, rfm, topClientes, aniversariantes, bairros];
