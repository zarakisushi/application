import { DomainError, formatQty, type StockKind, type StockPurchaseInput } from '@zaraki/core';
import { and, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import type { Tx } from '../client';
import { contains, paging, statusWhere, toPage, type ListParams } from '../admin/common';
import { financeCategories, financeEntries, stockItems, stockMovements, stockPurchases } from '../schema';

/** Categoria do Financeiro usada quando o item não tem uma definida. */
const FALLBACK_CATEGORY: Record<StockKind, string> = {
  INSUMO: 'Insumos: arroz, nori e mercearia',
  EMBALAGEM: 'Embalagens',
  MARKETING: 'Marketing',
  OPERACIONAL: 'Manutenção e limpeza',
  OUTRO: 'Manutenção e limpeza',
};

/**
 * Registra uma compra: entrada no estoque de cada item (com o valor, base do custo médio) e a conta a pagar
 * no Financeiro — um lançamento por categoria dos itens, para a DRE e o CMV ficarem certos.
 */
export async function createStockPurchase(tx: Tx, tenantId: string, input: StockPurchaseInput) {
  const items = await tx
    .select()
    .from(stockItems)
    .where(and(eq(stockItems.tenantId, tenantId), eq(stockItems.status, true), inArray(stockItems.id, input.lines.map((l) => l.itemId))));
  if (items.length !== input.lines.length) throw new DomainError('Algum item da compra não foi encontrado.');
  const cats = await tx
    .select({ id: financeCategories.id, name: financeCategories.name })
    .from(financeCategories)
    .where(and(eq(financeCategories.tenantId, tenantId), eq(financeCategories.status, true), eq(financeCategories.direction, 'SAIDA')));

  const itemOf = (id: string) => items.find((i) => i.id === id)!;
  const categoryOf = (itemId: string) => {
    const item = itemOf(itemId);
    const id = item.financeCategoryId ?? cats.find((c) => c.name === FALLBACK_CATEGORY[item.kind])?.id;
    if (!id) throw new DomainError(`Defina a categoria do Financeiro do item "${item.name}".`);
    return id;
  };
  const totalCents = input.lines.reduce((s, l) => s + l.totalCents, 0);

  const [purchase] = await tx
    .insert(stockPurchases)
    .values({ tenantId, supplier: input.supplier, purchasedOn: input.purchasedOn, dueDate: input.dueDate, totalCents, attachmentId: input.attachmentId, notes: input.notes })
    .returning();
  await tx.insert(stockMovements).values(
    input.lines.map((l) => ({
      tenantId,
      itemId: l.itemId,
      kind: 'COMPRA' as const,
      qty: String(l.qty),
      totalCents: l.totalCents,
      occurredOn: input.purchasedOn,
      purchaseId: purchase!.id,
    })),
  );

  // Um lançamento por categoria (ex.: peixe em "Insumos", tubos em "Embalagens").
  const groups = new Map<string, typeof input.lines>();
  for (const l of input.lines) groups.set(categoryOf(l.itemId), [...(groups.get(categoryOf(l.itemId)) ?? []), l]);
  const entryIds: string[] = [];
  for (const [categoryId, lines] of groups) {
    const [entry] = await tx
      .insert(financeEntries)
      .values({
        tenantId,
        direction: 'SAIDA',
        description: `Compra · ${input.supplier}`,
        amountCents: lines.reduce((s, l) => s + l.totalCents, 0),
        categoryId,
        accountId: input.accountId,
        competenceDate: input.purchasedOn,
        dueDate: input.dueDate,
        paidOn: input.paidOn,
        paymentMethod: input.paymentMethod,
        counterparty: input.supplier,
        attachmentId: input.attachmentId,
        origin: 'ESTOQUE',
        notes: `Itens: ${lines.map((l) => `${itemOf(l.itemId).name} ${formatQty(l.qty, itemOf(l.itemId).unit)}`).join(', ')}.`,
      })
      .returning({ id: financeEntries.id });
    entryIds.push(entry!.id);
  }
  const [saved] = await tx.update(stockPurchases).set({ financeEntryIds: entryIds }).where(eq(stockPurchases.id, purchase!.id)).returning();
  return saved!;
}

/** Cancela a compra: as entradas saem do estoque e as contas do Financeiro são estornadas (tudo fica no histórico). */
export async function cancelStockPurchase(tx: Tx, tenantId: string, id: string) {
  const [purchase] = await tx.select().from(stockPurchases).where(and(eq(stockPurchases.tenantId, tenantId), eq(stockPurchases.id, id)));
  if (!purchase) throw new DomainError('Compra não encontrada.');
  if (!purchase.status) return purchase;
  await tx.update(stockMovements).set({ status: false }).where(and(eq(stockMovements.purchaseId, id), eq(stockMovements.status, true)));
  if (purchase.financeEntryIds.length) {
    await tx.update(financeEntries).set({ status: false }).where(inArray(financeEntries.id, purchase.financeEntryIds));
  }
  const [row] = await tx.update(stockPurchases).set({ status: false }).where(eq(stockPurchases.id, id)).returning();
  return row!;
}

export async function listStockPurchases(tx: Tx, tenantId: string, params: ListParams = {}) {
  const { page, pageSize, offset } = paging(params);
  const where = and(
    eq(stockPurchases.tenantId, tenantId),
    statusWhere(stockPurchases.status, params.status),
    params.q ? ilike(stockPurchases.supplier, contains(params.q)) : undefined,
  );
  const rows = await tx
    .select({
      id: stockPurchases.id,
      supplier: stockPurchases.supplier,
      purchasedOn: stockPurchases.purchasedOn,
      dueDate: stockPurchases.dueDate,
      totalCents: stockPurchases.totalCents,
      status: stockPurchases.status,
      items: sql<number>`(select count(*) from stock_movements m where m.purchase_id = stock_purchases.id)`.mapWith(Number),
      paid: sql<boolean>`coalesce((select bool_and(e.paid_on is not null) from finance_entries e where e.id = any(stock_purchases.finance_entry_ids)), false)`,
    })
    .from(stockPurchases)
    .where(where)
    .orderBy(desc(stockPurchases.purchasedOn), desc(stockPurchases.createdAt))
    .limit(pageSize)
    .offset(offset);
  const [total] = await tx.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(stockPurchases).where(where);
  return toPage(rows, total?.n ?? 0, page, pageSize);
}

export async function getStockPurchase(tx: Tx, tenantId: string, id: string) {
  const [purchase] = await tx.select().from(stockPurchases).where(and(eq(stockPurchases.tenantId, tenantId), eq(stockPurchases.id, id)));
  if (!purchase) return null;
  const lines = await tx
    .select({
      itemId: stockMovements.itemId,
      name: stockItems.name,
      unit: stockItems.unit,
      qty: sql<number>`${stockMovements.qty}::float8`.mapWith(Number),
      totalCents: stockMovements.totalCents,
    })
    .from(stockMovements)
    .innerJoin(stockItems, eq(stockItems.id, stockMovements.itemId))
    .where(eq(stockMovements.purchaseId, id));
  const entries = purchase.financeEntryIds.length
    ? await tx
        .select({ id: financeEntries.id, amountCents: financeEntries.amountCents, paidOn: financeEntries.paidOn, dueDate: financeEntries.dueDate, categoryName: financeCategories.name, status: financeEntries.status })
        .from(financeEntries)
        .leftJoin(financeCategories, eq(financeCategories.id, financeEntries.categoryId))
        .where(inArray(financeEntries.id, purchase.financeEntryIds))
    : [];
  return { ...purchase, lines, entries };
}

/** Fornecedores já usados nas compras e itens (sugestões do formulário). */
export async function listStockSuppliers(tx: Tx, tenantId: string) {
  const rows = await tx.execute<{ name: string }>(sql`
    select name from (
      select supplier as name, max(created_at) as last from stock_purchases where tenant_id = ${tenantId} and status group by supplier
      union all
      select supplier as name, max(created_at) from stock_items where tenant_id = ${tenantId} and status and supplier is not null group by supplier
    ) s group by name order by max(last) desc limit 100`);
  return rows.rows.map((r) => r.name);
}
