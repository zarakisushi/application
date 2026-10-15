import { DEFAULT_FINANCE_ACCOUNTS, DEFAULT_FINANCE_CATEGORIES, DomainError, todayInZone, type FinanceSystemKey } from '@zaraki/core';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import type { Tx } from '../client';
import { financeAccounts, financeCategories, tenants } from '../schema';

/**
 * Contas e categorias iniciais de uma unidade. Idempotente: só cria o que a unidade ainda não tem
 * (uma unidade que já ajustou o seu plano de contas não é alterada).
 */
export async function ensureFinanceDefaults(tx: Tx, tenantId: string) {
  const [tenant] = await tx.select({ kind: tenants.kind, timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) throw new DomainError('Unidade não encontrada.');

  const [cats] = await tx.select({ n: count() }).from(financeCategories).where(eq(financeCategories.tenantId, tenantId));
  if (!cats?.n) {
    await tx.insert(financeCategories).values(
      DEFAULT_FINANCE_CATEGORIES.filter((c) => !c.only || c.only === tenant.kind).map((c, i) => ({
        tenantId,
        name: c.name,
        direction: c.direction,
        dreGroup: c.dreGroup,
        systemKey: c.systemKey ?? null,
        cmv: c.cmv ?? false,
        sortOrder: i + 1,
      })),
    );
  }

  const [accs] = await tx.select({ n: count() }).from(financeAccounts).where(eq(financeAccounts.tenantId, tenantId));
  if (!accs?.n) {
    const today = todayInZone(tenant.timezone);
    await tx.insert(financeAccounts).values(DEFAULT_FINANCE_ACCOUNTS.map((a) => ({ tenantId, ...a, openingDate: today })));
  }
}

/** Id da categoria de sistema (vendas, royalties, ajustes); recria a partir do padrão se faltar. */
export async function systemCategoryId(tx: Tx, tenantId: string, key: FinanceSystemKey): Promise<string> {
  const where = and(eq(financeCategories.tenantId, tenantId), eq(financeCategories.systemKey, key), eq(financeCategories.status, true));
  const [found] = await tx.select({ id: financeCategories.id }).from(financeCategories).where(where);
  if (found) return found.id;
  const def = DEFAULT_FINANCE_CATEGORIES.find((c) => c.systemKey === key)!;
  const [created] = await tx
    .insert(financeCategories)
    .values({ tenantId, name: def.name, direction: def.direction, dreGroup: def.dreGroup, systemKey: key, sortOrder: 0 })
    .returning({ id: financeCategories.id });
  return created!.id;
}

/**
 * Conta que recebe uma forma de pagamento. Sem forma informada (ou sem conta marcada para ela), usa a
 * conta que recebe "Outro" e, por fim, a primeira conta ativa.
 */
export async function accountForMethod(tx: Tx, tenantId: string, method: string | null, retry = true): Promise<string> {
  const rows = await tx
    .select({ id: financeAccounts.id, methods: financeAccounts.receivesMethods })
    .from(financeAccounts)
    .where(and(eq(financeAccounts.tenantId, tenantId), eq(financeAccounts.status, true), eq(financeAccounts.active, true)))
    .orderBy(asc(financeAccounts.createdAt));
  const pick = rows.find((r) => method && r.methods.includes(method as never)) ?? rows.find((r) => r.methods.includes('OUTRO')) ?? rows[0];
  // Unidade que nunca teve o financeiro preparado: cria as contas padrão e tenta de novo.
  if (!pick && retry) {
    const [any] = await tx.select({ n: count() }).from(financeAccounts).where(eq(financeAccounts.tenantId, tenantId));
    if (!any?.n) {
      await ensureFinanceDefaults(tx, tenantId);
      return accountForMethod(tx, tenantId, method, false);
    }
  }
  if (!pick) throw new DomainError('Cadastre uma conta ativa no Financeiro (Contas e categorias) para registrar pagamentos.');
  return pick.id;
}

/** Prepara o financeiro de todas as unidades ativas (rodado depois das migrations). */
export async function ensureFinanceDefaultsForAll(tx: Tx) {
  const rows = await tx.select({ id: tenants.id }).from(tenants).where(sql`${tenants.status}`);
  for (const t of rows) await ensureFinanceDefaults(tx, t.id);
}
