import { DomainError, type StatementInput } from '@zaraki/core';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '../client';
import { query } from '../reports/types';
import { financeAccounts, financeAttachments, financeStatements } from '../schema';
import { accountBalanceAt, reconcileAccount } from './accounts';

async function loadAccount(tx: Tx, tenantId: string, accountId: string) {
  const [account] = await tx
    .select()
    .from(financeAccounts)
    .where(and(eq(financeAccounts.tenantId, tenantId), eq(financeAccounts.id, accountId), eq(financeAccounts.status, true)));
  if (!account) throw new DomainError('Conta não encontrada.');
  return account;
}

/** Guarda um extrato da conta (os arquivos já foram enviados como comprovantes da unidade). */
export async function createStatement(tx: Tx, tenantId: string, accountId: string, input: StatementInput) {
  await loadAccount(tx, tenantId, accountId);
  const files = await tx
    .select({ id: financeAttachments.id })
    .from(financeAttachments)
    .where(and(eq(financeAttachments.tenantId, tenantId), eq(financeAttachments.status, true), inArray(financeAttachments.id, input.attachmentIds)));
  if (files.length !== input.attachmentIds.length) throw new DomainError('Algum arquivo do extrato não foi encontrado. Envie de novo.');
  const [row] = await tx
    .insert(financeStatements)
    .values({ tenantId, accountId, statementDate: input.statementDate, balanceCents: input.balanceCents, attachmentIds: input.attachmentIds, notes: input.notes })
    .returning();
  return row!;
}

export async function setStatementStatus(tx: Tx, tenantId: string, id: string, status: boolean) {
  const [row] = await tx
    .update(financeStatements)
    .set({ status })
    .where(and(eq(financeStatements.tenantId, tenantId), eq(financeStatements.id, id)))
    .returning();
  if (!row) throw new DomainError('Extrato não encontrado.');
  return row;
}

export type StatementFile = { id: string; fileName: string; contentType: string };

/**
 * Extratos da conta (mais recentes primeiro), cada um com o saldo do sistema naquela data e a diferença
 * (extrato − sistema), calculados na hora: corrigir lançamentos antigos atualiza a conferência.
 */
export async function listStatements(tx: Tx, tenantId: string, accountId: string, opts: { includeDeleted?: boolean } = {}) {
  const rows = await tx
    .select()
    .from(financeStatements)
    .where(
      and(
        eq(financeStatements.tenantId, tenantId),
        eq(financeStatements.accountId, accountId),
        opts.includeDeleted ? undefined : eq(financeStatements.status, true),
      ),
    )
    .orderBy(desc(financeStatements.statementDate), desc(financeStatements.createdAt));
  const ids = [...new Set(rows.flatMap((r) => r.attachmentIds))];
  const files = ids.length
    ? await tx
        .select({ id: financeAttachments.id, fileName: financeAttachments.fileName, contentType: financeAttachments.contentType })
        .from(financeAttachments)
        .where(inArray(financeAttachments.id, ids))
    : [];
  const out = [];
  for (const r of rows) {
    const systemCents = await accountBalanceAt(tx, tenantId, accountId, r.statementDate);
    out.push({
      ...r,
      systemCents,
      diffCents: r.balanceCents - systemCents,
      files: r.attachmentIds.map((id) => files.find((f) => f.id === id)).filter(Boolean) as StatementFile[],
    });
  }
  return out;
}

/** Lança o ajuste da diferença de um extrato, na data dele, e registra no extrato. */
export async function adjustFromStatement(tx: Tx, tenantId: string, id: string) {
  const [statement] = await tx
    .select()
    .from(financeStatements)
    .where(and(eq(financeStatements.tenantId, tenantId), eq(financeStatements.id, id), eq(financeStatements.status, true)));
  if (!statement) throw new DomainError('Extrato não encontrado.');
  const r = await reconcileAccount(tx, tenantId, statement.accountId, statement.balanceCents, statement.statementDate);
  if (r.entry) await tx.update(financeStatements).set({ adjustmentEntryId: r.entry.id }).where(eq(financeStatements.id, id));
  return r;
}

/** Por conta: quantos extratos, a data do último e a diferença dele (para os cartões e o semáforo). */
export async function statementSummary(tx: Tx, tenantId: string) {
  const rows = await query<{ account_id: string; name: string; kind: string; n: number; last_date: string | null; last_balance: number | null }>(
    tx,
    sql`select a.id as account_id, a.name, a.kind::text as kind,
               (select count(*)::int from finance_statements s where s.account_id = a.id and s.status) as n,
               (select to_char(s.statement_date, 'YYYY-MM-DD') from finance_statements s where s.account_id = a.id and s.status
                 order by s.statement_date desc, s.created_at desc limit 1) as last_date,
               (select s.balance_cents from finance_statements s where s.account_id = a.id and s.status
                 order by s.statement_date desc, s.created_at desc limit 1)::float8 as last_balance
          from finance_accounts a
         where a.tenant_id = ${tenantId} and a.status and a.active
         order by a.created_at`,
  );
  const out = [];
  for (const r of rows) {
    const lastDiffCents = r.last_date ? Math.round(r.last_balance!) - (await accountBalanceAt(tx, tenantId, r.account_id, r.last_date)) : null;
    out.push({ accountId: r.account_id, accountName: r.name, kind: r.kind, count: r.n, lastDate: r.last_date, lastDiffCents });
  }
  return out;
}
