import { STOCK_KIND_LABEL, STOCK_MOVEMENT_LABEL, stockSituation, STOCK_SITUATION_LABEL, todayInZone, type StockKind, type StockMovementKind } from '@zaraki/core';
import { sql } from 'drizzle-orm';
import { query, tenantArray, type ReportDefinition, type ReportParams } from './types';

// Relatórios do estoque. Com "Todas as unidades" (Matriz), os valores são somados por item de mesmo nome.

const items = (p: ReportParams) => sql`i.status and i.tenant_id = any(${tenantArray(p)})`;
/** Custo médio por unidade do item (alias "i"). */
const avgCost = sql`(select sum(c.total_cents)::float8 / nullif(sum(c.qty), 0)::float8 from stock_movements c where c.item_id = i.id and c.status and c.kind = 'COMPRA')`;

const posicao: ReportDefinition = {
  slug: 'posicao-estoque',
  group: 'Estoque',
  title: 'Posição do estoque',
  description: 'Saldo de cada item hoje, estoque mínimo, custo médio e quanto dinheiro está parado no estoque.',
  permission: 'stock:read',
  usesPeriod: false,
  async run(tx, p) {
    const rows = await query<{ item: string; categoria: StockKind; unidade: string; saldo: number; minimo: number; custo: number | null }>(
      tx,
      sql`select i.name as item, i.kind as categoria, i.unit as unidade,
                 coalesce((select sum(m.qty) from stock_movements m where m.item_id = i.id and m.status), 0)::float8 as saldo,
                 i.min_qty::float8 as minimo, ${avgCost} as custo
            from stock_items i where ${items(p)} and i.active order by i.kind, i.name`,
    );
    const data = rows.map((r) => ({
      item: r.item,
      categoria: STOCK_KIND_LABEL[r.categoria],
      saldo: r.saldo,
      unidade: r.unidade,
      minimo: r.minimo,
      situacao: STOCK_SITUATION_LABEL[stockSituation(r.saldo, r.minimo)],
      custo: r.custo,
      valor: r.custo === null ? null : Math.max(0, r.saldo) * r.custo,
    }));
    return {
      summary: [
        { label: 'Valor em estoque', value: data.reduce((s, r) => s + (r.valor ?? 0), 0), format: 'money' },
        { label: 'Itens a repor', value: data.filter((r) => r.situacao !== STOCK_SITUATION_LABEL.OK).length, format: 'int' },
      ],
      columns: [
        { key: 'item', label: 'Item' },
        { key: 'categoria', label: 'Categoria' },
        { key: 'saldo', label: 'Saldo', format: 'decimal' },
        { key: 'unidade', label: 'Unidade' },
        { key: 'minimo', label: 'Mínimo', format: 'decimal' },
        { key: 'situacao', label: 'Situação' },
        { key: 'custo', label: 'Custo médio / unidade', format: 'money' },
        { key: 'valor', label: 'Valor em estoque', format: 'money' },
      ],
      rows: data,
    };
  },
};

const movimentacao: ReportDefinition = {
  slug: 'movimentacao-estoque',
  group: 'Estoque',
  title: 'Entradas e saídas por item',
  description: 'No período: quanto entrou (compras), saiu pelos pedidos, foi perdido, consumido ou ajustado na contagem.',
  permission: 'stock:read',
  async run(tx, p) {
    const rows = await query<{ item: string; unidade: string; kind: StockMovementKind; qty: number }>(
      tx,
      sql`select i.name as item, i.unit as unidade, m.kind, sum(m.qty)::float8 as qty
            from stock_movements m join stock_items i on i.id = m.item_id
           where ${items(p)} and m.status and m.occurred_on between ${p.from}::date and ${p.to}::date
           group by 1, 2, 3 order by 1`,
    );
    const byItem = new Map<string, Record<string, number | string>>();
    for (const r of rows) {
      const row = byItem.get(r.item) ?? { item: r.item, unidade: r.unidade, COMPRA: 0, ENTRADA: 0, PEDIDO: 0, PERDA: 0, CONSUMO: 0, AJUSTE: 0 };
      row[r.kind] = Number(row[r.kind]) + r.qty;
      byItem.set(r.item, row);
    }
    const data = [...byItem.values()].map((r) => ({ ...r, PEDIDO: -Number(r.PEDIDO), PERDA: -Number(r.PERDA), CONSUMO: -Number(r.CONSUMO) }));
    return {
      columns: [
        { key: 'item', label: 'Item' },
        { key: 'unidade', label: 'Unidade' },
        { key: 'COMPRA', label: 'Compras', format: 'decimal' },
        { key: 'ENTRADA', label: 'Outras entradas', format: 'decimal' },
        { key: 'PEDIDO', label: 'Saídas por pedidos', format: 'decimal' },
        { key: 'PERDA', label: 'Perdas', format: 'decimal' },
        { key: 'CONSUMO', label: 'Consumo interno', format: 'decimal' },
        { key: 'AJUSTE', label: 'Ajustes de contagem', format: 'decimal' },
      ],
      rows: data,
      note: 'Saídas por pedidos = tubos entregues × ficha técnica de cada sabor.',
    };
  },
};

const perdas: ReportDefinition = {
  slug: 'perdas-estoque',
  group: 'Estoque',
  title: 'Perdas e desperdício',
  description: 'Perdas registradas e faltas encontradas na contagem, em quantidade e em reais, item a item.',
  permission: 'stock:read',
  async run(tx, p) {
    const rows = await query<{ item: string; unidade: string; tipo: StockMovementKind; qty: number; custo: number | null; motivo: string | null }>(
      tx,
      sql`select i.name as item, i.unit as unidade, m.kind as tipo, -sum(m.qty)::float8 as qty, ${avgCost} as custo,
                 string_agg(distinct nullif(m.notes, ''), ' · ') as motivo
            from stock_movements m join stock_items i on i.id = m.item_id
           where ${items(p)} and m.status and m.occurred_on between ${p.from}::date and ${p.to}::date
             and (m.kind = 'PERDA' or (m.kind = 'AJUSTE' and m.qty < 0))
           group by i.id, i.name, i.unit, m.kind order by 1`,
    );
    const data = rows.map((r) => ({ item: r.item, tipo: r.tipo === 'PERDA' ? STOCK_MOVEMENT_LABEL.PERDA : 'Falta na contagem', quantidade: r.qty, unidade: r.unidade, valor: r.custo === null ? null : r.qty * r.custo, motivo: r.motivo }));
    const total = data.reduce((s, r) => s + (r.valor ?? 0), 0);
    return {
      summary: [{ label: 'Perdas no período', value: total, format: 'money', hint: 'Avaliadas pelo custo médio de compra.' }],
      columns: [
        { key: 'item', label: 'Item' },
        { key: 'tipo', label: 'Tipo' },
        { key: 'quantidade', label: 'Quantidade', format: 'decimal' },
        { key: 'unidade', label: 'Unidade' },
        { key: 'valor', label: 'Valor', format: 'money' },
        { key: 'motivo', label: 'Observações' },
      ],
      rows: data,
      chart: { type: 'bar', x: 'item', format: 'money', horizontal: true, series: [{ key: 'valor', label: 'Perdas' }], data: [...data].sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0)).slice(0, 10) },
    };
  },
};

const estoqueRede: ReportDefinition = {
  slug: 'estoque-rede',
  group: 'Franquia',
  title: 'Estoque da rede',
  description: 'Valor em estoque, itens a repor e perdas de cada unidade, lado a lado.',
  permission: 'tenants:manage',
  network: true,
  async run(tx, p) {
    const today = todayInZone(p.timezone);
    const rows = await query<{ unidade: string; valor: number; repor: number; perdas: number }>(
      tx,
      sql`select t.name as unidade,
                 coalesce(sum(greatest(s.saldo, 0) * coalesce(s.custo, 0)), 0)::float8 as valor,
                 count(*) filter (where s.id is not null and s.saldo < s.minimo)::int as repor,
                 coalesce((select sum(-m.qty * coalesce((select sum(c.total_cents)::float8 / nullif(sum(c.qty), 0)::float8
                                                 from stock_movements c where c.item_id = m.item_id and c.status and c.kind = 'COMPRA'), 0))
                             from stock_movements m
                            where m.tenant_id = t.id and m.status and m.occurred_on between ${p.from}::date and ${p.to}::date
                              and (m.kind = 'PERDA' or (m.kind = 'AJUSTE' and m.qty < 0))), 0)::float8 as perdas
            from tenants t
            left join lateral (
              select i.id, i.min_qty::float8 as minimo,
                     coalesce((select sum(m.qty) from stock_movements m where m.item_id = i.id and m.status), 0)::float8 as saldo,
                     ${avgCost} as custo
                from stock_items i where i.tenant_id = t.id and i.status and i.active
            ) s on true
           where t.status and t.id = any(${tenantArray(p)})
           group by t.id, t.name, t.kind order by t.kind, t.name`,
    );
    return {
      summary: [
        { label: 'Valor em estoque (rede)', value: rows.reduce((s, r) => s + r.valor, 0), format: 'money' },
        { label: 'Itens a repor (rede)', value: rows.reduce((s, r) => s + r.repor, 0), format: 'int', hint: `Posição em ${today.split('-').reverse().join('/')}.` },
        { label: 'Perdas no período', value: rows.reduce((s, r) => s + r.perdas, 0), format: 'money' },
      ],
      columns: [
        { key: 'unidade', label: 'Unidade' },
        { key: 'valor', label: 'Valor em estoque', format: 'money' },
        { key: 'repor', label: 'Itens a repor', format: 'int' },
        { key: 'perdas', label: 'Perdas no período', format: 'money' },
      ],
      rows,
      chart: { type: 'bar', x: 'unidade', format: 'money', series: [{ key: 'valor', label: 'Valor em estoque' }, { key: 'perdas', label: 'Perdas' }] },
    };
  },
};

export const estoqueReports: ReportDefinition[] = [posicao, movimentacao, perdas];
export const estoqueRedeReports: ReportDefinition[] = [estoqueRede];
