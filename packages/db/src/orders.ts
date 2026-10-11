import {
  OrderError,
  isScheduled,
  priceOrder,
  zonedTimeToUtc,
  type OrderInput,
  type PaymentMethod,
} from '@zaraki/core';
import { and, asc, count, eq, gt, inArray, sql } from 'drizzle-orm';
import type { Tx } from './client';
import {
  auditLogs,
  calendarSyncJobs,
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

/** Quantos pedidos do site este IP criou nos últimos `minutes` minutos (lido da auditoria). */
export async function countRecentOrdersFromIp(tx: Tx, ip: string, minutes: number) {
  const [row] = await tx
    .select({ n: count() })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.entity, 'orders'),
        eq(auditLogs.action, 'CREATE'),
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
      guests: input.type === 'FESTA' ? (input.guests ?? null) : null,
      neighborhood: input.neighborhood || null,
      address: input.address || null,
      notes: input.notes || null,
      subtotalCents: priced.subtotalCents,
      discountCents: opts.discountCents ?? 0,
      deliveryFeeCents: opts.deliveryFeeCents ?? 0,
      totalCents: orderTotal(priced.subtotalCents, opts.discountCents, opts.deliveryFeeCents),
      paymentMethod: opts.paymentMethod ?? null,
      paid: opts.paid ?? false,
      source: opts.source,
      calendarSyncState: scheduled ? 'PENDENTE' : 'NAO_APLICA',
    })
    .returning();

  await tx.insert(orderItems).values(priced.lines.map((l) => ({ ...l, tenantId: tenant.id, orderId: order!.id })));
  await tx.insert(orderStageHistory).values({ tenantId: tenant.id, orderId: order!.id, toStage: 'NOVO' });
  if (scheduled) {
    await tx.insert(calendarSyncJobs).values({ tenantId: tenant.id, orderId: order!.id, op: 'UPSERT' });
  }

  return { order: order!, customer, lines: priced.lines, tubes: priced.tubes };
}
