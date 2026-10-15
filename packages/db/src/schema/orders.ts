import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { customers, products } from './catalog';
import { coupons } from './coupons';
import { baseColumns, id, ts } from './common';
import {
  calendarJobOp,
  calendarJobState,
  calendarSyncState,
  orderSource,
  orderStage,
  orderType,
  paymentMethod,
} from './enums';
import { tenants } from './tenancy';

const tenantId = () =>
  uuid()
    .notNull()
    .references(() => tenants.id);

export const orders = pgTable(
  'orders',
  {
    id: id(),
    tenantId: tenantId(),
    code: text().notNull(),
    type: orderType().notNull(),
    stage: orderStage().notNull().default('NOVO'),
    customerId: uuid()
      .notNull()
      .references(() => customers.id),
    scheduledAt: ts(),
    guests: integer(),
    neighborhood: text(),
    address: text(),
    /** Ponto de referência para a entrega (ex.: "portão azul, ao lado da padaria"). */
    addressReference: text(),
    notes: text(),
    subtotalCents: integer().notNull(),
    discountCents: integer().notNull().default(0),
    /** Cupom aplicado; o código fica copiado para o histórico não depender do cadastro. */
    couponId: uuid().references(() => coupons.id),
    couponCode: text(),
    deliveryFeeCents: integer().notNull().default(0),
    totalCents: integer().notNull(),
    source: orderSource().notNull(),
    paymentMethod: paymentMethod(),
    paid: boolean().notNull().default(false),
    /** Quando o pedido foi marcado como pago (data da entrada no caixa). */
    paidAt: ts(),
    cancelReason: text(),
    googleEventId: text(),
    calendarSyncState: calendarSyncState().notNull().default('NAO_APLICA'),
    ...baseColumns(),
  },
  (t) => [
    uniqueIndex('orders_tenant_code_uq').on(t.tenantId, t.code),
    index('orders_tenant_created_idx').on(t.tenantId, t.createdAt),
    index('orders_tenant_stage_idx').on(t.tenantId, t.stage),
    index('orders_tenant_scheduled_idx').on(t.tenantId, t.scheduledAt),
    index('orders_customer_idx').on(t.customerId),
    index('orders_coupon_idx').on(t.couponId),
    check('orders_scheduled_ck', sql`${t.type} = 'DELIVERY' or ${t.scheduledAt} is not null`),
    check(
      'orders_money_ck',
      sql`${t.subtotalCents} >= 0 and ${t.discountCents} >= 0 and ${t.deliveryFeeCents} >= 0 and ${t.totalCents} >= 0`,
    ),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: id(),
    tenantId: tenantId(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    /** Cópias fixas do momento do pedido: mudanças no cardápio não alteram pedidos antigos. */
    productName: text().notNull(),
    unitPriceCents: integer().notNull(),
    unitCostCents: integer().notNull(),
    qty: integer().notNull(),
    lineTotalCents: integer().notNull(),
    ...baseColumns(),
  },
  (t) => [
    index('order_items_order_idx').on(t.orderId),
    index('order_items_product_idx').on(t.tenantId, t.productId),
    check('order_items_qty_ck', sql`${t.qty} > 0`),
  ],
);

export const orderStageHistory = pgTable(
  'order_stage_history',
  {
    id: id(),
    tenantId: tenantId(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id),
    fromStage: orderStage(),
    toStage: orderStage().notNull(),
    note: text(),
    ...baseColumns(),
  },
  (t) => [index('order_stage_history_order_idx').on(t.orderId)],
);

/** Outbox da sincronização com a Google Agenda. Tabela técnica, sem auditoria de linha. */
export const calendarSyncJobs = pgTable(
  'calendar_sync_jobs',
  {
    id: id(),
    tenantId: tenantId(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id),
    op: calendarJobOp().notNull(),
    state: calendarJobState().notNull().default('PENDING'),
    attempts: integer().notNull().default(0),
    lastError: text(),
    runAfter: ts().notNull().defaultNow(),
    ...baseColumns(),
  },
  (t) => [index('calendar_sync_jobs_pending_idx').on(t.state, t.runAfter)],
);
