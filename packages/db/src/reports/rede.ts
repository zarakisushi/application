import { AUDIT_ACTION_LABEL, AUDIT_ENTITY_LABEL, ORDER_TYPES, ORDER_TYPE_LABEL, auditRecordTitle } from '@zaraki/core';
import { sql } from 'drizzle-orm';
import { delivered, inPeriod, pct, query, scope, tenantArray, type ReportDefinition } from './types';

// ---------- Franquia (só a Matriz; tenantIds = todas as unidades ativas) ----------

const unidades: ReportDefinition = {
  slug: 'ranking-unidades',
  group: 'Franquia',
  title: 'Ranking de unidades',
  description: 'Faturamento, pedidos, ticket e clientes de cada unidade, com o crescimento sobre o período anterior.',
  permission: 'tenants:manage',
  network: true,
  async run(tx, p) {
    const rows = await query<{ unidade: string; faturamento: number; pedidos: number; clientes: number; anterior: number }>(
      tx,
      sql`select t.name as unidade,
                 coalesce(sum(o.total_cents) filter (where ${inPeriod(p)}), 0)::float8 as faturamento,
                 count(o.id) filter (where ${inPeriod(p)})::int as pedidos,
                 count(distinct o.customer_id) filter (where ${inPeriod(p)})::int as clientes,
                 coalesce(sum(o.total_cents) filter (where ${inPeriod(p, p.previous)}), 0)::float8 as anterior
            from tenants t left join orders o on o.tenant_id = t.id and ${scope(p)} and ${delivered}
           where t.status and t.id = any(${tenantArray(p)})
           group by t.id order by faturamento desc`,
    );
    const data = rows.map((r) => ({
      ...r,
      ticket: r.pedidos ? r.faturamento / r.pedidos : null,
      crescimento: r.anterior ? ((r.faturamento - r.anterior) / r.anterior) * 100 : null,
    }));
    return {
      summary: [{ label: 'Faturamento da rede', value: data.reduce((s, r) => s + r.faturamento, 0), previous: data.reduce((s, r) => s + r.anterior, 0), format: 'money' }],
      chart: { type: 'bar', x: 'unidade', series: [{ key: 'faturamento', label: 'Faturamento' }], format: 'money', horizontal: true },
      columns: [
        { key: 'unidade', label: 'Unidade' },
        { key: 'faturamento', label: 'Faturamento', format: 'money' },
        { key: 'pedidos', label: 'Pedidos entregues', format: 'int' },
        { key: 'ticket', label: 'Ticket médio', format: 'money' },
        { key: 'clientes', label: 'Clientes', format: 'int' },
        { key: 'crescimento', label: 'Crescimento', format: 'percent' },
      ],
      rows: data,
    };
  },
};

const royalties: ReportDefinition = {
  slug: 'royalties',
  group: 'Franquia',
  title: 'Royalties estimados',
  description: 'Percentual de royalties de cada franqueado aplicado ao faturamento realizado no período.',
  permission: 'tenants:manage',
  network: true,
  async run(tx, p) {
    const rows = await query<{ unidade: string; tipo: string; faturamento: number; percentual: number }>(
      tx,
      sql`select t.name as unidade, t.kind::text as tipo, t.royalty_pct::float8 as percentual,
                 coalesce(sum(o.total_cents), 0)::float8 as faturamento
            from tenants t left join orders o on o.tenant_id = t.id and ${scope(p)} and ${delivered} and ${inPeriod(p)}
           where t.status and t.id = any(${tenantArray(p)})
           group by t.id order by faturamento desc`,
    );
    const data = rows.map((r) => ({
      unidade: r.unidade,
      tipo: r.tipo === 'MATRIZ' ? 'Matriz' : 'Franquia',
      faturamento: r.faturamento,
      percentual: r.percentual,
      royalties: r.tipo === 'MATRIZ' ? 0 : (r.faturamento * r.percentual) / 100,
    }));
    return {
      summary: [{ label: 'Royalties a receber', value: data.reduce((s, r) => s + r.royalties, 0), format: 'money' }],
      columns: [
        { key: 'unidade', label: 'Unidade' },
        { key: 'tipo', label: 'Tipo' },
        { key: 'faturamento', label: 'Faturamento', format: 'money' },
        { key: 'percentual', label: 'Royalties (%)', format: 'percent' },
        { key: 'royalties', label: 'Royalties estimados', format: 'money' },
      ],
      rows: data,
    };
  },
};

const mixUnidades: ReportDefinition = {
  slug: 'mix-unidades',
  group: 'Franquia',
  title: 'Comparativo entre unidades',
  description: 'Participação de delivery, encomendas e festas no faturamento de cada unidade, ticket médio e sabor mais vendido.',
  permission: 'tenants:manage',
  network: true,
  async run(tx, p) {
    const raw = await query<{ unidade: string; tipo: string; faturamento: number; pedidos: number }>(
      tx,
      sql`select t.name as unidade, o.type::text as tipo, sum(o.total_cents)::float8 as faturamento, count(*)::int as pedidos
            from orders o join tenants t on t.id = o.tenant_id
           where ${scope(p)} and ${delivered} and ${inPeriod(p)} group by t.id, o.type`,
    );
    const top = await query<{ unidade: string; sabor: string }>(
      tx,
      sql`select distinct on (t.id) t.name as unidade, i.product_name as sabor
            from order_items i join orders o on o.id = i.order_id join tenants t on t.id = o.tenant_id
           where i.status and ${scope(p)} and ${delivered} and ${inPeriod(p)}
           group by t.id, i.product_name order by t.id, sum(i.qty) desc`,
    );
    const units = new Map<string, Record<string, number | string | null>>();
    for (const r of raw) {
      const u = units.get(r.unidade) ?? { unidade: r.unidade, total: 0, pedidos: 0 };
      u[r.tipo] = r.faturamento;
      u.total = (u.total as number) + r.faturamento;
      u.pedidos = (u.pedidos as number) + r.pedidos;
      units.set(r.unidade, u);
    }
    const rows = [...units.values()].map((u) => ({
      ...u,
      ...Object.fromEntries(ORDER_TYPES.map((t) => [`${t}_pct`, pct((u[t] as number) ?? 0, u.total as number)])),
      ticket: (u.total as number) / (u.pedidos as number),
      topSabor: top.find((t) => t.unidade === u.unidade)?.sabor ?? null,
    }));
    return {
      chart: {
        type: 'bar',
        x: 'unidade',
        series: ORDER_TYPES.map((t) => ({ key: `${t}_pct`, label: ORDER_TYPE_LABEL[t] })),
        format: 'percent',
        stacked: true,
        horizontal: true,
      },
      columns: [
        { key: 'unidade', label: 'Unidade' },
        ...ORDER_TYPES.map((t) => ({ key: `${t}_pct`, label: `% ${ORDER_TYPE_LABEL[t]}`, format: 'percent' as const })),
        { key: 'ticket', label: 'Ticket médio', format: 'money' },
        { key: 'topSabor', label: 'Sabor mais vendido' },
      ],
      rows,
    };
  },
};

// ---------- Governança (a partir da auditoria) ----------

const atividade: ReportDefinition = {
  slug: 'atividade-usuarios',
  group: 'Governança',
  title: 'Atividade por usuário',
  description: 'Quantas criações, alterações, exclusões e restaurações cada pessoa fez no período.',
  permission: 'audit:read',
  async run(tx, p) {
    const rows = await query(
      tx,
      sql`select coalesce(u.name, a.actor_label, 'Sistema') as pessoa,
                 count(*) filter (where a.action = 'CREATE')::int as criacoes,
                 count(*) filter (where a.action = 'UPDATE')::int as alteracoes,
                 count(*) filter (where a.action = 'SOFT_DELETE')::int as exclusoes,
                 count(*) filter (where a.action = 'RESTORE')::int as restauracoes,
                 count(*)::int as total, max(a.created_at) as ultima
            from audit_logs a left join users u on u.id = a.actor_user_id
           where a.tenant_id = any(${tenantArray(p)})
             and a.action in ('CREATE', 'UPDATE', 'SOFT_DELETE', 'RESTORE')
             and (a.created_at at time zone ${p.timezone})::date between ${p.from}::date and ${p.to}::date
           group by 1 order by total desc`,
    );
    return {
      columns: [
        { key: 'pessoa', label: 'Pessoa / processo' },
        { key: 'criacoes', label: 'Criações', format: 'int' },
        { key: 'alteracoes', label: 'Alterações', format: 'int' },
        { key: 'exclusoes', label: 'Exclusões', format: 'int' },
        { key: 'restauracoes', label: 'Restaurações', format: 'int' },
        { key: 'total', label: 'Total', format: 'int' },
        { key: 'ultima', label: 'Última ação', format: 'datetime' },
      ],
      rows,
    };
  },
};

const exclusoes: ReportDefinition = {
  slug: 'exclusoes',
  group: 'Governança',
  title: 'Exclusões e restaurações',
  description: 'Todos os registros excluídos (logicamente) e restaurados no período, com quem fez.',
  permission: 'audit:read',
  async run(tx, p) {
    const raw = await query<{ quando: string; acao: string; entidade: string; before: unknown; after: unknown; quem: string; id: number }>(
      tx,
      sql`select a.id, a.created_at as quando, a.action as acao, a.entity as entidade, a.before, a.after,
                 coalesce(u.name, a.actor_label, 'Sistema') as quem
            from audit_logs a left join users u on u.id = a.actor_user_id
           where a.tenant_id = any(${tenantArray(p)}) and a.action in ('SOFT_DELETE', 'RESTORE')
             and (a.created_at at time zone ${p.timezone})::date between ${p.from}::date and ${p.to}::date
           order by a.id desc`,
    );
    const rows = raw.map((r) => ({
      quando: r.quando,
      acao: AUDIT_ACTION_LABEL[r.acao] ?? r.acao,
      tipo: AUDIT_ENTITY_LABEL[r.entidade] ?? r.entidade,
      registro: auditRecordTitle(r) ?? '—',
      quem: r.quem,
      auditoria: `#${r.id}`,
    }));
    return {
      columns: [
        { key: 'quando', label: 'Quando', format: 'datetime' },
        { key: 'acao', label: 'Ação' },
        { key: 'tipo', label: 'Tipo de registro' },
        { key: 'registro', label: 'Registro' },
        { key: 'quem', label: 'Quem' },
        { key: 'auditoria', label: 'Auditoria' },
      ],
      rows,
    };
  },
};

export const franquiaReports = [unidades, royalties, mixUnidades];
export const governancaReports = [atividade, exclusoes];
