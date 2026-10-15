import { addDays, addMonths, DomainError, formatMonthBr, monthRange } from '@zaraki/core';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '../client';
import { query } from '../reports/types';
import { financeEntries, royaltyCharges, tenants } from '../schema';
import { systemCategoryId } from './setup';

/** Faturamento realizado (pedidos entregues) da unidade no mês, pela data do pedido no fuso dela. */
async function monthRevenue(tx: Tx, tenantId: string, month: string) {
  const { from, to } = monthRange(month);
  const [row] = await query<{ cents: number }>(
    tx,
    sql`select coalesce(sum(o.total_cents), 0)::float8 as cents
          from orders o join tenants t on t.id = o.tenant_id
         where o.tenant_id = ${tenantId} and o.status and o.stage = 'ENTREGUE'
           and (coalesce(o.scheduled_at, o.created_at) at time zone t.timezone)::date between ${from}::date and ${to}::date`,
  );
  return Math.round(row?.cents ?? 0);
}

const dueDateFor = (month: string, day: number) => addDays(addMonths(month, 1), Math.min(28, Math.max(1, day)) - 1);

export type RoyaltyRun = { created: string[]; skipped: string[]; failed: { tenant: string; error: string }[] };

/**
 * Gera as cobranças de royalties de um mês ("AAAA-MM-01") para todas as franquias ativas com percentual:
 * uma saída "Royalties à Matriz" na franquia e uma entrada a receber na Matriz. Idempotente: franquia que já
 * tem cobrança no mês é pulada. Precisa de contexto de plataforma (escreve em várias unidades).
 */
export async function generateRoyalties(tx: Tx, month: string): Promise<RoyaltyRun> {
  const first = monthRange(month).from;
  const [matriz] = await tx.select().from(tenants).where(and(eq(tenants.kind, 'MATRIZ'), eq(tenants.status, true)));
  if (!matriz) throw new DomainError('Matriz não encontrada.');
  const franchises = await tx
    .select()
    .from(tenants)
    .where(and(eq(tenants.kind, 'FRANQUIA'), eq(tenants.status, true), sql`${tenants.royaltyPct} > 0`));

  const result: RoyaltyRun = { created: [], skipped: [], failed: [] };
  for (const f of franchises) {
    const [existing] = await tx
      .select({ id: royaltyCharges.id })
      .from(royaltyCharges)
      .where(and(eq(royaltyCharges.tenantId, f.id), eq(royaltyCharges.month, first), eq(royaltyCharges.status, true)));
    if (existing) {
      result.skipped.push(f.name);
      continue;
    }
    try {
      // Cada franquia num savepoint: um problema numa (ex.: mês fechado) não impede as outras.
      await tx.transaction(async (sp) => {
        const revenue = await monthRevenue(sp, f.id, first);
        const amount = Math.round((revenue * Number(f.royaltyPct)) / 100);
        const dueDate = dueDateFor(first, f.royaltyDueDay);
        const [charge] = await sp
          .insert(royaltyCharges)
          .values({ tenantId: f.id, matrizTenantId: matriz.id, month: first, revenueCents: revenue, royaltyPct: f.royaltyPct, amountCents: amount, dueDate })
          .returning();
        if (amount > 0) await createChargeEntries(sp, charge!, f.name);
      });
      result.created.push(f.name);
    } catch (error) {
      const message = (error as { cause?: { message?: string } }).cause?.message ?? (error as Error).message;
      result.failed.push({ tenant: f.name, error: message });
    }
  }
  return result;
}

async function createChargeEntries(tx: Tx, charge: typeof royaltyCharges.$inferSelect, franchiseName: string) {
  const label = formatMonthBr(charge.month);
  const competence = monthRange(charge.month).to;
  const common = {
    amountCents: charge.amountCents,
    competenceDate: competence,
    dueDate: charge.dueDate,
    origin: 'ROYALTIES' as const,
    royaltyChargeId: charge.id,
    notes: `${Number(charge.royaltyPct).toLocaleString('pt-BR')}% sobre ${(charge.revenueCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} de faturamento`,
  };
  const [out] = await tx
    .insert(financeEntries)
    .values({
      ...common,
      tenantId: charge.tenantId,
      direction: 'SAIDA',
      description: `Royalties à Matriz · ${label}`,
      categoryId: await systemCategoryId(tx, charge.tenantId, 'ROYALTIES_PAGOS'),
      counterparty: 'Zaraki Sushi — Matriz',
    })
    .returning({ id: financeEntries.id });
  const [inn] = await tx
    .insert(financeEntries)
    .values({
      ...common,
      tenantId: charge.matrizTenantId,
      direction: 'ENTRADA',
      description: `Royalties · ${franchiseName} · ${label}`,
      categoryId: await systemCategoryId(tx, charge.matrizTenantId, 'ROYALTIES_RECEBIDOS'),
      counterparty: franchiseName,
    })
    .returning({ id: financeEntries.id });
  await tx.update(royaltyCharges).set({ franchiseEntryId: out!.id, matrizEntryId: inn!.id }).where(eq(royaltyCharges.id, charge.id));
}

/** Recalcula uma cobrança (ex.: pedidos do mês corrigidos depois) enquanto nenhum dos lados foi pago. */
export async function recalculateRoyalty(tx: Tx, chargeId: string) {
  const [charge] = await tx.select().from(royaltyCharges).where(and(eq(royaltyCharges.id, chargeId), eq(royaltyCharges.status, true)));
  if (!charge) throw new DomainError('Cobrança não encontrada.');
  const ids = [charge.franchiseEntryId, charge.matrizEntryId].filter(Boolean) as string[];
  const entries = ids.length ? await tx.select().from(financeEntries).where(inArray(financeEntries.id, ids)) : [];
  if (entries.some((e) => e.paidOn)) throw new DomainError('Esta cobrança já foi paga ou recebida: não dá para recalcular.');

  const [franchise] = await tx.select().from(tenants).where(eq(tenants.id, charge.tenantId));
  const revenue = await monthRevenue(tx, charge.tenantId, charge.month);
  const amount = Math.round((revenue * Number(franchise!.royaltyPct)) / 100);
  if (revenue === charge.revenueCents && amount === charge.amountCents && franchise!.royaltyPct === charge.royaltyPct) return { charge, changed: false };

  if (entries.length) await tx.update(financeEntries).set({ status: false }).where(inArray(financeEntries.id, ids));
  const [updated] = await tx
    .update(royaltyCharges)
    .set({ revenueCents: revenue, royaltyPct: franchise!.royaltyPct, amountCents: amount, franchiseEntryId: null, matrizEntryId: null })
    .where(eq(royaltyCharges.id, chargeId))
    .returning();
  if (amount > 0) await createChargeEntries(tx, updated!, franchise!.name);
  return { charge: updated!, changed: true };
}

/**
 * Cobranças visíveis no contexto (franquia: as próprias; Matriz/plataforma: todas), com a situação de
 * pagamento de cada lado.
 */
export function listRoyaltyCharges(tx: Tx, opts: { tenantId?: string; limit?: number } = {}) {
  return query<{
    id: string;
    tenant_id: string;
    unidade: string;
    month: string;
    revenue_cents: number;
    royalty_pct: string;
    amount_cents: number;
    due_date: string;
    franchise_paid_on: string | null;
    matriz_paid_on: string | null;
  }>(
    tx,
    sql`select c.id, c.tenant_id, t.name as unidade, to_char(c.month, 'YYYY-MM-DD') as month, c.revenue_cents, c.royalty_pct::text,
               c.amount_cents, to_char(c.due_date, 'YYYY-MM-DD') as due_date,
               to_char(fe.paid_on, 'YYYY-MM-DD') as franchise_paid_on, to_char(me.paid_on, 'YYYY-MM-DD') as matriz_paid_on
          from royalty_charges c
          join tenants t on t.id = c.tenant_id
          left join finance_entries fe on fe.id = c.franchise_entry_id
          left join finance_entries me on me.id = c.matriz_entry_id
         where c.status ${opts.tenantId ? sql`and c.tenant_id = ${opts.tenantId}` : sql``}
         order by c.month desc, t.name
         limit ${opts.limit ?? 120}`,
  );
}

export const latestRoyaltyMonth = async (tx: Tx) => {
  const [row] = await tx.select({ month: royaltyCharges.month }).from(royaltyCharges).where(eq(royaltyCharges.status, true)).orderBy(desc(royaltyCharges.month)).limit(1);
  return row?.month ?? null;
};
