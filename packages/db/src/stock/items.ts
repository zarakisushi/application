import {
  DomainError,
  SUGGESTED_STOCK_ITEMS,
  formatQty,
  roundQty,
  stockSituation,
  type StockCountInput,
  type StockItemInput,
  type StockKind,
  type StockMovementInput,
} from '@zaraki/core';
import { and, asc, desc, eq, ilike, ne, sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../client';
import { contains, paging, statusWhere, toPage, type ListParams } from '../admin/common';
import { financeCategories, orders, stockItems, stockMovements, stockPurchases } from '../schema';

/** Saldo do item: soma das movimentações ativas. */
export const balanceSql = sql<number>`coalesce((select sum(m.qty) from stock_movements m where m.item_id = stock_items.id and m.status), 0)::float8`.mapWith(Number);

/** Custo médio por unidade (centavos, pode ter fração): total pago ÷ quantidade comprada. */
export const avgCostSql = sql<number | null>`(select sum(m.total_cents)::float8 / nullif(sum(m.qty), 0)::float8
  from stock_movements m where m.item_id = stock_items.id and m.status and m.kind = 'COMPRA')`;

export type StockFilter = 'todos' | 'repor' | 'zerados';

const itemColumns = {
  id: stockItems.id,
  name: stockItems.name,
  kind: stockItems.kind,
  unit: stockItems.unit,
  minQty: sql<number>`${stockItems.minQty}::float8`.mapWith(Number),
  supplier: stockItems.supplier,
  active: stockItems.active,
  status: stockItems.status,
  financeCategoryId: stockItems.financeCategoryId,
  balance: balanceSql,
  avgCostCents: sql<number | null>`${avgCostSql}`.mapWith((v) => (v === null ? null : Number(v))),
};

export async function listStockItems(tx: Tx, tenantId: string, params: ListParams & { kind?: StockKind; filter?: StockFilter } = {}) {
  const { page, pageSize, offset } = paging({ ...params, pageSize: params.pageSize ?? 100 });
  const filterSql: Record<StockFilter, SQL | undefined> = {
    todos: undefined,
    repor: sql`${balanceSql} < ${stockItems.minQty}::float8`,
    zerados: sql`${balanceSql} <= 0`,
  };
  const where = and(
    eq(stockItems.tenantId, tenantId),
    statusWhere(stockItems.status, params.status),
    params.kind ? eq(stockItems.kind, params.kind) : undefined,
    filterSql[params.filter ?? 'todos'],
    params.q ? ilike(stockItems.name, contains(params.q)) : undefined,
  );
  const rows = await tx.select(itemColumns).from(stockItems).where(where).orderBy(asc(stockItems.kind), asc(stockItems.name)).limit(pageSize).offset(offset);
  const [total] = await tx.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(stockItems).where(where);
  return toPage(
    rows.map((r) => ({ ...r, situation: stockSituation(r.balance, r.minQty), valueCents: r.avgCostCents === null ? null : Math.round(Math.max(0, r.balance) * r.avgCostCents) })),
    total?.n ?? 0,
    page,
    pageSize,
  );
}

/** Resumo para os cartões: valor em estoque, itens a repor e perdas do mês. */
export async function stockSummary(tx: Tx, tenantId: string, monthStart: string) {
  const all = await listStockItems(tx, tenantId, { pageSize: 100_000 });
  const [losses] = await tx.execute<{ cents: number }>(sql`
    select coalesce(sum(-m.qty * coalesce((select sum(c.total_cents)::float8 / nullif(sum(c.qty), 0)::float8
                       from stock_movements c where c.item_id = m.item_id and c.status and c.kind = 'COMPRA'), 0)), 0)::float8 as cents
      from stock_movements m
     where m.tenant_id = ${tenantId} and m.status and m.occurred_on >= ${monthStart}::date
       and (m.kind = 'PERDA' or (m.kind = 'AJUSTE' and m.qty < 0))`).then((r) => r.rows);
  const active = all.rows.filter((r) => r.active);
  return {
    items: active.length,
    valueCents: active.reduce((s, r) => s + (r.valueCents ?? 0), 0),
    toRestock: active.filter((r) => r.situation !== 'OK').length,
    lossesCents: Math.round(losses?.cents ?? 0),
  };
}

export async function getStockItem(tx: Tx, tenantId: string, id: string) {
  const [row] = await tx.select(itemColumns).from(stockItems).where(and(eq(stockItems.tenantId, tenantId), eq(stockItems.id, id)));
  return row ? { ...row, situation: stockSituation(row.balance, row.minQty) } : null;
}

/** Extrato do item (movimentações, mais recentes primeiro). */
export function listItemMovements(tx: Tx, tenantId: string, itemId: string, limit = 200) {
  return tx
    .select({
      id: stockMovements.id,
      kind: stockMovements.kind,
      qty: sql<number>`${stockMovements.qty}::float8`.mapWith(Number),
      totalCents: stockMovements.totalCents,
      occurredOn: stockMovements.occurredOn,
      notes: stockMovements.notes,
      status: stockMovements.status,
      orderId: stockMovements.orderId,
      orderCode: orders.code,
      orderType: orders.type,
      purchaseId: stockMovements.purchaseId,
      supplier: stockPurchases.supplier,
      createdAt: stockMovements.createdAt,
    })
    .from(stockMovements)
    .leftJoin(orders, eq(orders.id, stockMovements.orderId))
    .leftJoin(stockPurchases, eq(stockPurchases.id, stockMovements.purchaseId))
    .where(and(eq(stockMovements.tenantId, tenantId), eq(stockMovements.itemId, itemId)))
    .orderBy(desc(stockMovements.occurredOn), desc(stockMovements.createdAt))
    .limit(limit);
}

async function assertNameFree(tx: Tx, tenantId: string, name: string, exceptId?: string) {
  const [other] = await tx
    .select({ id: stockItems.id })
    .from(stockItems)
    .where(and(eq(stockItems.tenantId, tenantId), eq(stockItems.status, true), sql`lower(${stockItems.name}) = lower(${name})`, exceptId ? ne(stockItems.id, exceptId) : undefined));
  if (other) throw new DomainError('Já existe um item com este nome.');
}

const toRow = (input: StockItemInput) => ({
  name: input.name,
  kind: input.kind,
  unit: input.unit,
  minQty: String(input.minQty),
  financeCategoryId: input.financeCategoryId,
  supplier: input.supplier,
  active: input.active,
});

export async function createStockItem(tx: Tx, tenantId: string, input: StockItemInput) {
  await assertNameFree(tx, tenantId, input.name);
  const [row] = await tx.insert(stockItems).values({ tenantId, ...toRow(input) }).returning();
  return row!;
}

export async function updateStockItem(tx: Tx, tenantId: string, id: string, input: StockItemInput) {
  await assertNameFree(tx, tenantId, input.name, id);
  const [row] = await tx.update(stockItems).set(toRow(input)).where(and(eq(stockItems.tenantId, tenantId), eq(stockItems.id, id))).returning();
  return row ?? null;
}

export async function setStockItemStatus(tx: Tx, tenantId: string, id: string, status: boolean) {
  const [row] = await tx.update(stockItems).set({ status }).where(and(eq(stockItems.tenantId, tenantId), eq(stockItems.id, id))).returning();
  if (!row) throw new DomainError('Item não encontrado.');
  return row;
}

/** Cria a lista sugerida (só os itens que a unidade ainda não tem), ligando cada um à categoria do Financeiro. */
export async function createSuggestedStockItems(tx: Tx, tenantId: string) {
  const cats = await tx
    .select({ id: financeCategories.id, name: financeCategories.name })
    .from(financeCategories)
    .where(and(eq(financeCategories.tenantId, tenantId), eq(financeCategories.status, true)));
  const existing = await tx.select({ name: stockItems.name }).from(stockItems).where(and(eq(stockItems.tenantId, tenantId), eq(stockItems.status, true)));
  const have = new Set(existing.map((e) => e.name.toLowerCase()));
  const rows = SUGGESTED_STOCK_ITEMS.filter((s) => !have.has(s.name.toLowerCase())).map((s) => ({
    tenantId,
    name: s.name,
    kind: s.kind,
    unit: s.unit,
    minQty: String(s.minQty),
    financeCategoryId: cats.find((c) => c.name === s.financeCategory)?.id ?? null,
  }));
  if (rows.length) await tx.insert(stockItems).values(rows);
  return rows.length;
}

async function loadActiveItem(tx: Tx, tenantId: string, itemId: string) {
  const [item] = await tx.select().from(stockItems).where(and(eq(stockItems.tenantId, tenantId), eq(stockItems.id, itemId), eq(stockItems.status, true)));
  if (!item) throw new DomainError('Item não encontrado.');
  return item;
}

/** Perda, consumo interno (saídas) ou outra entrada, registrada à mão. */
export async function createStockMovement(tx: Tx, tenantId: string, input: StockMovementInput) {
  await loadActiveItem(tx, tenantId, input.itemId);
  const signed = input.kind === 'ENTRADA' ? input.qty : -input.qty;
  const [row] = await tx
    .insert(stockMovements)
    .values({ tenantId, itemId: input.itemId, kind: input.kind, qty: String(signed), occurredOn: input.occurredOn, notes: input.notes })
    .returning();
  return row!;
}

/** Desfaz uma movimentação manual (exclusão lógica). Compras e pedidos se desfazem pela origem. */
export async function setStockMovementStatus(tx: Tx, tenantId: string, id: string, status: boolean) {
  const [m] = await tx.select().from(stockMovements).where(and(eq(stockMovements.tenantId, tenantId), eq(stockMovements.id, id)));
  if (!m) throw new DomainError('Movimentação não encontrada.');
  if (m.kind === 'COMPRA') throw new DomainError('Esta entrada vem de uma compra: cancele a compra.');
  if (m.kind === 'PEDIDO') throw new DomainError('Esta saída vem de um pedido entregue: ela acompanha o pedido.');
  const [row] = await tx.update(stockMovements).set({ status }).where(eq(stockMovements.id, id)).returning();
  return row!;
}

/**
 * Contagem de estoque: para cada item contado, lança um ajuste com a diferença entre o contado e o saldo
 * do sistema. Itens que conferem não geram movimentação.
 */
export async function applyStockCount(tx: Tx, tenantId: string, input: StockCountInput) {
  let adjusted = 0;
  for (const c of input.counts) {
    const item = await getStockItem(tx, tenantId, c.itemId);
    if (!item || !item.status) throw new DomainError('Item da contagem não encontrado.');
    const diff = roundQty(c.counted - item.balance);
    if (diff === 0) continue;
    await tx.insert(stockMovements).values({
      tenantId,
      itemId: c.itemId,
      kind: 'AJUSTE',
      qty: String(diff),
      occurredOn: input.occurredOn,
      notes: [`Contagem: sistema ${formatQty(item.balance, item.unit)}, contado ${formatQty(c.counted, item.unit)}.`, input.notes].filter(Boolean).join(' '),
    });
    adjusted++;
  }
  return { counted: input.counts.length, adjusted };
}
