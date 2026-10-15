import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { Tx } from './client';
import { auditLogs, calendarSyncJobs, customers, orderItems, orders, tenants } from './schema';

export type CalendarJob = typeof calendarSyncJobs.$inferSelect;

/**
 * Ordem total entre jobs: (created_at, id), comparada no banco. O horário em JS perde os
 * microssegundos e jobs da mesma transação têm o mesmo created_at; o id desempata.
 */
const position = (jobId: string) =>
  sql`(select ${calendarSyncJobs.createdAt}, ${calendarSyncJobs.id} from ${calendarSyncJobs} where ${calendarSyncJobs.id} = ${jobId})`;
const after = (job: CalendarJob) => sql`(${calendarSyncJobs.createdAt}, ${calendarSyncJobs.id}) > ${position(job.id)}`;
const upTo = (job: CalendarJob) => sql`(${calendarSyncJobs.createdAt}, ${calendarSyncJobs.id}) <= ${position(job.id)}`;

/**
 * Reserva até `limit` jobs devidos. A reserva é um "aluguel": o job ganha uma tentativa e só volta
 * a ficar devido depois de `leaseMinutes` — se o processo cair no meio, outro retoma depois.
 * `skip locked` impede que dois processos (ex.: after() e cron) peguem o mesmo job.
 * Rode com contexto da Matriz (jobs de todas as unidades).
 */
export async function claimDueCalendarJobs(tx: Tx, limit = 20, leaseMinutes = 2): Promise<CalendarJob[]> {
  const due = await tx
    .select({ id: calendarSyncJobs.id })
    .from(calendarSyncJobs)
    .where(
      and(
        eq(calendarSyncJobs.state, 'PENDING'),
        eq(calendarSyncJobs.status, true),
        lte(calendarSyncJobs.runAfter, sql`now()`),
      ),
    )
    .orderBy(asc(calendarSyncJobs.createdAt), asc(calendarSyncJobs.id))
    .limit(limit)
    .for('update', { skipLocked: true });
  if (!due.length) return [];
  return tx
    .update(calendarSyncJobs)
    .set({
      attempts: sql`${calendarSyncJobs.attempts} + 1`,
      runAfter: sql`now() + make_interval(mins => ${leaseMinutes})`,
    })
    .where(inArray(calendarSyncJobs.id, due.map((d) => d.id)))
    .returning();
}

async function hasNewerPendingJob(tx: Tx, job: CalendarJob) {
  const [newer] = await tx
    .select({ id: calendarSyncJobs.id })
    .from(calendarSyncJobs)
    .where(
      and(
        eq(calendarSyncJobs.orderId, job.orderId),
        eq(calendarSyncJobs.state, 'PENDING'),
        after(job),
      ),
    )
    .limit(1);
  return !!newer;
}

/**
 * Dados do pedido para montar o evento, ou null se o job foi superado por um mais novo do mesmo
 * pedido (nesse caso ele é encerrado aqui: só a última alteração precisa ir para a agenda).
 */
export async function loadCalendarWork(tx: Tx, job: CalendarJob) {
  // Pode já ter sido encerrado por um job mais novo do mesmo pedido, processado antes neste lote
  // ou por outro processo: nesse caso não há nada a fazer.
  const [current] = await tx.select({ state: calendarSyncJobs.state }).from(calendarSyncJobs).where(eq(calendarSyncJobs.id, job.id));
  if (current?.state !== 'PENDING') return null;
  if (await hasNewerPendingJob(tx, job)) {
    await tx
      .update(calendarSyncJobs)
      .set({ state: 'DONE', lastError: 'substituído por alteração mais recente' })
      .where(eq(calendarSyncJobs.id, job.id));
    return null;
  }
  const [row] = await tx
    .select({ order: orders, customer: customers, tenant: tenants })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .innerJoin(tenants, eq(tenants.id, orders.tenantId))
    .where(eq(orders.id, job.orderId));
  if (!row) return null;
  const items = await tx
    .select({ productName: orderItems.productName, qty: orderItems.qty })
    .from(orderItems)
    .where(and(eq(orderItems.orderId, job.orderId), eq(orderItems.status, true)))
    .orderBy(asc(orderItems.productName));
  return { ...row, items };
}

/**
 * Registra o resultado na agenda: encerra este job e os anteriores do mesmo pedido e atualiza o
 * selo do pedido (a não ser que já exista uma alteração mais nova aguardando). Rode com o contexto da unidade.
 */
export async function recordCalendarSuccess(tx: Tx, job: CalendarJob, result: { eventId: string; onCalendar: boolean }) {
  await tx
    .update(calendarSyncJobs)
    .set({ state: 'DONE', lastError: null })
    .where(
      and(
        eq(calendarSyncJobs.orderId, job.orderId),
        eq(calendarSyncJobs.state, 'PENDING'),
        upTo(job),
      ),
    );
  if (await hasNewerPendingJob(tx, job)) return;
  await tx
    .update(orders)
    .set({
      googleEventId: result.onCalendar ? result.eventId : null,
      calendarSyncState: result.onCalendar ? 'SINCRONIZADO' : 'NAO_APLICA',
    })
    .where(eq(orders.id, job.orderId));
}

/** Espera antes da próxima tentativa: 2, 4, 8... minutos, no máximo 6 horas. */
export const calendarBackoffMinutes = (attempts: number) => Math.min(2 ** attempts, 360);

/**
 * Registra a falha. Até `maxAttempts`, o job volta para a fila com espera progressiva; depois disso
 * fica FAILED, o pedido ganha o selo "Agenda: falhou" e a falha entra na auditoria.
 */
export async function recordCalendarFailure(tx: Tx, job: CalendarJob, error: string, maxAttempts = 8) {
  const message = error.slice(0, 500);
  if (job.attempts < maxAttempts) {
    await tx
      .update(calendarSyncJobs)
      .set({ lastError: message, runAfter: sql`now() + make_interval(mins => ${calendarBackoffMinutes(job.attempts)})` })
      .where(eq(calendarSyncJobs.id, job.id));
    return { gaveUp: false };
  }
  await tx.update(calendarSyncJobs).set({ state: 'FAILED', lastError: message }).where(eq(calendarSyncJobs.id, job.id));
  if (!(await hasNewerPendingJob(tx, job))) {
    await tx.update(orders).set({ calendarSyncState: 'FALHA' }).where(eq(orders.id, job.orderId));
  }
  await tx.insert(auditLogs).values({
    tenantId: job.tenantId,
    actorLabel: 'agenda',
    action: 'CALENDAR_SYNC_FAILED',
    entity: 'orders',
    entityId: job.orderId,
    after: { error: message, attempts: job.attempts },
  });
  return { gaveUp: true };
}

/** Última tentativa de sincronização do pedido (para mostrar o erro no painel). */
export async function getLatestCalendarJob(tx: Tx, orderId: string) {
  const [job] = await tx
    .select()
    .from(calendarSyncJobs)
    .where(eq(calendarSyncJobs.orderId, orderId))
    .orderBy(desc(calendarSyncJobs.createdAt))
    .limit(1);
  return job ?? null;
}
