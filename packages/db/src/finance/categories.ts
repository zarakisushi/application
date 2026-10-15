import { DomainError, type FinanceCategoryInput, type FinanceDirection } from '@zaraki/core';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { Tx } from '../client';
import { financeCategories } from '../schema';

export type FinanceCategory = typeof financeCategories.$inferSelect;

export function listCategories(tx: Tx, tenantId: string, opts: { direction?: FinanceDirection; onlyActive?: boolean } = {}) {
  return tx
    .select({
      id: financeCategories.id,
      name: financeCategories.name,
      direction: financeCategories.direction,
      dreGroup: financeCategories.dreGroup,
      systemKey: financeCategories.systemKey,
      cmv: financeCategories.cmv,
      active: financeCategories.active,
      uses: sql<number>`(select count(*) from finance_entries e where e.category_id = finance_categories.id and e.status)`.mapWith(Number),
    })
    .from(financeCategories)
    .where(
      and(
        eq(financeCategories.tenantId, tenantId),
        eq(financeCategories.status, true),
        opts.direction ? eq(financeCategories.direction, opts.direction) : undefined,
        opts.onlyActive ? eq(financeCategories.active, true) : undefined,
      ),
    )
    .orderBy(asc(financeCategories.direction), asc(financeCategories.sortOrder), asc(financeCategories.name));
}

async function load(tx: Tx, tenantId: string, id: string) {
  const [row] = await tx
    .select()
    .from(financeCategories)
    .where(and(eq(financeCategories.tenantId, tenantId), eq(financeCategories.id, id), eq(financeCategories.status, true)));
  if (!row) throw new DomainError('Categoria não encontrada.');
  return row;
}

async function assertNameFree(tx: Tx, tenantId: string, input: FinanceCategoryInput, exceptId?: string) {
  const [other] = await tx
    .select({ id: financeCategories.id })
    .from(financeCategories)
    .where(
      and(
        eq(financeCategories.tenantId, tenantId),
        eq(financeCategories.status, true),
        eq(financeCategories.direction, input.direction),
        sql`lower(${financeCategories.name}) = lower(${input.name})`,
        exceptId ? ne(financeCategories.id, exceptId) : undefined,
      ),
    );
  if (other) throw new DomainError('Já existe uma categoria com este nome.');
}

export async function createCategory(tx: Tx, tenantId: string, input: FinanceCategoryInput) {
  await assertNameFree(tx, tenantId, input);
  const [{ next } = { next: 1 }] = await tx
    .select({ next: sql<number>`coalesce(max(${financeCategories.sortOrder}), 0) + 1`.mapWith(Number) })
    .from(financeCategories)
    .where(eq(financeCategories.tenantId, tenantId));
  const [row] = await tx.insert(financeCategories).values({ tenantId, ...input, sortOrder: next }).returning();
  return row!;
}

/** Categorias do sistema (vendas, royalties, ajustes) podem ser renomeadas, mas não mudam de tipo nem saem de uso. */
export async function updateCategory(tx: Tx, tenantId: string, id: string, input: FinanceCategoryInput) {
  const current = await load(tx, tenantId, id);
  await assertNameFree(tx, tenantId, { ...input, direction: current.systemKey ? current.direction : input.direction }, id);
  if (current.systemKey && !input.active) throw new DomainError('Esta categoria é usada pelo sistema e não pode ser desativada.');
  if (!current.systemKey && input.direction !== current.direction) {
    const [used] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from finance_entries where category_id = ${id} and status`).then((r) => r.rows);
    if (used?.n) throw new DomainError('A categoria já tem lançamentos: não dá para trocar entre entrada e saída. Crie outra categoria.');
  }
  const [row] = await tx
    .update(financeCategories)
    .set(current.systemKey ? { name: input.name, dreGroup: input.dreGroup, cmv: input.cmv } : input)
    .where(eq(financeCategories.id, id))
    .returning();
  return row!;
}

export async function setCategoryStatus(tx: Tx, tenantId: string, id: string, status: boolean) {
  const [current] = await tx.select().from(financeCategories).where(and(eq(financeCategories.tenantId, tenantId), eq(financeCategories.id, id)));
  if (!current) throw new DomainError('Categoria não encontrada.');
  if (!status && current.systemKey) throw new DomainError('Esta categoria é usada pelo sistema e não pode ser excluída.');
  const [row] = await tx.update(financeCategories).set({ status }).where(eq(financeCategories.id, id)).returning();
  return row!;
}
