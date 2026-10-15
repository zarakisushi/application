import { sql } from 'drizzle-orm';
import { boolean, check, customType, date, index, integer, numeric, pgTable, text, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { baseColumns, id } from './common';
import { financeAccountKind, financeDirection, financeDreGroup, financeOrigin, paymentMethod } from './enums';
import { orders } from './orders';
import { tenants } from './tenancy';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

const tenantId = () =>
  uuid()
    .notNull()
    .references(() => tenants.id);

/**
 * Onde o dinheiro da unidade fica (caixa da loja, conta bancária...).
 * Saldo = saldo inicial + lançamentos pagos na conta. `receives_methods` diz em qual conta caem as vendas
 * de cada forma de pagamento.
 */
export const financeAccounts = pgTable(
  'finance_accounts',
  {
    id: id(),
    tenantId: tenantId(),
    name: text().notNull(),
    kind: financeAccountKind().notNull(),
    openingBalanceCents: integer().notNull().default(0),
    openingDate: date({ mode: 'string' }).notNull(),
    receivesMethods: paymentMethod().array().notNull().default(sql`'{}'`),
    active: boolean().notNull().default(true),
    ...baseColumns(),
  },
  (t) => [uniqueIndex('finance_accounts_tenant_name_uq').on(t.tenantId, t.name).where(sql`${t.status}`)],
);

/**
 * Comprovantes (nota, boleto, recibo) guardados no próprio banco: ficam privados, isolados por unidade e
 * entram no backup. Sem auditoria de linha (o conteúdo binário não vai para a auditoria); a troca de
 * comprovante de um lançamento é auditada no próprio lançamento.
 */
export const financeAttachments = pgTable('finance_attachments', {
  id: id(),
  tenantId: tenantId(),
  fileName: text().notNull(),
  contentType: text().notNull(),
  sizeBytes: integer().notNull(),
  content: bytea().notNull(),
  ...baseColumns(),
});

/** Plano de contas da unidade, agrupado como na DRE. */
export const financeCategories = pgTable(
  'finance_categories',
  {
    id: id(),
    tenantId: tenantId(),
    name: text().notNull(),
    direction: financeDirection().notNull(),
    dreGroup: financeDreGroup().notNull(),
    /** Categoria usada pelo próprio sistema (vendas, royalties, ajustes): não pode ser desativada. */
    systemKey: text(),
    /** Compra de mercadoria (insumos, bebidas, embalagens): entra no CMV real. */
    cmv: boolean().notNull().default(false),
    active: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    ...baseColumns(),
  },
  (t) => [
    uniqueIndex('finance_categories_tenant_name_uq').on(t.tenantId, t.direction, t.name).where(sql`${t.status}`),
    uniqueIndex('finance_categories_system_uq').on(t.tenantId, t.systemKey).where(sql`${t.status} and ${t.systemKey} is not null`),
  ],
);

/**
 * Lançamentos: tudo o que entra e sai. `paid_on` nulo = em aberto (a pagar/a receber).
 * Datas em dias do fuso da unidade: competência (DRE), vencimento e pagamento (fluxo de caixa).
 */
export const financeEntries = pgTable(
  'finance_entries',
  {
    id: id(),
    tenantId: tenantId(),
    direction: financeDirection().notNull(),
    description: text().notNull(),
    amountCents: integer().notNull(),
    categoryId: uuid().references(() => financeCategories.id),
    accountId: uuid().references(() => financeAccounts.id),
    competenceDate: date({ mode: 'string' }).notNull(),
    dueDate: date({ mode: 'string' }).notNull(),
    paidOn: date({ mode: 'string' }),
    paymentMethod: paymentMethod(),
    counterparty: text(),
    notes: text(),
    /** Comprovante guardado no banco (privado: só abre para quem tem acesso ao financeiro da unidade). */
    attachmentId: uuid().references(() => financeAttachments.id),
    /** Cobrança de royalties que gerou o lançamento (na franquia e na Matriz). */
    royaltyChargeId: uuid().references((): AnyPgColumn => royaltyCharges.id),
    origin: financeOrigin().notNull().default('MANUAL'),
    /** Venda de um pedido pago: um lançamento ativo por pedido. */
    orderId: uuid().references(() => orders.id),
    /** Transferência entre contas: a saída e a entrada compartilham este id. */
    transferId: uuid(),
    /** Recorrência/parcelas: lançamentos gerados juntos compartilham este id. */
    seriesId: uuid(),
    installment: integer(),
    installments: integer(),
    ...baseColumns(),
  },
  (t) => [
    index('finance_entries_tenant_due_idx').on(t.tenantId, t.dueDate),
    index('finance_entries_tenant_paid_idx').on(t.tenantId, t.paidOn),
    index('finance_entries_tenant_competence_idx').on(t.tenantId, t.competenceDate),
    index('finance_entries_account_idx').on(t.accountId),
    index('finance_entries_series_idx').on(t.seriesId),
    uniqueIndex('finance_entries_order_uq').on(t.orderId).where(sql`${t.status} and ${t.orderId} is not null`),
    check('finance_entries_amount_ck', sql`${t.amountCents} > 0`),
    check('finance_entries_paid_account_ck', sql`${t.paidOn} is null or ${t.accountId} is not null`),
    check('finance_entries_category_ck', sql`(${t.origin} = 'TRANSFERENCIA') = (${t.categoryId} is null)`),
    check('finance_entries_transfer_ck', sql`(${t.origin} = 'TRANSFERENCIA') = (${t.transferId} is not null)`),
    check(
      'finance_entries_installment_ck',
      sql`(${t.installment} is null and ${t.installments} is null) or (${t.installment} between 1 and ${t.installments})`,
    ),
  ],
);

/**
 * Cobrança mensal de royalties de uma franquia (`tenant_id` = franquia). Gera uma saída na franquia e uma
 * entrada a receber na Matriz. Uma cobrança ativa por franquia e mês.
 */
export const royaltyCharges = pgTable(
  'royalty_charges',
  {
    id: id(),
    tenantId: tenantId(),
    matrizTenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    /** Primeiro dia do mês de referência. */
    month: date({ mode: 'string' }).notNull(),
    revenueCents: integer().notNull(),
    royaltyPct: numeric({ precision: 5, scale: 2 }).notNull(),
    amountCents: integer().notNull(),
    dueDate: date({ mode: 'string' }).notNull(),
    franchiseEntryId: uuid(),
    matrizEntryId: uuid(),
    ...baseColumns(),
  },
  (t) => [
    uniqueIndex('royalty_charges_tenant_month_uq').on(t.tenantId, t.month).where(sql`${t.status}`),
    check('royalty_charges_amount_ck', sql`${t.amountCents} >= 0 and ${t.revenueCents} >= 0`),
  ],
);

/** Meses fechados: lançamentos com competência ou pagamento no mês não podem mais mudar (reabrir = status false). */
export const financeClosings = pgTable(
  'finance_closings',
  {
    id: id(),
    tenantId: tenantId(),
    /** Primeiro dia do mês fechado. */
    month: date({ mode: 'string' }).notNull(),
    ...baseColumns(),
  },
  (t) => [uniqueIndex('finance_closings_tenant_month_uq').on(t.tenantId, t.month).where(sql`${t.status}`)],
);

/**
 * Extratos bancários enviados para conferência: fotos/PDF do extrato com a data e o saldo que ele mostra.
 * Os arquivos ficam em `finance_attachments`; a lista de ids fica aqui para entrar na auditoria.
 */
export const financeStatements = pgTable(
  'finance_statements',
  {
    id: id(),
    tenantId: tenantId(),
    accountId: uuid()
      .notNull()
      .references(() => financeAccounts.id),
    statementDate: date({ mode: 'string' }).notNull(),
    /** Saldo mostrado no extrato (pode ser negativo). */
    balanceCents: integer().notNull(),
    attachmentIds: uuid().array().notNull(),
    notes: text(),
    /** Ajuste lançado a partir deste extrato (quando o saldo não conferia). */
    adjustmentEntryId: uuid().references(() => financeEntries.id),
    ...baseColumns(),
  },
  (t) => [
    index('finance_statements_account_idx').on(t.accountId, t.statementDate),
    check('finance_statements_files_ck', sql`cardinality(${t.attachmentIds}) between 1 and 10`),
  ],
);
