import { and, count, eq, gte, lt, ne, sql } from 'drizzle-orm';
import type { Tx } from './client';
import { orders } from './schema';

/** Números rápidos da unidade do contexto para a página inicial do admin. */
export async function getOperationalSnapshot(tx: Tx, timezone: string) {
  const active = eq(orders.status, true);
  const startOfToday = sql`(date_trunc('day', now() at time zone ${timezone}) at time zone ${timezone})`;

  const [today] = await tx.select({ n: count() }).from(orders).where(and(active, gte(orders.createdAt, startOfToday)));
  const [awaiting] = await tx.select({ n: count() }).from(orders).where(and(active, eq(orders.stage, 'NOVO')));
  const [upcoming] = await tx
    .select({ n: count() })
    .from(orders)
    .where(
      and(
        active,
        ne(orders.type, 'DELIVERY'),
        ne(orders.stage, 'CANCELADO'),
        gte(orders.scheduledAt, sql`now()`),
        lt(orders.scheduledAt, sql`now() + interval '7 days'`),
      ),
    );

  return { ordersToday: today?.n ?? 0, awaitingConfirmation: awaiting?.n ?? 0, upcomingScheduled: upcoming?.n ?? 0 };
}
