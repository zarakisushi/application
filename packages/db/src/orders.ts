import {
  OrderError,
  evaluateCoupon,
  isScheduled,
  priceOrder,
  todayInZone,
  zonedTimeToUtc,
  type CouponCheck,
  type OrderInput,
  type PaymentMethod,
} from '@zaraki/core';
import { and, asc, count, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import type { Tx } from './client';
import { syncOrderFinance } from './finance/orders';
import {
  auditLogs,
  calendarSyncJobs,
  coupons,
  customers,
  orderCounters,
  orderItems,
  orders,
  orderStageHistory,
  products,
  tenants,
} from './schema';

export type TenantRef = Pick<typeof tenants.$inferSelect, 'id' | 'timezone' | 'orderCodePrefix'>;

/** Unidade ativa pelo slug. A tabela de unidades é legível sem contexto (RLS de leitura aberta). */
export async function findTenantBySlug(tx: Pick<Tx, 'select'>, slug: string) {
  const [tenant] = await tx
    .select()
    .from(tenants)
    .where(and(eq(tenants.slug, slug), eq(tenants.status, true)));
  return tenant ?? null;
}

/** Cardápio ativo da unidade do contexto, na ordem de exibição. */
export function listActiveMenu(tx: Tx) {
  return tx
    .select({
      id: products.id,
      name: products.name,
      description: products.description,
      priceCents: products.priceCents,
      imageUrl: products.imageUrl,
      isSpecial: products.isSpecial,
    })
    .from(products)
    .where(eq(products.status, true))
    .orderBy(asc(products.sortOrder), asc(products.name));
}

/** Quantos pedidos do site este IP criou nos últimos `minutes` minutos (lido da auditoria; ignora o painel). */
export async function countRecentOrdersFromIp(tx: Tx, ip: string, minutes: number) {
  const [row] = await tx
    .select({ n: count() })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.entity, 'orders'),
        eq(auditLogs.action, 'CREATE'),
        eq(auditLogs.ip, ip),
        // Só pedidos feitos pelo site: lançamentos da equipe no painel não bloqueiam clientes da mesma rede.
        sql`${auditLogs.after} ->> 'source' = 'SITE'`,
        gt(auditLogs.createdAt, sql`now() - make_interval(mins => ${minutes})`),
      ),
    );
  return row?.n ?? 0;
}

/** Subtotal e tubos de uma lista de itens pelo cardápio ativo da unidade (prévia de cupom). */
export async function priceItems(tx: Tx, tenantId: string, items: { productId: string; qty: number }[]) {
  const ids = [...new Set(items.map((i) => i.productId))];
  const menu = ids.length
    ? await tx
        .select({ id: products.id, name: products.name, priceCents: products.priceCents, costCents: products.costCents })
        .from(products)
        .where(and(eq(products.tenantId, tenantId), eq(products.status, true), inArray(products.id, ids)))
    : [];
  return priceOrder(menu, items);
}

/** Cupons recusados vindos de um IP na janela de tempo (base do bloqueio contra adivinhação de códigos). */
export async function countRecentCouponRejections(tx: Tx, ip: string, minutes: number) {
  const [row] = await tx
    .select({ n: count() })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.action, 'COUPON_REJECTED'),
        eq(auditLogs.ip, ip),
        gt(auditLogs.createdAt, sql`now() - make_interval(mins => ${minutes})`),
      ),
    );
  return row?.n ?? 0;
}

async function nextOrderCode(tx: Tx, tenant: TenantRef) {
  const [row] = await tx
    .insert(orderCounters)
    .values({ tenantId: tenant.id, lastValue: 1 })
    .onConflictDoUpdate({ target: orderCounters.tenantId, set: { lastValue: sql`${orderCounters.lastValue} + 1` } })
    .returning({ value: orderCounters.lastValue });
  return `${tenant.orderCodePrefix}-${String(row!.value).padStart(6, '0')}`;
}

/** Busca o cliente ativo pelo telefone ou cria um novo. Dados já cadastrados não são sobrescritos. */
async function upsertCustomer(tx: Tx, tenantId: string, o: OrderInput) {
  const [existing] = await tx
    .select()
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), eq(customers.phone, o.phone), eq(customers.status, true)));
  if (!existing) {
    const [created] = await tx
      .insert(customers)
      .values({
        tenantId,
        name: o.name,
        phone: o.phone,
        neighborhood: o.neighborhood || null,
        address: o.address || null,
      })
      .returning();
    return created!;
  }
  const fill = {
    ...(!existing.neighborhood && o.neighborhood ? { neighborhood: o.neighborhood } : {}),
    ...(!existing.address && o.address ? { address: o.address } : {}),
  };
  if (Object.keys(fill).length) await tx.update(customers).set(fill).where(eq(customers.id, existing.id));
  return existing;
}

export type CouponOrderContext = {
  subtotalCents: number;
  tubes: number;
  /** Telefone (E.164) do cliente — exigido pelos cupons exclusivos. */
  phone: string | null;
  /** Pedido em edição: não conta como uso do próprio cupom. */
  excludeOrderId?: string;
};

/** Usos atuais do cupom: pedidos ativos e não cancelados (cancelar devolve o uso). */
async function couponUses(tx: Tx, couponId: string, excludeOrderId?: string) {
  const [row] = await tx
    .select({ n: count() })
    .from(orders)
    .where(
      and(
        eq(orders.couponId, couponId),
        eq(orders.status, true),
        ne(orders.stage, 'CANCELADO'),
        excludeOrderId ? ne(orders.id, excludeOrderId) : undefined,
      ),
    );
  return row?.n ?? 0;
}

/**
 * Avalia um cupom pelo código, sem gravar nada (prévia do formulário do site e do painel).
 * Com `lock`, trava a linha do cupom até o fim da transação: dois pedidos simultâneos não
 * conseguem usar a mesma última vaga.
 */
export async function checkCouponCode(
  tx: Tx,
  tenant: Pick<TenantRef, 'id' | 'timezone'>,
  code: string,
  o: CouponOrderContext,
  opts: { lock?: boolean } = {},
): Promise<CouponCheck & { couponId?: string }> {
  const query = tx
    .select()
    .from(coupons)
    .where(and(eq(coupons.tenantId, tenant.id), eq(coupons.code, code), eq(coupons.status, true)));
  const [coupon] = opts.lock ? await query.for('update') : await query;
  const usesSoFar = coupon ? await couponUses(tx, coupon.id, o.excludeOrderId) : 0;
  const check = evaluateCoupon(coupon ?? null, { ...o, usesSoFar, today: todayInZone(tenant.timezone) });
  return check.ok ? { ...check, couponId: coupon!.id } : check;
}

/** Aplica o cupom num pedido em gravação; recusa com a mensagem do motivo. */
export async function applyCoupon(tx: Tx, tenant: Pick<TenantRef, 'id' | 'timezone'>, code: string, o: CouponOrderContext) {
  const check = await checkCouponCode(tx, tenant, code, o, { lock: true });
  if (!check.ok) throw new OrderError('COUPON_REJECTED', check.message);
  return { couponId: check.couponId!, couponCode: check.code, discountCents: check.discountCents };
}

export type CreateOrderOptions = {
  source: (typeof orders.$inferInsert)['source'];
  now?: Date;
  /** Pedido lançado pelo painel pode ter data passada (registro posterior). */
  allowPast?: boolean;
  discountCents?: number;
  deliveryFeeCents?: number;
  paymentMethod?: PaymentMethod | null;
  paid?: boolean;
};

/** Total do pedido: subtotal − desconto + taxa de entrega (nunca negativo). */
export const orderTotal = (subtotal: number, discount = 0, fee = 0) => Math.max(0, subtotal - discount + fee);

/**
 * Enfileira a sincronização do pedido com a Google Agenda (processada pelo worker da fase de agenda)
 * e marca o pedido como pendente.
 */
export async function enqueueCalendarSync(tx: Tx, order: { id: string; tenantId: string }, op: 'UPSERT' | 'DELETE') {
  await tx.insert(calendarSyncJobs).values({ tenantId: order.tenantId, orderId: order.id, op });
  await tx.update(orders).set({ calendarSyncState: 'PENDENTE' }).where(eq(orders.id, order.id));
}

/**
 * Cria um pedido completo na unidade do contexto: cliente, pedido, itens (com preço do cardápio),
 * histórico de etapa e, para encomendas/festas, o job de sincronização com a Google Agenda.
 * Deve rodar dentro de `withContext` (a auditoria e o RLS dependem do contexto).
 */
export async function createOrder(tx: Tx, tenant: TenantRef, input: OrderInput, opts: CreateOrderOptions) {
  const ids = [...new Set(input.items.map((i) => i.productId))];
  const menu = await tx
    .select({ id: products.id, name: products.name, priceCents: products.priceCents, costCents: products.costCents })
    .from(products)
    .where(and(eq(products.tenantId, tenant.id), eq(products.status, true), inArray(products.id, ids)));
  const priced = priceOrder(menu, input.items);

  const scheduled = isScheduled(input.type);
  const scheduledAt = scheduled ? zonedTimeToUtc(input.date, input.time, tenant.timezone) : null;
  if (scheduledAt && !opts.allowPast && scheduledAt.getTime() < (opts.now ?? new Date()).getTime()) {
    throw new OrderError('SCHEDULE_IN_PAST', 'A data e o horário precisam ser no futuro.');
  }

  const coupon = input.couponCode
    ? await applyCoupon(tx, tenant, input.couponCode, { subtotalCents: priced.subtotalCents, tubes: priced.tubes, phone: input.phone })
    : null;
  // Com cupom, o desconto é o dele (o desconto manual do painel não se soma).
  const discountCents = coupon ? coupon.discountCents : (opts.discountCents ?? 0);

  const customer = await upsertCustomer(tx, tenant.id, input);
  const code = await nextOrderCode(tx, tenant);

  const [order] = await tx
    .insert(orders)
    .values({
      tenantId: tenant.id,
      code,
      type: input.type,
      customerId: customer.id,
      scheduledAt,
      guests: isScheduled(input.type) ? (input.guests ?? null) : null,
      neighborhood: input.neighborhood || null,
      address: input.address || null,
      addressReference: input.addressReference || null,
      notes: input.notes || null,
      subtotalCents: priced.subtotalCents,
      discountCents,
      couponId: coupon?.couponId ?? null,
      couponCode: coupon?.couponCode ?? null,
      deliveryFeeCents: opts.deliveryFeeCents ?? 0,
      totalCents: orderTotal(priced.subtotalCents, discountCents, opts.deliveryFeeCents),
      paymentMethod: opts.paymentMethod ?? null,
      paid: opts.paid ?? false,
      paidAt: opts.paid ? new Date() : null,
      source: opts.source,
      calendarSyncState: scheduled ? 'PENDENTE' : 'NAO_APLICA',
    })
    .returning();

  await tx.insert(orderItems).values(priced.lines.map((l) => ({ ...l, tenantId: tenant.id, orderId: order!.id })));
  await tx.insert(orderStageHistory).values({ tenantId: tenant.id, orderId: order!.id, toStage: 'NOVO' });
  if (scheduled) {
    await tx.insert(calendarSyncJobs).values({ tenantId: tenant.id, orderId: order!.id, op: 'UPSERT' });
  }
  if (order!.paid) await syncOrderFinance(tx, order!.id);

  return { order: order!, customer, lines: priced.lines, tubes: priced.tubes };
}
