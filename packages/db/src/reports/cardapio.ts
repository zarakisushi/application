import { ORDER_TYPES, ORDER_TYPE_LABEL } from '@zaraki/core';
import { sql } from 'drizzle-orm';
import type { Tx } from '../client';
import { delivered, inPeriod, pct, query, scope, tenantArray, type ReportDefinition, type ReportParams } from './types';

type ProductSales = { productId: string; sabor: string; tubos: number; faturamento: number; custo: number; semCusto: boolean };

/** Itens de pedidos entregues no período, por sabor (nome mais recente do sabor). */
export async function productSales(tx: Tx, p: ReportParams): Promise<ProductSales[]> {
  return query<ProductSales>(
    tx,
    sql`select i.product_id as "productId",
               (array_agg(i.product_name order by o.created_at desc))[1] as sabor,
               sum(i.qty)::int as tubos,
               sum(i.line_total_cents)::float8 as faturamento,
               sum(i.unit_cost_cents * i.qty)::float8 as custo,
               bool_or(i.unit_cost_cents = 0) as "semCusto"
          from order_items i join orders o on o.id = i.order_id
         where i.status and ${scope(p)} and ${delivered} and ${inPeriod(p)}
         group by i.product_id
         order by faturamento desc`,
  );
}

const ranking: ReportDefinition = {
  slug: 'ranking-sabores',
  group: 'Cardápio',
  title: 'Ranking de sabores e curva ABC',
  description: 'Sabores mais vendidos em tubos e em faturamento. Curva ABC: A = 80% do faturamento, B = os 15% seguintes, C = o restante.',
  permission: 'reports:read',
  async run(tx, p) {
    const sales = await productSales(tx, p);
    const total = sales.reduce((s, r) => s + r.faturamento, 0);
    let cumulative = 0;
    const rows = sales.map((r, i) => {
      const share = pct(r.faturamento, total);
      const before = cumulative;
      cumulative += share;
      // A classe é decidida pela participação acumulada antes do item (o item que cruza 80% ainda é A).
      const curva = before < 80 ? 'A' : before < 95 ? 'B' : 'C';
      return { posicao: i + 1, sabor: r.sabor, tubos: r.tubos, faturamento: r.faturamento, participacao: share, acumulado: cumulative, curva };
    });
    return {
      summary: [
        { label: 'Tubos vendidos', value: rows.reduce((s, r) => s + r.tubos, 0), format: 'int' },
        { label: 'Sabores na curva A', value: rows.filter((r) => r.curva === 'A').length, format: 'int', hint: 'concentram 80% do faturamento' },
      ],
      chart: { type: 'bar', x: 'sabor', series: [{ key: 'faturamento', label: 'Faturamento' }], format: 'money', horizontal: true },
      columns: [
        { key: 'posicao', label: '#', format: 'int' },
        { key: 'sabor', label: 'Sabor' },
        { key: 'tubos', label: 'Tubos', format: 'int' },
        { key: 'faturamento', label: 'Faturamento', format: 'money' },
        { key: 'participacao', label: '% do faturamento', format: 'percent' },
        { key: 'acumulado', label: '% acumulado', format: 'percent' },
        { key: 'curva', label: 'Curva' },
      ],
      rows,
    };
  },
};

const margem: ReportDefinition = {
  slug: 'margem-cmv',
  group: 'Cardápio',
  title: 'Margem e CMV por sabor',
  description: 'Receita, custo dos insumos (CMV) e margem bruta de cada sabor, com o custo registrado no momento de cada pedido.',
  permission: 'reports:read',
  async run(tx, p) {
    const sales = await productSales(tx, p);
    const rows = sales.map((r) => ({
      sabor: r.sabor,
      tubos: r.tubos,
      faturamento: r.faturamento,
      custo: r.custo,
      margem: r.faturamento - r.custo,
      margemPct: pct(r.faturamento - r.custo, r.faturamento),
      cmv: pct(r.custo, r.faturamento),
    }));
    const receita = rows.reduce((s, r) => s + r.faturamento, 0);
    const custo = rows.reduce((s, r) => s + r.custo, 0);
    const missing = sales.filter((s) => s.semCusto).map((s) => s.sabor);
    return {
      note: missing.length
        ? `Sem custo cadastrado em parte das vendas de: ${missing.join(', ')}. Para esses sabores a margem aparece maior do que a real — cadastre o custo no Cardápio.`
        : undefined,
      summary: [
        { label: 'Receita', value: receita, format: 'money' },
        { label: 'Custo dos insumos (CMV)', value: custo, format: 'money' },
        { label: 'Margem bruta', value: receita - custo, format: 'money' },
        { label: 'CMV sobre a receita', value: pct(custo, receita), format: 'percent' },
      ],
      chart: {
        type: 'bar',
        x: 'sabor',
        series: [
          { key: 'custo', label: 'Custo (CMV)' },
          { key: 'margem', label: 'Margem bruta' },
        ],
        format: 'money',
        stacked: true,
        horizontal: true,
      },
      columns: [
        { key: 'sabor', label: 'Sabor' },
        { key: 'tubos', label: 'Tubos', format: 'int' },
        { key: 'faturamento', label: 'Receita', format: 'money' },
        { key: 'custo', label: 'Custo (CMV)', format: 'money' },
        { key: 'margem', label: 'Margem bruta', format: 'money' },
        { key: 'margemPct', label: 'Margem %', format: 'percent' },
        { key: 'cmv', label: 'CMV %', format: 'percent' },
      ],
      rows,
    };
  },
};

const mix: ReportDefinition = {
  slug: 'mix-por-tipo',
  group: 'Cardápio',
  title: 'Mix de sabores por tipo de pedido',
  description: 'Quantos tubos de cada sabor saem no delivery, nas festas e nos eventos.',
  permission: 'reports:read',
  async run(tx, p) {
    const raw = await query<{ sabor: string; tipo: string; tubos: number }>(
      tx,
      sql`select (array_agg(i.product_name order by o.created_at desc))[1] as sabor, o.type::text as tipo, sum(i.qty)::int as tubos
            from order_items i join orders o on o.id = i.order_id
           where i.status and ${scope(p)} and ${delivered} and ${inPeriod(p)}
           group by i.product_id, o.type`,
    );
    const bySabor = new Map<string, Record<string, number | string>>();
    for (const r of raw) {
      const row = bySabor.get(r.sabor) ?? { sabor: r.sabor, DELIVERY: 0, ENCOMENDA: 0, FESTA: 0, total: 0 };
      row[r.tipo] = r.tubos;
      row.total = (row.total as number) + r.tubos;
      bySabor.set(r.sabor, row);
    }
    const rows = [...bySabor.values()].sort((a, b) => (b.total as number) - (a.total as number));
    return {
      chart: {
        type: 'bar',
        x: 'sabor',
        series: ORDER_TYPES.map((t) => ({ key: t, label: ORDER_TYPE_LABEL[t] })),
        format: 'int',
        stacked: true,
        horizontal: true,
      },
      columns: [
        { key: 'sabor', label: 'Sabor' },
        ...ORDER_TYPES.map((t) => ({ key: t, label: ORDER_TYPE_LABEL[t], format: 'int' as const })),
        { key: 'total', label: 'Total de tubos', format: 'int' },
      ],
      rows,
    };
  },
};

const precos: ReportDefinition = {
  slug: 'historico-precos',
  group: 'Cardápio',
  title: 'Histórico de preços e custos',
  description: 'Toda alteração de preço de venda ou de custo no cardápio, com quem alterou (lido da auditoria).',
  permission: 'reports:read',
  async run(tx, p) {
    const rows = await query(
      tx,
      sql`select a.created_at as quando, a.after ->> 'name' as sabor,
                 (a.before ->> 'price_cents')::float8 as "precoAntes", (a.after ->> 'price_cents')::float8 as "precoDepois",
                 (a.before ->> 'cost_cents')::float8 as "custoAntes", (a.after ->> 'cost_cents')::float8 as "custoDepois",
                 coalesce(u.name, a.actor_label) as quem
            from audit_logs a left join users u on u.id = a.actor_user_id
           where a.entity = 'products' and a.action = 'UPDATE'
             and a.changed_fields && array['price_cents', 'cost_cents']
             and a.tenant_id = any(${tenantArray(p)})
             and (a.created_at at time zone ${p.timezone})::date between ${p.from}::date and ${p.to}::date
           order by a.id desc`,
    );
    return {
      columns: [
        { key: 'quando', label: 'Quando', format: 'datetime' },
        { key: 'sabor', label: 'Sabor' },
        { key: 'precoAntes', label: 'Preço antes', format: 'money' },
        { key: 'precoDepois', label: 'Preço depois', format: 'money' },
        { key: 'custoAntes', label: 'Custo antes', format: 'money' },
        { key: 'custoDepois', label: 'Custo depois', format: 'money' },
        { key: 'quem', label: 'Quem alterou' },
      ],
      rows,
    };
  },
};

export const cardapioReports = [ranking, margem, mix, precos];
