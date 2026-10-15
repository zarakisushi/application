import { DomainError, formatMonthBr, monthRange } from '@zaraki/core';
import { and, desc, eq } from 'drizzle-orm';
import type { Tx } from '../client';
import { financeClosings } from '../schema';

/** Meses fechados da unidade (mais recentes primeiro). */
export function listClosings(tx: Tx, tenantId: string) {
  return tx
    .select({ id: financeClosings.id, month: financeClosings.month, createdAt: financeClosings.createdAt })
    .from(financeClosings)
    .where(and(eq(financeClosings.tenantId, tenantId), eq(financeClosings.status, true)))
    .orderBy(desc(financeClosings.month));
}

/** Fecha um mês já encerrado: a partir daí, lançamentos daquele mês não mudam (o banco garante). */
export async function closeMonth(tx: Tx, tenantId: string, month: string, today: string) {
  const first = monthRange(month).from;
  if (first >= monthRange(today).from) throw new DomainError('Só é possível fechar meses que já terminaram.');
  const [existing] = await tx
    .select({ id: financeClosings.id })
    .from(financeClosings)
    .where(and(eq(financeClosings.tenantId, tenantId), eq(financeClosings.month, first), eq(financeClosings.status, true)));
  if (existing) throw new DomainError(`O mês ${formatMonthBr(first)} já está fechado.`);
  const [row] = await tx.insert(financeClosings).values({ tenantId, month: first }).returning();
  return row!;
}

/** Reabre o mês (fica registrado na auditoria quem reabriu e quando). */
export async function reopenMonth(tx: Tx, tenantId: string, month: string) {
  const first = monthRange(month).from;
  const rows = await tx
    .update(financeClosings)
    .set({ status: false })
    .where(and(eq(financeClosings.tenantId, tenantId), eq(financeClosings.month, first), eq(financeClosings.status, true)))
    .returning();
  if (!rows.length) throw new DomainError(`O mês ${formatMonthBr(first)} não está fechado.`);
  return rows[0]!;
}

/** Mensagem do banco quando algo tenta mudar um mês fechado (código ZF001), ou null. */
export function closedMonthMessage(error: unknown): string | null {
  const cause = (error as { cause?: { code?: string; message?: string }; code?: string; message?: string }) ?? {};
  if (cause.cause?.code === 'ZF001') return cause.cause.message ?? null;
  if (cause.code === 'ZF001') return cause.message ?? null;
  return null;
}
