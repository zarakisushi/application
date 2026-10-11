import { DomainError, formatBrPhone, type CustomerInput } from '@zaraki/core';
import { and, asc, count, desc, eq, ilike, max, ne, or, sql, sum } from 'drizzle-orm';
import type { Tx } from '../client';
import { customers, orders } from '../schema';
import { contains, countWhere, paging, statusWhere, toPage, type ListParams } from './common';

/** Pedidos válidos (ativos e não cancelados) agregados por cliente. */
function orderStats(tx: Tx, tenantId: string) {
  return tx
    .select({
      customerId: orders.customerId,
      orders: count().as('orders'),
      spent: sum(orders.totalCents).as('spent'),
      lastOrderAt: max(orders.createdAt).as('last_order_at'),
    })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.status, true), ne(orders.stage, 'CANCELADO')))
    .groupBy(orders.customerId)
    .as('stats');
}

export async function listCustomers(tx: Tx, tenantId: string, params: ListParams) {
  const { page, pageSize, offset } = paging(params);
  const digits = params.q?.replace(/\D/g, '');
  const where = and(
    eq(customers.tenantId, tenantId),
    statusWhere(customers.status, params.status),
    params.q
      ? or(ilike(customers.name, contains(params.q)), digits ? ilike(customers.phone, contains(digits)) : undefined)
      : undefined,
  );
  const stats = orderStats(tx, tenantId);
  const rows = await tx
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      neighborhood: customers.neighborhood,
      status: customers.status,
      orders: sql<number>`coalesce(${stats.orders}, 0)`.mapWith(Number),
      spentCents: sql<number>`coalesce(${stats.spent}, 0)`.mapWith(Number),
      lastOrderAt: stats.lastOrderAt,
    })
    .from(customers)
    .leftJoin(stats, eq(stats.customerId, customers.id))
    .where(where)
    .orderBy(asc(customers.name))
    .limit(pageSize)
    .offset(offset);
  return toPage(rows, await countWhere(tx, customers, where), page, pageSize);
}

export async function getCustomer(tx: Tx, tenantId: string, id: string) {
  const [row] = await tx.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, id)));
  if (!row) return null;
  const [stats] = await tx
    .select({ orders: count(), spent: sum(orders.totalCents), lastOrderAt: max(orders.createdAt) })
    .from(orders)
    .where(and(eq(orders.customerId, id), eq(orders.status, true), ne(orders.stage, 'CANCELADO')));
  return {
    ...row,
    stats: { orders: stats?.orders ?? 0, spentCents: Number(stats?.spent ?? 0), lastOrderAt: stats?.lastOrderAt ?? null },
  };
}

export function listCustomerOrders(tx: Tx, tenantId: string, customerId: string, limit = 50) {
  return tx
    .select({
      id: orders.id,
      code: orders.code,
      type: orders.type,
      stage: orders.stage,
      totalCents: orders.totalCents,
      createdAt: orders.createdAt,
      scheduledAt: orders.scheduledAt,
      status: orders.status,
    })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.customerId, customerId)))
    .orderBy(desc(orders.createdAt))
    .limit(limit);
}

/** Impede dois clientes ativos com o mesmo telefone na unidade. */
async function assertPhoneFree(tx: Tx, tenantId: string, phone: string, exceptId?: string) {
  const [other] = await tx
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(
      and(
        eq(customers.tenantId, tenantId),
        eq(customers.phone, phone),
        eq(customers.status, true),
        exceptId ? ne(customers.id, exceptId) : undefined,
      ),
    );
  if (other) throw new DomainError(`O telefone ${formatBrPhone(phone)} já está cadastrado para ${other.name}.`);
}

export async function createCustomer(tx: Tx, tenantId: string, input: CustomerInput) {
  await assertPhoneFree(tx, tenantId, input.phone);
  const [row] = await tx.insert(customers).values({ ...input, tenantId }).returning();
  return row!;
}

export async function updateCustomer(tx: Tx, tenantId: string, id: string, input: CustomerInput) {
  await assertPhoneFree(tx, tenantId, input.phone, id);
  const [row] = await tx
    .update(customers)
    .set(input)
    .where(and(eq(customers.tenantId, tenantId), eq(customers.id, id)))
    .returning();
  return row ?? null;
}

export async function setCustomerStatus(tx: Tx, tenantId: string, id: string, status: boolean) {
  if (status) {
    const [row] = await tx.select({ phone: customers.phone }).from(customers).where(eq(customers.id, id));
    if (row) await assertPhoneFree(tx, tenantId, row.phone, id);
  }
  const [row] = await tx
    .update(customers)
    .set({ status })
    .where(and(eq(customers.tenantId, tenantId), eq(customers.id, id)))
    .returning();
  return row ?? null;
}
