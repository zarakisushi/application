import { DomainError, todayInZone, type CouponInput } from '@zaraki/core';
import { and, asc, count, desc, eq, ilike, isNotNull, ne, or, sql, sum, type SQL } from 'drizzle-orm';
import type { Tx } from '../client';
import { coupons, customers, orders } from '../schema';
import { contains, paging, statusWhere, toPage, type ListParams } from './common';

export type Coupon = typeof coupons.$inferSelect;

/** Filtro da lista: válidos agora, desativados, esgotados, expirados ou todos. */
export type CouponState = 'todos' | 'validos' | 'inativos' | 'esgotados' | 'expirados';

/** Usos de cada cupom: pedidos ativos e não cancelados (cancelar devolve o uso). */
function usage(tx: Tx) {
  return tx
    .select({
      couponId: orders.couponId,
      uses: count().as('uses'),
      discount: sum(orders.discountCents).as('discount'),
      revenue: sum(orders.totalCents).as('revenue'),
    })
    .from(orders)
    .where(and(isNotNull(orders.couponId), eq(orders.status, true), ne(orders.stage, 'CANCELADO')))
    .groupBy(orders.couponId)
    .as('usage');
}

export async function listCoupons(tx: Tx, tenantId: string, params: ListParams & { state?: CouponState; timezone: string }) {
  const { page, pageSize, offset } = paging(params);
  const u = usage(tx);
  const uses = sql<number>`coalesce(${u.uses}, 0)`;
  const today = todayInZone(params.timezone);
  const notExpired = sql`(${coupons.endsAt} is null or ${coupons.endsAt} >= ${today}::date)`;
  const started = sql`(${coupons.startsAt} is null or ${coupons.startsAt} <= ${today}::date)`;
  const notUsedUp = sql`(${coupons.maxUses} is null or ${uses} < ${coupons.maxUses})`;
  const stateWhere: Record<CouponState, SQL | undefined> = {
    todos: undefined,
    validos: and(eq(coupons.active, true), notExpired, started, notUsedUp),
    inativos: eq(coupons.active, false),
    esgotados: sql`(${coupons.maxUses} is not null and ${uses} >= ${coupons.maxUses})`,
    expirados: sql`(${coupons.endsAt} is not null and ${coupons.endsAt} < ${today}::date)`,
  };
  const where = and(
    eq(coupons.tenantId, tenantId),
    statusWhere(coupons.status, params.status),
    stateWhere[params.state ?? 'todos'],
    params.q ? or(ilike(coupons.code, contains(params.q)), ilike(coupons.description, contains(params.q))) : undefined,
  );
  const base = tx
    .select({ coupon: coupons, uses: uses.mapWith(Number) })
    .from(coupons)
    .leftJoin(u, eq(u.couponId, coupons.id))
    .where(where);
  const rows = await base.orderBy(desc(coupons.active), asc(coupons.code)).limit(pageSize).offset(offset);
  const [total] = await tx.select({ n: count() }).from(coupons).leftJoin(u, eq(u.couponId, coupons.id)).where(where);
  return toPage(
    rows.map((r) => ({ ...r.coupon, uses: r.uses })),
    total?.n ?? 0,
    page,
    pageSize,
  );
}

export async function getCoupon(tx: Tx, tenantId: string, id: string) {
  const [row] = await tx.select().from(coupons).where(and(eq(coupons.tenantId, tenantId), eq(coupons.id, id)));
  if (!row) return null;
  const [stats] = await tx
    .select({ uses: count(), discount: sum(orders.discountCents), revenue: sum(orders.totalCents) })
    .from(orders)
    .where(and(eq(orders.couponId, id), eq(orders.status, true), ne(orders.stage, 'CANCELADO')));
  return {
    ...row,
    stats: { uses: stats?.uses ?? 0, discountCents: Number(stats?.discount ?? 0), revenueCents: Number(stats?.revenue ?? 0) },
  };
}

/** Pedidos que usaram o cupom (inclusive cancelados e excluídos, para o histórico). */
export function listCouponOrders(tx: Tx, tenantId: string, couponId: string, limit = 100) {
  return tx
    .select({
      id: orders.id,
      code: orders.code,
      type: orders.type,
      stage: orders.stage,
      status: orders.status,
      discountCents: orders.discountCents,
      totalCents: orders.totalCents,
      createdAt: orders.createdAt,
      customerName: customers.name,
    })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(and(eq(orders.tenantId, tenantId), eq(orders.couponId, couponId)))
    .orderBy(desc(orders.createdAt))
    .limit(limit);
}

async function assertCodeFree(tx: Tx, tenantId: string, code: string, exceptId?: string) {
  const [other] = await tx
    .select({ id: coupons.id })
    .from(coupons)
    .where(and(eq(coupons.tenantId, tenantId), eq(coupons.code, code), eq(coupons.status, true), exceptId ? ne(coupons.id, exceptId) : undefined));
  if (other) throw new DomainError(`Já existe um cupom com o código ${code}.`);
}

export async function createCoupon(tx: Tx, tenantId: string, input: CouponInput) {
  await assertCodeFree(tx, tenantId, input.code);
  const [row] = await tx.insert(coupons).values({ ...input, tenantId }).returning();
  return row!;
}

export async function updateCoupon(tx: Tx, tenantId: string, id: string, input: CouponInput) {
  await assertCodeFree(tx, tenantId, input.code, id);
  const [row] = await tx
    .update(coupons)
    .set(input)
    .where(and(eq(coupons.tenantId, tenantId), eq(coupons.id, id)))
    .returning();
  return row ?? null;
}

/** Liga/desliga o cupom (flag de ativação, independente da exclusão lógica). */
export async function setCouponActive(tx: Tx, tenantId: string, id: string, active: boolean) {
  const [row] = await tx
    .update(coupons)
    .set({ active })
    .where(and(eq(coupons.tenantId, tenantId), eq(coupons.id, id), eq(coupons.status, true)))
    .returning();
  if (!row) throw new DomainError('Cupom não encontrado.');
  return row;
}

export async function setCouponStatus(tx: Tx, tenantId: string, id: string, status: boolean) {
  if (status) {
    const [row] = await tx.select({ code: coupons.code }).from(coupons).where(eq(coupons.id, id));
    if (row) await assertCodeFree(tx, tenantId, row.code, id);
  }
  const [row] = await tx
    .update(coupons)
    .set({ status })
    .where(and(eq(coupons.tenantId, tenantId), eq(coupons.id, id)))
    .returning();
  return row ?? null;
}
