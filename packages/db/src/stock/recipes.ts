import { DomainError, recipeCostCents, roundQty, type RecipeInput } from '@zaraki/core';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Tx } from '../client';
import { orderItems, orders, productRecipes, products, stockItems, stockMovements, tenants } from '../schema';
import { avgCostSql } from './items';

/** Ficha técnica do sabor com o custo de cada item (custo médio das compras) e o custo total por tubo. */
export async function getRecipe(tx: Tx, tenantId: string, productId: string) {
  const lines = await tx
    .select({
      itemId: productRecipes.itemId,
      name: stockItems.name,
      unit: stockItems.unit,
      qty: sql<number>`${productRecipes.qty}::float8`.mapWith(Number),
      unitCostCents: sql<number | null>`${avgCostSql}`.mapWith((v) => (v === null ? null : Number(v))),
    })
    .from(productRecipes)
    .innerJoin(stockItems, eq(stockItems.id, productRecipes.itemId))
    .where(and(eq(productRecipes.tenantId, tenantId), eq(productRecipes.productId, productId), eq(productRecipes.status, true)))
    .orderBy(asc(stockItems.kind), asc(stockItems.name));
  const cost = recipeCostCents(lines);
  return { lines, costCents: cost.cents, missingCosts: cost.missing };
}

/** Grava a ficha técnica (substitui a anterior; as linhas antigas ficam no histórico). */
export async function saveRecipe(tx: Tx, tenantId: string, productId: string, input: RecipeInput) {
  const [product] = await tx.select({ id: products.id }).from(products).where(and(eq(products.tenantId, tenantId), eq(products.id, productId), eq(products.status, true)));
  if (!product) throw new DomainError('Sabor não encontrado.');
  const current = await tx
    .select({ id: productRecipes.id, itemId: productRecipes.itemId, qty: sql<number>`${productRecipes.qty}::float8`.mapWith(Number) })
    .from(productRecipes)
    .where(and(eq(productRecipes.productId, productId), eq(productRecipes.status, true)));
  const wanted = new Map(input.lines.map((l) => [l.itemId, l.qty]));
  for (const c of current) {
    const q = wanted.get(c.itemId);
    if (q === undefined) await tx.update(productRecipes).set({ status: false }).where(eq(productRecipes.id, c.id));
    else if (roundQty(q) !== roundQty(c.qty)) await tx.update(productRecipes).set({ qty: String(q) }).where(eq(productRecipes.id, c.id));
    wanted.delete(c.itemId);
  }
  if (wanted.size) {
    await tx.insert(productRecipes).values([...wanted].map(([itemId, qty]) => ({ tenantId, productId, itemId, qty: String(qty) })));
  }
  return getRecipe(tx, tenantId, productId);
}

/** "Usar como custo do sabor": grava o custo calculado pela ficha no cadastro do sabor (base do CMV teórico). */
export async function applyRecipeCost(tx: Tx, tenantId: string, productId: string) {
  const recipe = await getRecipe(tx, tenantId, productId);
  if (!recipe.lines.length) throw new DomainError('Monte a ficha técnica antes.');
  if (recipe.missingCosts) throw new DomainError('Algum item da ficha ainda não tem custo: registre uma compra dele antes.');
  const [row] = await tx.update(products).set({ costCents: recipe.costCents }).where(and(eq(products.tenantId, tenantId), eq(products.id, productId))).returning();
  return row!;
}

/**
 * Baixa automática pela ficha técnica: pedido ativo e entregue → saídas de estoque (tubos × ficha de cada
 * sabor); fora disso (voltou de etapa, cancelado, excluído) → as saídas são estornadas. Roda na mesma
 * transação que altera o pedido. Sabores sem ficha não baixam nada.
 */
export async function syncOrderStock(tx: Tx, orderId: string) {
  const [order] = await tx
    .select({
      id: orders.id,
      tenantId: orders.tenantId,
      status: orders.status,
      stage: orders.stage,
      day: sql<string>`to_char((coalesce(${orders.scheduledAt}, ${orders.createdAt}) at time zone ${tenants.timezone})::date, 'YYYY-MM-DD')`,
    })
    .from(orders)
    .innerJoin(tenants, eq(tenants.id, orders.tenantId))
    .where(eq(orders.id, orderId));
  if (!order) return;

  const wanted = new Map<string, number>();
  if (order.status && order.stage === 'ENTREGUE') {
    const rows = await tx
      .select({ itemId: productRecipes.itemId, qty: sql<number>`sum(${orderItems.qty} * ${productRecipes.qty})::float8`.mapWith(Number) })
      .from(orderItems)
      .innerJoin(productRecipes, and(eq(productRecipes.productId, orderItems.productId), eq(productRecipes.status, true)))
      .where(and(eq(orderItems.orderId, orderId), eq(orderItems.status, true)))
      .groupBy(productRecipes.itemId);
    for (const r of rows) if (roundQty(r.qty) > 0) wanted.set(r.itemId, roundQty(r.qty));
  }

  const existing = await tx
    .select({ id: stockMovements.id, itemId: stockMovements.itemId, qty: sql<number>`${stockMovements.qty}::float8`.mapWith(Number) })
    .from(stockMovements)
    .where(and(eq(stockMovements.orderId, orderId), eq(stockMovements.status, true)));
  const same = existing.length === wanted.size && existing.every((e) => wanted.get(e.itemId) === roundQty(-e.qty));
  if (same) return;

  if (existing.length) await tx.update(stockMovements).set({ status: false }).where(and(eq(stockMovements.orderId, orderId), eq(stockMovements.status, true)));
  if (wanted.size) {
    await tx.insert(stockMovements).values(
      [...wanted].map(([itemId, qty]) => ({ tenantId: order.tenantId, itemId, kind: 'PEDIDO' as const, qty: String(-qty), occurredOn: order.day, orderId })),
    );
  }
}

/** Baixa de pedidos já entregues que ainda não tinham saída de estoque (ex.: depois de montar as fichas). */
export async function backfillOrderStock(tx: Tx, tenantId: string) {
  const pending = await tx.execute<{ id: string }>(sql`
    select o.id from orders o
     where o.tenant_id = ${tenantId} and o.status and o.stage = 'ENTREGUE'
       and not exists (select 1 from stock_movements m where m.order_id = o.id and m.status)`);
  for (const o of pending.rows) await syncOrderStock(tx, o.id);
  return pending.rows.length;
}
