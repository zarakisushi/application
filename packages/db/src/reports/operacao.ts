import { ORDER_TYPE_LABEL, STAGE_LABEL, type OrderStage, type OrderType } from '@zaraki/core';
import { sql } from 'drizzle-orm';
import { inPeriod, orderDay, pct, query, scope, type ReportDefinition } from './types';

const FLOW: OrderStage[] = ['NOVO', 'CONFIRMADO', 'EM_PREPARO', 'PRONTO', 'SAIU_PARA_ENTREGA', 'ENTREGUE', 'CANCELADO'];

const funil: ReportDefinition = {
  slug: 'funil-etapas',
  group: 'Operação',
  title: 'Funil e tempo por etapa',
  description: 'Quantos pedidos do período chegaram a cada etapa e quanto tempo, em média, levaram desde o recebimento.',
  permission: 'reports:read',
  async run(tx, p) {
    const raw = await query<{ etapa: OrderStage; pedidos: number; tempo: number | null }>(
      tx,
      sql`with period_orders as (select o.id from orders o where ${scope(p)} and ${inPeriod(p)}),
          reached as (
            select h.order_id, h.to_stage, min(h.created_at) as at
              from order_stage_history h join period_orders po on po.id = h.order_id
             where h.status group by 1, 2)
          select r.to_stage::text as etapa, count(*)::int as pedidos,
                 avg(extract(epoch from r.at - n.at) / 60)::float8 as tempo
            from reached r left join reached n on n.order_id = r.order_id and n.to_stage = 'NOVO'
           group by r.to_stage`,
    );
    const [delivery] = await query<{ tempo: number | null; pedidos: number }>(
      tx,
      sql`select avg(extract(epoch from e.at - n.at) / 60)::float8 as tempo, count(*)::int as pedidos
            from orders o
            join lateral (select min(created_at) as at from order_stage_history where order_id = o.id and to_stage = 'NOVO') n on true
            join lateral (select min(created_at) as at from order_stage_history where order_id = o.id and to_stage = 'ENTREGUE') e on true
           where ${scope(p)} and o.type = 'DELIVERY' and ${inPeriod(p)} and e.at is not null`,
    );
    const total = raw.find((r) => r.etapa === 'NOVO')?.pedidos ?? 0;
    const rows = FLOW.map((etapa) => {
      const r = raw.find((x) => x.etapa === etapa);
      return { etapa: STAGE_LABEL[etapa], pedidos: r?.pedidos ?? 0, participacao: pct(r?.pedidos ?? 0, total), tempo: etapa === 'NOVO' ? null : (r?.tempo ?? null) };
    });
    return {
      summary: [
        { label: 'Pedidos recebidos', value: total, format: 'int' },
        { label: 'Entregues', value: pct(rows[5]!.pedidos, total), format: 'percent' },
        { label: 'Cancelados', value: pct(rows[6]!.pedidos, total), format: 'percent' },
        {
          label: 'Tempo médio de entrega (delivery)',
          value: delivery?.tempo ?? null,
          format: 'minutes',
          hint: 'do recebimento até "Entregue"',
        },
      ],
      chart: { type: 'bar', x: 'etapa', series: [{ key: 'pedidos', label: 'Pedidos' }], format: 'int' },
      columns: [
        { key: 'etapa', label: 'Etapa' },
        { key: 'pedidos', label: 'Pedidos que chegaram', format: 'int' },
        { key: 'participacao', label: '% dos recebidos', format: 'percent' },
        { key: 'tempo', label: 'Tempo médio desde o recebimento', format: 'minutes' },
      ],
      rows,
    };
  },
};

const cancelamentos: ReportDefinition = {
  slug: 'cancelamentos',
  group: 'Operação',
  title: 'Cancelamentos',
  description: 'Taxa de cancelamento, valor perdido e os motivos informados.',
  permission: 'reports:read',
  async run(tx, p) {
    const [totals] = await query<{ total: number; cancelados: number; perdido: number }>(
      tx,
      sql`select count(*)::int as total, count(*) filter (where o.stage = 'CANCELADO')::int as cancelados,
                 coalesce(sum(o.total_cents) filter (where o.stage = 'CANCELADO'), 0)::float8 as perdido
            from orders o where ${scope(p)} and ${inPeriod(p)}`,
    );
    const rows = await query<{ motivo: string; pedidos: number; valor: number }>(
      tx,
      sql`select coalesce(nullif(trim(o.cancel_reason), ''), 'Sem motivo informado') as motivo, count(*)::int as pedidos,
                 sum(o.total_cents)::float8 as valor
            from orders o where ${scope(p)} and ${inPeriod(p)} and o.stage = 'CANCELADO'
           group by lower(coalesce(nullif(trim(o.cancel_reason), ''), 'Sem motivo informado')), 1
           order by pedidos desc`,
    );
    return {
      summary: [
        { label: 'Taxa de cancelamento', value: pct(totals?.cancelados ?? 0, totals?.total ?? 0), format: 'percent' },
        { label: 'Pedidos cancelados', value: totals?.cancelados ?? 0, format: 'int' },
        { label: 'Valor cancelado', value: totals?.perdido ?? 0, format: 'money' },
      ],
      chart: { type: 'bar', x: 'motivo', series: [{ key: 'pedidos', label: 'Pedidos' }], format: 'int', horizontal: true, data: rows.slice(0, 10) },
      columns: [
        { key: 'motivo', label: 'Motivo' },
        { key: 'pedidos', label: 'Pedidos', format: 'int' },
        { key: 'valor', label: 'Valor', format: 'money' },
      ],
      rows,
    };
  },
};

const sitePendentes: ReportDefinition = {
  slug: 'site-nao-confirmados',
  group: 'Operação',
  title: 'Pedidos do site não confirmados',
  description: 'Pedidos feitos no site que ainda estão como "Novo" — clientes esperando retorno — e a conversão do site no período.',
  permission: 'reports:read',
  async run(tx, p) {
    const rows = await query(
      tx,
      sql`select o.code as pedido, o.created_at as recebido,
                 (extract(epoch from now() - o.created_at) / 60)::float8 as espera,
                 c.name as cliente, c.phone as telefone, o.type::text as tipo, o.total_cents::float8 as total
            from orders o join customers c on c.id = o.customer_id
           where ${scope(p)} and o.source = 'SITE' and o.stage = 'NOVO'
           order by o.created_at`,
    );
    const [conv] = await query<{ total: number; avancaram: number }>(
      tx,
      sql`select count(*)::int as total, count(*) filter (where o.stage not in ('NOVO', 'CANCELADO'))::int as avancaram
            from orders o where ${scope(p)} and o.source = 'SITE' and ${inPeriod(p)}`,
    );
    return {
      summary: [
        { label: 'Aguardando confirmação agora', value: rows.length, format: 'int' },
        {
          label: 'Conversão do site no período',
          value: pct(conv?.avancaram ?? 0, conv?.total ?? 0),
          format: 'percent',
          hint: `${conv?.avancaram ?? 0} de ${conv?.total ?? 0} pedidos do site foram confirmados`,
        },
      ],
      columns: [
        { key: 'pedido', label: 'Pedido' },
        { key: 'recebido', label: 'Recebido em', format: 'datetime' },
        { key: 'espera', label: 'Esperando há', format: 'minutes' },
        { key: 'cliente', label: 'Cliente' },
        { key: 'telefone', label: 'WhatsApp', format: 'phone' },
        { key: 'tipo', label: 'Tipo' },
        { key: 'total', label: 'Total', format: 'money' },
      ],
      rows: rows.map((r) => ({ ...r, tipo: ORDER_TYPE_LABEL[r.tipo as OrderType] })),
    };
  },
};

const producao: ReportDefinition = {
  slug: 'previsao-producao',
  group: 'Operação',
  title: 'Previsão de produção',
  description: 'Tubos de cada sabor por dia nas festas e eventos já agendados — base para comprar peixe e organizar a cozinha.',
  permission: 'reports:read',
  usesPeriod: false,
  extraParams: [
    {
      name: 'dias',
      label: 'Próximos',
      options: [
        { value: '7', label: '7 dias' },
        { value: '14', label: '14 dias' },
        { value: '30', label: '30 dias' },
      ],
      default: () => '14',
    },
  ],
  async run(tx, p) {
    const days = [7, 14, 30].includes(Number(p.extra.dias)) ? Number(p.extra.dias) : 14;
    const rows = await query<{ dia: string; sabor: string; tubos: number; pedidos: number }>(
      tx,
      sql`select to_char(${orderDay(p)}, 'YYYY-MM-DD') as dia,
                 (array_agg(i.product_name))[1] as sabor, sum(i.qty)::int as tubos, count(distinct o.id)::int as pedidos
            from order_items i join orders o on o.id = i.order_id
           where i.status and ${scope(p)} and o.type in ('ENCOMENDA', 'FESTA') and o.stage not in ('CANCELADO', 'ENTREGUE')
             and ${orderDay(p)} between (now() at time zone ${p.timezone})::date
                                    and (now() at time zone ${p.timezone})::date + ${days}::int
           group by 1, i.product_id order by 1, tubos desc`,
    );
    const perDay = new Map<string, number>();
    const perFlavor = new Map<string, number>();
    for (const r of rows) {
      perDay.set(r.dia, (perDay.get(r.dia) ?? 0) + r.tubos);
      perFlavor.set(r.sabor, (perFlavor.get(r.sabor) ?? 0) + r.tubos);
    }
    const [orders] = await query<{ n: number }>(
      tx,
      sql`select count(*)::int as n from orders o
           where ${scope(p)} and o.type in ('ENCOMENDA', 'FESTA') and o.stage not in ('CANCELADO', 'ENTREGUE')
             and ${orderDay(p)} between (now() at time zone ${p.timezone})::date and (now() at time zone ${p.timezone})::date + ${days}::int`,
    );
    const top = [...perFlavor].sort((a, b) => b[1] - a[1])[0];
    const totalTubes = [...perDay.values()].reduce((s, v) => s + v, 0);
    return {
      summary: [
        { label: 'Tubos a produzir', value: totalTubes, format: 'int', hint: `${totalTubes * 10} peças` },
        { label: 'Festas e eventos', value: orders?.n ?? 0, format: 'int' },
        { label: 'Sabor mais pedido', value: top?.[0] ?? null, hint: top ? `${top[1]} tubos` : undefined },
      ],
      chart: {
        type: 'bar',
        x: 'dia',
        xFormat: 'date',
        series: [{ key: 'tubos', label: 'Tubos' }],
        format: 'int',
        data: [...perDay].map(([dia, tubos]) => ({ dia, tubos })),
      },
      columns: [
        { key: 'dia', label: 'Dia', format: 'date' },
        { key: 'sabor', label: 'Sabor' },
        { key: 'tubos', label: 'Tubos', format: 'int' },
        { key: 'pecas', label: 'Peças', format: 'int' },
        { key: 'pedidos', label: 'Pedidos', format: 'int' },
      ],
      rows: rows.map((r) => ({ ...r, pecas: r.tubos * 10 })),
    };
  },
};

const festas: ReportDefinition = {
  slug: 'festas',
  group: 'Operação',
  title: 'Festas',
  description: 'Festas do período com convidados, tubos por convidado e receita por convidado — referência para orçar as próximas.',
  permission: 'reports:read',
  async run(tx, p) {
    const rows = await query<{ data: string; cliente: string; convidados: number | null; tubos: number; total: number; etapa: OrderStage }>(
      tx,
      sql`select o.scheduled_at as data, c.name as cliente, o.guests as convidados, o.stage::text as etapa,
                 (select coalesce(sum(qty), 0) from order_items i where i.order_id = o.id and i.status)::int as tubos,
                 o.total_cents::float8 as total
            from orders o join customers c on c.id = o.customer_id
           where ${scope(p)} and o.type = 'FESTA' and o.stage <> 'CANCELADO' and ${inPeriod(p)}
           order by o.scheduled_at`,
    );
    const data = rows.map((r) => ({
      ...r,
      etapa: STAGE_LABEL[r.etapa],
      porConvidado: r.convidados ? r.tubos / r.convidados : null,
      receitaConvidado: r.convidados ? r.total / r.convidados : null,
    }));
    const withGuests = data.filter((r) => r.convidados);
    const guests = withGuests.reduce((s, r) => s + (r.convidados ?? 0), 0);
    return {
      summary: [
        { label: 'Festas', value: data.length, format: 'int' },
        { label: 'Convidados por festa', value: withGuests.length ? guests / withGuests.length : null, format: 'decimal' },
        { label: 'Tubos por convidado', value: guests ? withGuests.reduce((s, r) => s + r.tubos, 0) / guests : null, format: 'decimal' },
        { label: 'Receita por convidado', value: guests ? withGuests.reduce((s, r) => s + r.total, 0) / guests : null, format: 'money' },
      ],
      columns: [
        { key: 'data', label: 'Data', format: 'datetime' },
        { key: 'cliente', label: 'Cliente' },
        { key: 'convidados', label: 'Convidados', format: 'int' },
        { key: 'tubos', label: 'Tubos', format: 'int' },
        { key: 'porConvidado', label: 'Tubos por convidado', format: 'decimal' },
        { key: 'total', label: 'Valor', format: 'money' },
        { key: 'receitaConvidado', label: 'Valor por convidado', format: 'money' },
        { key: 'etapa', label: 'Etapa' },
      ],
      rows: data,
    };
  },
};

export const operacaoReports = [funil, cancelamentos, sitePendentes, producao, festas];
