import { and, desc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import type { Tx } from '../client';
import { customers, financeEntries, orders, tenants } from '../schema';
import { accountForMethod, systemCategoryId } from './setup';

/**
 * Mantém o lançamento de venda de um pedido em dia. Roda na mesma transação que altera o pedido:
 * - pedido ativo, pago, não cancelado e com total > 0 → um lançamento de ENTRADA (cria ou atualiza);
 * - caso contrário → o lançamento existente é estornado (exclusão lógica, fica na auditoria).
 * A data do pagamento é a de `paid_at` no fuso da unidade; a competência é a data do pedido
 * (a data marcada, nas encomendas e festas).
 */
export async function syncOrderFinance(tx: Tx, orderId: string) {
  const [row] = await tx
    .select({
      order: orders,
      customerName: customers.name,
      paidOn: sql<string>`to_char((coalesce(${orders.paidAt}, ${orders.updatedAt}) at time zone ${tenants.timezone})::date, 'YYYY-MM-DD')`,
      competence: sql<string>`to_char((coalesce(${orders.scheduledAt}, ${orders.createdAt}) at time zone ${tenants.timezone})::date, 'YYYY-MM-DD')`,
    })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .innerJoin(tenants, eq(tenants.id, orders.tenantId))
    .where(eq(orders.id, orderId));
  if (!row) return null;
  const { order } = row;

  const [existing] = await tx
    .select()
    .from(financeEntries)
    .where(and(eq(financeEntries.orderId, orderId), eq(financeEntries.status, true)));

  const counts = order.status && order.paid && order.stage !== 'CANCELADO' && order.totalCents > 0;
  if (!counts) {
    if (existing) await tx.update(financeEntries).set({ status: false }).where(eq(financeEntries.id, existing.id));
    return null;
  }

  const accountId =
    existing && existing.paymentMethod === order.paymentMethod ? existing.accountId! : await accountForMethod(tx, order.tenantId, order.paymentMethod);
  const values = {
    direction: 'ENTRADA' as const,
    description: `Pedido ${order.code} · ${row.customerName}`,
    amountCents: order.totalCents,
    accountId,
    competenceDate: row.competence,
    dueDate: row.paidOn,
    paidOn: row.paidOn,
    paymentMethod: order.paymentMethod,
  };

  if (!existing) {
    const categoryId = await systemCategoryId(tx, order.tenantId, 'VENDAS');
    const [created] = await tx
      .insert(financeEntries)
      .values({ ...values, tenantId: order.tenantId, categoryId, origin: 'PEDIDO', orderId, counterparty: row.customerName })
      .returning();
    return created!;
  }
  // Só grava quando algo mudou (cada gravação vira uma linha na auditoria).
  const changed = (Object.keys(values) as (keyof typeof values)[]).some((k) => existing[k] !== values[k]);
  if (!changed) return existing;
  const [updated] = await tx.update(financeEntries).set(values).where(eq(financeEntries.id, existing.id)).returning();
  return updated!;
}

/** Cria os lançamentos que faltam para pedidos já pagos (rodado depois das migrations; idempotente). */
export async function backfillOrderFinance(tx: Tx) {
  const pending = await tx
    .select({ id: orders.id })
    .from(orders)
    .leftJoin(financeEntries, and(eq(financeEntries.orderId, orders.id), eq(financeEntries.status, true)))
    .where(and(eq(orders.status, true), eq(orders.paid, true), ne(orders.stage, 'CANCELADO'), isNull(financeEntries.id)));
  for (const o of pending) await syncOrderFinance(tx, o.id);
  return pending.length;
}

/** Pedidos entregues e ainda não pagos: entram em "A receber". */
export function listUnpaidDeliveredOrders(tx: Tx, tenantId: string, limit = 100) {
  return tx
    .select({
      id: orders.id,
      code: orders.code,
      type: orders.type,
      totalCents: orders.totalCents,
      paymentMethod: orders.paymentMethod,
      customerName: customers.name,
      date: sql<string>`to_char((coalesce(${orders.scheduledAt}, ${orders.createdAt}) at time zone ${tenants.timezone})::date, 'YYYY-MM-DD')`,
    })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .innerJoin(tenants, eq(tenants.id, orders.tenantId))
    .where(
      and(
        eq(orders.tenantId, tenantId),
        eq(orders.status, true),
        eq(orders.stage, 'ENTREGUE'),
        eq(orders.paid, false),
        isNotNull(orders.totalCents),
        sql`${orders.totalCents} > 0`,
      ),
    )
    .orderBy(desc(sql`coalesce(${orders.scheduledAt}, ${orders.createdAt})`))
    .limit(limit);
}
