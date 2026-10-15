import { DomainError, formatCents, type FinanceAccountInput } from '@zaraki/core';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { Tx } from '../client';
import { financeAccounts, financeEntries } from '../schema';
import { systemCategoryId } from './setup';

export type FinanceAccount = typeof financeAccounts.$inferSelect;

/** Saldo de cada conta: saldo inicial + entradas pagas − saídas pagas (lançamentos ativos). */
const balanceSql = sql<number>`(${financeAccounts.openingBalanceCents} + coalesce((
  select sum(case when e.direction = 'ENTRADA' then e.amount_cents else -e.amount_cents end)
    from finance_entries e
   where e.account_id = finance_accounts.id and e.status and e.paid_on is not null
), 0))::bigint`.mapWith(Number);

export function listAccounts(tx: Tx, tenantId: string, opts: { includeDeleted?: boolean } = {}) {
  return tx
    .select({
      id: financeAccounts.id,
      name: financeAccounts.name,
      kind: financeAccounts.kind,
      openingBalanceCents: financeAccounts.openingBalanceCents,
      openingDate: financeAccounts.openingDate,
      receivesMethods: financeAccounts.receivesMethods,
      active: financeAccounts.active,
      status: financeAccounts.status,
      balanceCents: balanceSql,
    })
    .from(financeAccounts)
    .where(and(eq(financeAccounts.tenantId, tenantId), opts.includeDeleted ? undefined : eq(financeAccounts.status, true)))
    .orderBy(asc(financeAccounts.createdAt));
}

export async function getAccount(tx: Tx, tenantId: string, id: string) {
  const [row] = await tx
    .select({ account: financeAccounts, balanceCents: balanceSql })
    .from(financeAccounts)
    .where(and(eq(financeAccounts.tenantId, tenantId), eq(financeAccounts.id, id)));
  return row ? { ...row.account, balanceCents: row.balanceCents } : null;
}

async function assertNameFree(tx: Tx, tenantId: string, name: string, exceptId?: string) {
  const [other] = await tx
    .select({ id: financeAccounts.id })
    .from(financeAccounts)
    .where(
      and(
        eq(financeAccounts.tenantId, tenantId),
        eq(financeAccounts.status, true),
        sql`lower(${financeAccounts.name}) = lower(${name})`,
        exceptId ? ne(financeAccounts.id, exceptId) : undefined,
      ),
    );
  if (other) throw new DomainError('Já existe uma conta com este nome.');
}

/** Cada forma de pagamento cai numa conta só: marcar aqui tira das outras contas. */
async function claimMethods(tx: Tx, tenantId: string, accountId: string, methods: string[]) {
  if (!methods.length) return;
  const others = await tx
    .select({ id: financeAccounts.id, methods: financeAccounts.receivesMethods })
    .from(financeAccounts)
    .where(and(eq(financeAccounts.tenantId, tenantId), eq(financeAccounts.status, true), ne(financeAccounts.id, accountId)));
  for (const o of others) {
    const kept = o.methods.filter((m) => !methods.includes(m));
    if (kept.length !== o.methods.length) await tx.update(financeAccounts).set({ receivesMethods: kept }).where(eq(financeAccounts.id, o.id));
  }
}

async function assertCanRetire(tx: Tx, tenantId: string, id: string) {
  const account = await getAccount(tx, tenantId, id);
  if (!account) throw new DomainError('Conta não encontrada.');
  if (account.balanceCents !== 0) throw new DomainError('A conta ainda tem saldo. Transfira o saldo para outra conta antes.');
  const [other] = await tx
    .select({ id: financeAccounts.id })
    .from(financeAccounts)
    .where(and(eq(financeAccounts.tenantId, tenantId), eq(financeAccounts.status, true), eq(financeAccounts.active, true), ne(financeAccounts.id, id)));
  if (!other) throw new DomainError('A unidade precisa de pelo menos uma conta ativa.');
  return account;
}

export async function createAccount(tx: Tx, tenantId: string, input: FinanceAccountInput) {
  await assertNameFree(tx, tenantId, input.name);
  const [row] = await tx
    .insert(financeAccounts)
    .values({
      tenantId,
      name: input.name,
      kind: input.kind,
      openingBalanceCents: input.openingBalance,
      openingDate: input.openingDate,
      receivesMethods: input.receivesMethods,
      active: input.active,
    })
    .returning();
  await claimMethods(tx, tenantId, row!.id, input.receivesMethods);
  return row!;
}

export async function updateAccount(tx: Tx, tenantId: string, id: string, input: FinanceAccountInput) {
  await assertNameFree(tx, tenantId, input.name, id);
  const current = await getAccount(tx, tenantId, id);
  if (!current) return null;
  if (current.active && !input.active) await assertCanRetire(tx, tenantId, id);
  const [row] = await tx
    .update(financeAccounts)
    .set({
      name: input.name,
      kind: input.kind,
      openingBalanceCents: input.openingBalance,
      openingDate: input.openingDate,
      receivesMethods: input.receivesMethods,
      active: input.active,
    })
    .where(and(eq(financeAccounts.tenantId, tenantId), eq(financeAccounts.id, id)))
    .returning();
  await claimMethods(tx, tenantId, id, input.receivesMethods);
  return row ?? null;
}

/** Excluir (lógico) só conta sem saldo; os lançamentos antigos continuam apontando para ela. */
export async function setAccountStatus(tx: Tx, tenantId: string, id: string, status: boolean) {
  if (!status) await assertCanRetire(tx, tenantId, id);
  const [row] = await tx
    .update(financeAccounts)
    .set(status ? { status } : { status, receivesMethods: [] })
    .where(and(eq(financeAccounts.tenantId, tenantId), eq(financeAccounts.id, id)))
    .returning();
  if (!row) throw new DomainError('Conta não encontrada.');
  return row;
}

/** Quantidade de lançamentos de uma conta (para avisos na tela). */
export async function countAccountEntries(tx: Tx, accountId: string) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(financeEntries)
    .where(and(eq(financeEntries.accountId, accountId), eq(financeEntries.status, true)));
  return row?.n ?? 0;
}

/** Saldo da conta ao fim do dia `date`: saldo inicial (se já existia) + lançamentos pagos até a data. */
export async function accountBalanceAt(tx: Tx, tenantId: string, accountId: string, date: string) {
  const [row] = (
    await tx.execute<{ cents: number }>(sql`
      select (
        coalesce((select opening_balance_cents from finance_accounts
                   where id = ${accountId} and tenant_id = ${tenantId} and opening_date <= ${date}::date), 0)
      + coalesce((select sum(case when direction = 'ENTRADA' then amount_cents else -amount_cents end)
                    from finance_entries
                   where account_id = ${accountId} and tenant_id = ${tenantId} and status
                     and paid_on is not null and paid_on <= ${date}::date), 0)
      )::float8 as cents`)
  ).rows;
  return Math.round(row?.cents ?? 0);
}

/**
 * Conferência de saldo: a pessoa informa o saldo real da conta num dia (extrato ou dinheiro contado) e o
 * sistema lança a diferença como ajuste, pago naquele dia. Sem diferença, nada é gravado.
 */
export async function reconcileAccount(tx: Tx, tenantId: string, accountId: string, realCents: number, date: string) {
  const today = date;
  const account = await getAccount(tx, tenantId, accountId);
  if (!account || !account.status) throw new DomainError('Conta não encontrada.');
  const systemCents = await accountBalanceAt(tx, tenantId, accountId, date);
  const diff = realCents - systemCents;
  if (diff === 0) return { diff, entry: null };
  const direction = diff > 0 ? ('ENTRADA' as const) : ('SAIDA' as const);
  const [entry] = await tx
    .insert(financeEntries)
    .values({
      tenantId,
      direction,
      description: `Ajuste na conferência de saldo · ${account.name}`,
      amountCents: Math.abs(diff),
      categoryId: await systemCategoryId(tx, tenantId, diff > 0 ? 'AJUSTE_ENTRADA' : 'AJUSTE_SAIDA'),
      accountId,
      competenceDate: today,
      dueDate: today,
      paidOn: today,
      origin: 'AJUSTE',
      notes: `Saldo no sistema em ${today.split('-').reverse().join('/')}: ${formatCents(systemCents)}. Saldo conferido: ${formatCents(realCents)}.`,
    })
    .returning();
  return { diff, entry: entry! };
}
