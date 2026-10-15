import {
  DomainError,
  evaluateCoupon,
  isScheduled,
  zonedTimeToUtc,
  type OrderStage,
  type OrderType,
  type OrderUpdate,
  type PaymentMethod,
} from '@zaraki/core';
import { and, asc, desc, eq, gte, ilike, inArray, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../client';
import { syncOrderFinance } from '../finance/orders';
import { applyCoupon, enqueueCalendarSync, orderTotal, type TenantRef } from '../orders';
import { coupons, customers, orderItems, orders, orderStageHistory, products, users } from '../schema';
import { contains, paging, statusWhere, toPage, type ListParams } from './common';

/** Pedidos = delivery; encomendas = encomendas e festas; todos = os dois (painel inicial). */
export type OrderKind = 'pedidos' | 'encomendas' | 'todos';
export type OrderPeriod = 'proximas' | 'passadas' | 'todas';

export type OrderListParams = ListParams & {
  kind: OrderKind;
  stage?: OrderStage;
  /** Só para encomendas: próximas (padrão), passadas ou todas. */
  period?: OrderPeriod;
  timezone: string;
};

const SCHEDULED_TYPES: OrderType[] = ['ENCOMENDA', 'FESTA'];

const startOfToday = (timezone: string) =>
  sql`(date_trunc('day', now() at time zone ${timezone}) at time zone ${timezone})`;

export async function listOrders(tx: Tx, tenantId: string, params: OrderListParams) {
  const { page, pageSize, offset } = paging(params);
  const period = params.kind === 'encomendas' ? (params.period ?? 'proximas') : 'todas';
  const digits = params.q?.replace(/\D/g, '');

  const where = and(
    eq(orders.tenantId, tenantId),
    statusWhere(orders.status, params.status),
    params.kind === 'pedidos' ? eq(orders.type, 'DELIVERY') : params.kind === 'encomendas' ? inArray(orders.type, SCHEDULED_TYPES) : undefined,
    params.stage ? eq(orders.stage, params.stage) : undefined,
    period === 'proximas' ? gte(orders.scheduledAt, startOfToday(params.timezone)) : undefined,
    period === 'passadas' ? lt(orders.scheduledAt, startOfToday(params.timezone)) : undefined,
    params.q
      ? or(
          ilike(orders.code, contains(params.q)),
          ilike(customers.name, contains(params.q)),
          digits && digits.length >= 4 ? ilike(customers.phone, contains(digits)) : undefined,
        )
      : undefined,
  );

  const orderBy: SQL[] =
    params.kind !== 'encomendas'
      ? [desc(orders.createdAt)]
      : period === 'proximas'
        ? [asc(orders.scheduledAt)]
        : [desc(orders.scheduledAt)];

  const base = tx
    .select({
      id: orders.id,
      code: orders.code,
      type: orders.type,
      stage: orders.stage,
      status: orders.status,
      totalCents: orders.totalCents,
      createdAt: orders.createdAt,
      scheduledAt: orders.scheduledAt,
      guests: orders.guests,
      neighborhood: orders.neighborhood,
      source: orders.source,
      paid: orders.paid,
      calendarSyncState: orders.calendarSyncState,
      customerName: customers.name,
      customerPhone: customers.phone,
    })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(where);

  const rows = await base.orderBy(...orderBy).limit(pageSize).offset(offset);
  const [total] = await tx
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(where);
  return toPage(rows, total?.n ?? 0, page, pageSize);
}

/** Encomendas/festas ativas e não canceladas num intervalo (visão de calendário). */
export function listScheduledBetween(tx: Tx, tenantId: string, from: Date, to: Date) {
  return tx
    .select({
      id: orders.id,
      code: orders.code,
      type: orders.type,
      stage: orders.stage,
      scheduledAt: orders.scheduledAt,
      guests: orders.guests,
      customerName: customers.name,
    })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(
      and(
        eq(orders.tenantId, tenantId),
        eq(orders.status, true),
        ne(orders.stage, 'CANCELADO'),
        inArray(orders.type, SCHEDULED_TYPES),
        gte(orders.scheduledAt, from),
        lt(orders.scheduledAt, to),
      ),
    )
    .orderBy(asc(orders.scheduledAt));
}

export async function getOrderDetail(tx: Tx, tenantId: string, id: string) {
  const [row] = await tx
    .select({ order: orders, customer: customers })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(and(eq(orders.tenantId, tenantId), eq(orders.id, id)));
  if (!row) return null;

  const items = await tx
    .select()
    .from(orderItems)
    .where(and(eq(orderItems.orderId, id), eq(orderItems.status, true)))
    .orderBy(asc(orderItems.productName));

  const history = await tx
    .select({
      id: orderStageHistory.id,
      fromStage: orderStageHistory.fromStage,
      toStage: orderStageHistory.toStage,
      note: orderStageHistory.note,
      createdAt: orderStageHistory.createdAt,
      byName: users.name,
    })
    .from(orderStageHistory)
    .leftJoin(users, eq(users.id, orderStageHistory.createdBy))
    .where(eq(orderStageHistory.orderId, id))
    .orderBy(asc(orderStageHistory.createdAt));

  return { ...row.order, customer: row.customer, items, history };
}

async function loadOrder(tx: Tx, tenantId: string, id: string) {
  const [order] = await tx.select().from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, id)));
  if (!order) throw new DomainError('Pedido não encontrado.');
  return order;
}

/** Mesmo conjunto de produtos e quantidades? */
function sameItems(a: { productId: string; qty: number }[], b: { productId: string; qty: number }[]) {
  const key = (items: { productId: string; qty: number }[]) => {
    const m = new Map<string, number>();
    for (const i of items) m.set(i.productId, (m.get(i.productId) ?? 0) + i.qty);
    return [...m].sort().join('|');
  };
  return key(a) === key(b);
}

/**
 * Edita um pedido. Itens que já estavam no pedido mantêm o preço/custo da época;
 * itens novos usam o preço atual do cardápio. Encomendas/festas são reenviadas à agenda.
 */
export async function updateOrder(tx: Tx, tenant: TenantRef, id: string, input: OrderUpdate) {
  const order = await loadOrder(tx, tenant.id, id);
  if (!order.status) throw new DomainError('Restaure o pedido antes de editá-lo.');

  const current = await tx
    .select()
    .from(orderItems)
    .where(and(eq(orderItems.orderId, id), eq(orderItems.status, true)));

  let subtotal = current.reduce((s, i) => s + i.lineTotalCents, 0);
  if (!sameItems(current, input.items)) {
    const previous = new Map(current.map((i) => [i.productId, i]));
    const newIds = [...new Set(input.items.map((i) => i.productId))].filter((pid) => !previous.has(pid));
    const menu = newIds.length
      ? await tx
          .select()
          .from(products)
          .where(and(eq(products.tenantId, tenant.id), eq(products.status, true), inArray(products.id, newIds)))
      : [];
    const catalog = new Map(menu.map((p) => [p.id, p]));

    const qty = new Map<string, number>();
    for (const i of input.items) qty.set(i.productId, (qty.get(i.productId) ?? 0) + i.qty);
    const lines = [...qty].map(([productId, q]) => {
      const old = previous.get(productId);
      const product = catalog.get(productId);
      if (!old && !product) throw new DomainError('Um dos sabores escolhidos não está disponível no cardápio.');
      const unitPriceCents = old?.unitPriceCents ?? product!.priceCents;
      return {
        tenantId: tenant.id,
        orderId: id,
        productId,
        productName: old?.productName ?? product!.name,
        unitPriceCents,
        unitCostCents: old?.unitCostCents ?? product!.costCents,
        qty: q,
        lineTotalCents: unitPriceCents * q,
      };
    });

    if (current.length) {
      await tx.update(orderItems).set({ status: false }).where(and(eq(orderItems.orderId, id), eq(orderItems.status, true)));
    }
    await tx.insert(orderItems).values(lines);
    subtotal = lines.reduce((s, l) => s + l.lineTotalCents, 0);
  }

  const tubes = input.items.reduce((s, i) => s + i.qty, 0);
  const coupon = await recomputeCoupon(tx, tenant, order, input, { subtotalCents: subtotal, tubes });
  const discount = coupon ? coupon.discountCents : input.discount;

  const scheduled = isScheduled(input.type);
  const scheduledAt = scheduled ? zonedTimeToUtc(input.date, input.time, tenant.timezone) : null;

  const [updated] = await tx
    .update(orders)
    .set({
      type: input.type,
      scheduledAt,
      guests: input.type === 'FESTA' ? (input.guests ?? null) : null,
      neighborhood: input.neighborhood || null,
      address: input.address || null,
      addressReference: input.addressReference || null,
      notes: input.notes || null,
      subtotalCents: subtotal,
      discountCents: discount,
      couponId: coupon?.couponId ?? null,
      couponCode: coupon?.couponCode ?? null,
      deliveryFeeCents: input.deliveryFee,
      totalCents: orderTotal(subtotal, discount, input.deliveryFee),
      paymentMethod: input.paymentMethod,
      paid: input.paid,
      paidAt: input.paid ? (order.paidAt ?? new Date()) : null,
      calendarSyncState: scheduled ? order.calendarSyncState : 'NAO_APLICA',
    })
    .where(eq(orders.id, id))
    .returning();

  if (order.stage !== 'CANCELADO') {
    if (scheduled) await enqueueCalendarSync(tx, updated!, 'UPSERT');
    else if (isScheduled(order.type)) await enqueueCalendarSync(tx, updated!, 'DELETE');
  }
  await syncOrderFinance(tx, id);
  return updated!;
}

/**
 * Cupom do pedido em edição:
 * - mesmo cupom de antes → continua valendo mesmo que a campanha tenha acabado ou o cupom tenha sido
 *   desativado; só os mínimos (tubos/valor) são conferidos e o desconto é recalculado;
 * - cupom novo → validação completa (o próprio pedido não conta como uso);
 * - sem cupom → remove.
 */
async function recomputeCoupon(
  tx: Tx,
  tenant: TenantRef,
  order: typeof orders.$inferSelect,
  input: OrderUpdate,
  totals: { subtotalCents: number; tubes: number },
) {
  if (!input.couponCode) return null;
  if (input.couponCode === order.couponCode && order.couponId) {
    const [c] = await tx.select().from(coupons).where(eq(coupons.id, order.couponId));
    const check = evaluateCoupon(
      c ? { ...c, active: true, status: true, startsAt: null, endsAt: null, maxUses: null, phone: null } : null,
      { ...totals, phone: null, usesSoFar: 0, today: '' },
    );
    if (!check.ok) {
      throw new DomainError(`O pedido não atende mais ao cupom ${order.couponCode}: ${check.message} Ajuste os itens ou remova o cupom.`);
    }
    return { couponId: order.couponId, couponCode: order.couponCode, discountCents: check.discountCents };
  }
  const [customer] = await tx.select({ phone: customers.phone }).from(customers).where(eq(customers.id, order.customerId));
  return applyCoupon(tx, tenant, input.couponCode, { ...totals, phone: customer?.phone ?? null, excludeOrderId: order.id });
}

/** Muda a etapa do pedido e registra no histórico. Cancelar exige motivo. */
export async function changeOrderStage(tx: Tx, tenantId: string, id: string, to: OrderStage, note?: string | null) {
  const order = await loadOrder(tx, tenantId, id);
  if (!order.status) throw new DomainError('Restaure o pedido antes de mudar a etapa.');
  if (order.stage === to) return order;
  const reason = note?.trim() || null;
  if (to === 'CANCELADO' && !reason) throw new DomainError('Informe o motivo do cancelamento.');

  const [updated] = await tx
    .update(orders)
    .set({ stage: to, cancelReason: to === 'CANCELADO' ? reason : null })
    .where(eq(orders.id, id))
    .returning();
  await tx.insert(orderStageHistory).values({ tenantId, orderId: id, fromStage: order.stage, toStage: to, note: reason });

  if (isScheduled(order.type)) {
    if (to === 'CANCELADO') await enqueueCalendarSync(tx, updated!, 'DELETE');
    else if (order.stage === 'CANCELADO') await enqueueCalendarSync(tx, updated!, 'UPSERT');
  }
  await syncOrderFinance(tx, id);
  return updated!;
}

/** Exclusão lógica / restauração do pedido (encomendas saem e voltam da agenda). */
export async function setOrderStatus(tx: Tx, tenantId: string, id: string, status: boolean) {
  const order = await loadOrder(tx, tenantId, id);
  if (order.status === status) return order;
  const [updated] = await tx.update(orders).set({ status }).where(eq(orders.id, id)).returning();
  if (isScheduled(order.type) && order.stage !== 'CANCELADO') {
    await enqueueCalendarSync(tx, updated!, status ? 'UPSERT' : 'DELETE');
  }
  await syncOrderFinance(tx, id);
  return updated!;
}

/**
 * Registra o pagamento de um pedido (forma + pago agora): a venda entra no caixa.
 * `paid = false` desfaz (a entrada é estornada).
 */
export async function setOrderPayment(tx: Tx, tenantId: string, id: string, payment: { paid: boolean; method: PaymentMethod | null }) {
  const order = await loadOrder(tx, tenantId, id);
  if (!order.status) throw new DomainError('Restaure o pedido antes de registrar o pagamento.');
  if (payment.paid && order.stage === 'CANCELADO') throw new DomainError('Pedido cancelado não recebe pagamento.');
  const [updated] = await tx
    .update(orders)
    .set({
      paid: payment.paid,
      paidAt: payment.paid ? (order.paid ? order.paidAt : new Date()) : null,
      paymentMethod: payment.method ?? order.paymentMethod,
    })
    .where(eq(orders.id, id))
    .returning();
  await syncOrderFinance(tx, id);
  return updated!;
}
