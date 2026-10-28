import {
  buildSeries,
  DomainError,
  type FinanceDirection,
  type FinanceEntryInput,
  type FinanceOrigin,
  type PayEntryInput,
  type SeriesScope,
  type TransferInput,
} from '@zaraki/core';
import { and, asc, desc, eq, gt, gte, ilike, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Tx } from '../client';
import { financeAccounts, financeCategories, financeEntries, orders } from '../schema';
import { contains, paging, statusWhere, toPage, type ListParams } from '../admin/common';

export type FinanceEntry = typeof financeEntries.$inferSelect;

/** Situação na lista: pagos/recebidos, em aberto (inclui vencidos) ou só vencidos. */
export type EntrySituationFilter = 'todos' | 'pagos' | 'abertos' | 'vencidos';

export type EntryListParams = ListParams & {
  /** Período pela data do movimento: pagamento (se pago) ou vencimento (se em aberto). */
  from?: string;
  to?: string;
  direction?: FinanceDirection;
  categoryId?: string;
  accountId?: string;
  situation?: EntrySituationFilter;
  origin?: FinanceOrigin;
  today: string;
};

/** Data que posiciona o lançamento no tempo: quando foi pago ou, se em aberto, quando vence. */
const movementDate = sql`coalesce(${financeEntries.paidOn}, ${financeEntries.dueDate})`;

function entryWhere(tenantId: string, p: EntryListParams): SQL | undefined {
  return and(
    eq(financeEntries.tenantId, tenantId),
    statusWhere(financeEntries.status, p.status),
    p.from ? gte(movementDate, p.from) : undefined,
    p.to ? lte(movementDate, p.to) : undefined,
    p.direction ? eq(financeEntries.direction, p.direction) : undefined,
    p.categoryId ? eq(financeEntries.categoryId, p.categoryId) : undefined,
    p.accountId ? eq(financeEntries.accountId, p.accountId) : undefined,
    p.origin ? eq(financeEntries.origin, p.origin) : undefined,
    p.situation === 'pagos' ? sql`${financeEntries.paidOn} is not null` : undefined,
    p.situation === 'abertos' ? isNull(financeEntries.paidOn) : undefined,
    p.situation === 'vencidos' ? and(isNull(financeEntries.paidOn), sql`${financeEntries.dueDate} < ${p.today}::date`) : undefined,
    p.q
      ? or(
          ilike(financeEntries.description, contains(p.q)),
          ilike(financeEntries.counterparty, contains(p.q)),
          ilike(financeEntries.notes, contains(p.q)),
        )
      : undefined,
  );
}

const entryColumns = {
  id: financeEntries.id,
  direction: financeEntries.direction,
  description: financeEntries.description,
  amountCents: financeEntries.amountCents,
  competenceDate: financeEntries.competenceDate,
  dueDate: financeEntries.dueDate,
  paidOn: financeEntries.paidOn,
  paymentMethod: financeEntries.paymentMethod,
  counterparty: financeEntries.counterparty,
  origin: financeEntries.origin,
  orderId: financeEntries.orderId,
  installment: financeEntries.installment,
  installments: financeEntries.installments,
  attachmentId: financeEntries.attachmentId,
  status: financeEntries.status,
  categoryName: financeCategories.name,
  accountName: financeAccounts.name,
  orderCode: orders.code,
  orderType: orders.type,
  accountId: financeEntries.accountId,
};

export async function listEntries(tx: Tx, tenantId: string, params: EntryListParams) {
  const { page, pageSize, offset } = paging({ ...params, pageSize: params.pageSize ?? 30 });
  const where = entryWhere(tenantId, params);
  const rows = await tx
    .select(entryColumns)
    .from(financeEntries)
    .leftJoin(financeCategories, eq(financeCategories.id, financeEntries.categoryId))
    .leftJoin(financeAccounts, eq(financeAccounts.id, financeEntries.accountId))
    .leftJoin(orders, eq(orders.id, financeEntries.orderId))
    .where(where)
    // Data do movimento crescente (mais antigo primeiro); no mesmo dia, na ordem em que foram lançados.
    // Mais recentes primeiro (data do pagamento ou, em aberto, do vencimento); no mesmo dia, o último lançado em cima.
    .orderBy(desc(movementDate), desc(financeEntries.createdAt))
    .limit(pageSize)
    .offset(offset);

  // Totais de todo o filtro (não só da página). Transferências não são entrada nem saída da empresa.
  const [totals] = await tx
    .select({
      n: sql<number>`count(*)`.mapWith(Number),
      income: sql<number>`coalesce(sum(${financeEntries.amountCents}) filter (where ${financeEntries.direction} = 'ENTRADA' and ${financeEntries.origin} <> 'TRANSFERENCIA'), 0)`.mapWith(Number),
      expense: sql<number>`coalesce(sum(${financeEntries.amountCents}) filter (where ${financeEntries.direction} = 'SAIDA' and ${financeEntries.origin} <> 'TRANSFERENCIA'), 0)`.mapWith(Number),
    })
    .from(financeEntries)
    .where(where);
  return { ...toPage(rows, totals?.n ?? 0, page, pageSize), incomeCents: totals?.income ?? 0, expenseCents: totals?.expense ?? 0 };
}

export async function getEntry(tx: Tx, tenantId: string, id: string) {
  const [row] = await tx
    .select({ entry: financeEntries, categoryName: financeCategories.name, accountName: financeAccounts.name, orderCode: orders.code, orderType: orders.type })
    .from(financeEntries)
    .leftJoin(financeCategories, eq(financeCategories.id, financeEntries.categoryId))
    .leftJoin(financeAccounts, eq(financeAccounts.id, financeEntries.accountId))
    .leftJoin(orders, eq(orders.id, financeEntries.orderId))
    .where(and(eq(financeEntries.tenantId, tenantId), eq(financeEntries.id, id)));
  return row ? { ...row.entry, categoryName: row.categoryName, accountName: row.accountName, orderCode: row.orderCode, orderType: row.orderType } : null;
}

/** Outras parcelas/meses da mesma série. */
export function listSeries(tx: Tx, tenantId: string, seriesId: string) {
  return tx
    .select({ id: financeEntries.id, installment: financeEntries.installment, dueDate: financeEntries.dueDate, paidOn: financeEntries.paidOn, amountCents: financeEntries.amountCents, status: financeEntries.status })
    .from(financeEntries)
    .where(and(eq(financeEntries.tenantId, tenantId), eq(financeEntries.seriesId, seriesId)))
    .orderBy(asc(financeEntries.installment));
}

async function assertCategory(tx: Tx, tenantId: string, id: string, direction: FinanceDirection) {
  const [c] = await tx
    .select({ direction: financeCategories.direction, active: financeCategories.active })
    .from(financeCategories)
    .where(and(eq(financeCategories.tenantId, tenantId), eq(financeCategories.id, id), eq(financeCategories.status, true)));
  if (!c) throw new DomainError('Categoria não encontrada.');
  if (c.direction !== direction) throw new DomainError(direction === 'ENTRADA' ? 'Escolha uma categoria de entrada.' : 'Escolha uma categoria de saída.');
}

async function assertAccount(tx: Tx, tenantId: string, id: string | null, opts: { mustBeActive: boolean }) {
  if (!id) return;
  const [a] = await tx
    .select({ active: financeAccounts.active })
    .from(financeAccounts)
    .where(and(eq(financeAccounts.tenantId, tenantId), eq(financeAccounts.id, id), eq(financeAccounts.status, true)));
  if (!a) throw new DomainError('Conta não encontrada.');
  if (opts.mustBeActive && !a.active) throw new DomainError('Esta conta está desativada.');
}

/** Cria o lançamento (ou a série de lançamentos). Com "já pago", só o primeiro sai pago. */
export async function createEntries(tx: Tx, tenantId: string, input: FinanceEntryInput) {
  await assertCategory(tx, tenantId, input.categoryId, input.direction);
  await assertAccount(tx, tenantId, input.accountId, { mustBeActive: true });
  const series = buildSeries({ ...input, repeat: input.repeat, count: input.repeatCount });
  const seriesId = series.length > 1 ? randomUUID() : null;
  const rows = await tx
    .insert(financeEntries)
    .values(
      series.map((s, i) => ({
        tenantId,
        direction: input.direction,
        description: s.description,
        amountCents: s.amountCents,
        categoryId: input.categoryId,
        accountId: input.accountId,
        competenceDate: s.competenceDate,
        dueDate: s.dueDate,
        paidOn: i === 0 ? input.paidOn : null,
        paymentMethod: input.paymentMethod,
        counterparty: input.counterparty,
        notes: input.notes,
        attachmentId: i === 0 ? input.attachmentId : null,
        origin: 'MANUAL' as const,
        seriesId,
        installment: s.installment,
        installments: s.installments,
      })),
    )
    .returning();
  return rows;
}

/** `payment`: só registrar/desfazer pagamento (permitido também nas compras de estoque). */
async function loadEditable(tx: Tx, tenantId: string, id: string, opts: { payment?: boolean } = {}) {
  const [entry] = await tx.select().from(financeEntries).where(and(eq(financeEntries.tenantId, tenantId), eq(financeEntries.id, id)));
  if (!entry) throw new DomainError('Lançamento não encontrado.');
  if (!entry.status) throw new DomainError('Restaure o lançamento antes de alterá-lo.');
  if (entry.origin === 'PEDIDO') throw new DomainError('Este lançamento vem de um pedido: altere o pedido (valor, pagamento ou cancelamento).');
  if (entry.origin === 'TRANSFERENCIA') throw new DomainError('Transferências não são editadas: exclua e lance de novo.');
  if (entry.origin === 'ESTOQUE' && !opts.payment) throw new DomainError('Este lançamento vem de uma compra de estoque: para corrigir, cancele a compra no Estoque e lance de novo.');
  return entry;
}

/**
 * Edita um lançamento manual. Em séries, `scope = PROXIMOS` leva valor, categoria, conta, descrição e
 * fornecedor também para as parcelas seguintes ainda em aberto (as datas de cada uma são mantidas).
 */
export async function updateEntry(tx: Tx, tenantId: string, id: string, input: FinanceEntryInput, scope: SeriesScope = 'ESTE') {
  const entry = await loadEditable(tx, tenantId, id);
  if (entry.origin === 'ROYALTIES' && input.amountCents !== entry.amountCents) {
    throw new DomainError('O valor dos royalties é calculado pelo sistema. Use "Recalcular" na tela de royalties.');
  }
  await assertCategory(tx, tenantId, input.categoryId, input.direction);
  await assertAccount(tx, tenantId, input.accountId, { mustBeActive: input.accountId !== entry.accountId });

  const shared = {
    direction: input.direction,
    amountCents: input.amountCents,
    categoryId: input.categoryId,
    accountId: input.accountId,
    paymentMethod: input.paymentMethod,
    counterparty: input.counterparty,
    notes: input.notes,
  };
  const [updated] = await tx
    .update(financeEntries)
    .set({
      ...shared,
      description: input.description,
      competenceDate: input.competenceDate,
      dueDate: input.dueDate,
      paidOn: input.paidOn,
      attachmentId: input.attachmentId,
    })
    .where(eq(financeEntries.id, id))
    .returning();

  if (scope === 'PROXIMOS' && entry.seriesId && entry.installment) {
    // Parcelas guardam "(2/3)" na descrição: só a parte comum é levada adiante.
    const base = input.description.replace(/\s*\(\d+\/\d+\)$/, '');
    const next = await tx
      .select({ id: financeEntries.id, installment: financeEntries.installment, installments: financeEntries.installments, description: financeEntries.description })
      .from(financeEntries)
      .where(
        and(
          eq(financeEntries.seriesId, entry.seriesId),
          eq(financeEntries.status, true),
          isNull(financeEntries.paidOn),
          gt(financeEntries.installment, entry.installment),
        ),
      );
    for (const n of next) {
      const parcel = /\(\d+\/\d+\)$/.test(n.description) ? ` (${n.installment}/${n.installments})` : '';
      await tx.update(financeEntries).set({ ...shared, description: `${base}${parcel}` }).where(eq(financeEntries.id, n.id));
    }
  }
  return updated!;
}

/** Marca como pago/recebido. */
export async function payEntry(tx: Tx, tenantId: string, id: string, input: PayEntryInput) {
  const entry = await loadEditable(tx, tenantId, id, { payment: true });
  if (entry.paidOn) throw new DomainError('Este lançamento já está pago.');
  await assertAccount(tx, tenantId, input.accountId, { mustBeActive: true });
  const [row] = await tx
    .update(financeEntries)
    .set({ paidOn: input.paidOn, accountId: input.accountId, paymentMethod: input.paymentMethod ?? entry.paymentMethod })
    .where(eq(financeEntries.id, id))
    .returning();
  return row!;
}

/** Desfaz o pagamento (o lançamento volta a ficar em aberto). */
export async function unpayEntry(tx: Tx, tenantId: string, id: string) {
  const entry = await loadEditable(tx, tenantId, id, { payment: true });
  if (!entry.paidOn) return entry;
  const [row] = await tx.update(financeEntries).set({ paidOn: null }).where(eq(financeEntries.id, id)).returning();
  return row!;
}

/** Exclusão lógica / restauração. Transferência sai e volta com as duas pernas. */
export async function setEntryStatus(tx: Tx, tenantId: string, id: string, status: boolean) {
  const [entry] = await tx.select().from(financeEntries).where(and(eq(financeEntries.tenantId, tenantId), eq(financeEntries.id, id)));
  if (!entry) throw new DomainError('Lançamento não encontrado.');
  if (entry.origin === 'PEDIDO') throw new DomainError('Este lançamento vem de um pedido: para estornar, desmarque o pagamento ou cancele o pedido.');
  if (entry.origin === 'ROYALTIES') throw new DomainError('Lançamento de royalties: para corrigir, use "Recalcular" na tela de Royalties.');
  if (entry.origin === 'ESTOQUE') throw new DomainError('Este lançamento vem de uma compra de estoque: para excluir, cancele a compra no Estoque.');
  if (entry.status === status) return entry;
  const where = entry.transferId ? and(eq(financeEntries.tenantId, tenantId), eq(financeEntries.transferId, entry.transferId)) : eq(financeEntries.id, id);
  const rows = await tx.update(financeEntries).set({ status }).where(where).returning();
  return rows.find((r) => r.id === id)!;
}

/** Transferência entre contas: uma saída e uma entrada pagas, fora das receitas e despesas. */
export async function createTransfer(tx: Tx, tenantId: string, input: TransferInput) {
  await assertAccount(tx, tenantId, input.fromAccountId, { mustBeActive: true });
  await assertAccount(tx, tenantId, input.toAccountId, { mustBeActive: true });
  const names = await tx
    .select({ id: financeAccounts.id, name: financeAccounts.name })
    .from(financeAccounts)
    .where(or(eq(financeAccounts.id, input.fromAccountId), eq(financeAccounts.id, input.toAccountId)));
  const name = (id: string) => names.find((n) => n.id === id)?.name ?? '';
  const description = `Transferência: ${name(input.fromAccountId)} → ${name(input.toAccountId)}`;
  const transferId = randomUUID();
  const common = {
    tenantId,
    description,
    amountCents: input.amountCents,
    competenceDate: input.date,
    dueDate: input.date,
    paidOn: input.date,
    notes: input.notes,
    origin: 'TRANSFERENCIA' as const,
    transferId,
  };
  return tx
    .insert(financeEntries)
    .values([
      { ...common, direction: 'SAIDA' as const, accountId: input.fromAccountId },
      { ...common, direction: 'ENTRADA' as const, accountId: input.toAccountId },
    ])
    .returning();
}

/** Lançamentos em aberto com vencimento até `until` (inclui os vencidos), para a agenda. */
export function listOpenEntries(tx: Tx, tenantId: string, until: string) {
  return tx
    .select(entryColumns)
    .from(financeEntries)
    .leftJoin(financeCategories, eq(financeCategories.id, financeEntries.categoryId))
    .leftJoin(financeAccounts, eq(financeAccounts.id, financeEntries.accountId))
    .leftJoin(orders, eq(orders.id, financeEntries.orderId))
    .where(
      and(
        eq(financeEntries.tenantId, tenantId),
        eq(financeEntries.status, true),
        isNull(financeEntries.paidOn),
        lte(financeEntries.dueDate, until),
      ),
    )
    .orderBy(asc(financeEntries.dueDate), asc(financeEntries.description));
}

/** Fornecedores/clientes já usados (sugestões do formulário). */
export async function listCounterparties(tx: Tx, tenantId: string) {
  const rows = await tx
    .select({ name: financeEntries.counterparty, last: sql`max(${financeEntries.createdAt})` })
    .from(financeEntries)
    .where(
      and(
        eq(financeEntries.tenantId, tenantId),
        eq(financeEntries.status, true),
        ne(financeEntries.origin, 'PEDIDO'),
        sql`${financeEntries.counterparty} is not null`,
      ),
    )
    .groupBy(financeEntries.counterparty)
    .orderBy(desc(sql`max(${financeEntries.createdAt})`))
    .limit(100);
  return rows.map((r) => r.name!);
}
