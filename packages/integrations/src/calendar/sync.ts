import { isScheduled } from '@zaraki/core';
import {
  claimDueCalendarJobs,
  loadCalendarWork,
  recordCalendarFailure,
  recordCalendarSuccess,
  withContext,
  type Database,
} from '@zaraki/db';
import { buildCalendarEvent, eventIdForOrder } from './event';
import type { CalendarClient } from './types';

export type CalendarSyncOptions = {
  db: Database;
  client: CalendarClient;
  /** Agenda padrão da rede (GOOGLE_CALENDAR_ID); cada unidade pode ter a sua (tenants.calendar_id). */
  defaultCalendarId?: string;
  adminBaseUrl?: string;
  limit?: number;
  maxAttempts?: number;
};

export type CalendarSyncSummary = { synced: number; removed: number; failed: number; superseded: number };

/**
 * Processa a fila de sincronização com a Google Agenda. Cada job significa "deixe a agenda igual ao
 * pedido agora": se o pedido está ativo, agendado e não cancelado, o evento é criado/atualizado;
 * caso contrário, removido. Pode rodar em paralelo (after() + cron) com segurança.
 */
export async function syncCalendar(opts: CalendarSyncOptions): Promise<CalendarSyncSummary> {
  const summary: CalendarSyncSummary = { synced: 0, removed: 0, failed: 0, superseded: 0 };
  const system = { platformAdmin: true, actorLabel: 'agenda' };
  const jobs = await withContext(system, (tx) => claimDueCalendarJobs(tx, opts.limit ?? 20), opts.db);

  for (const job of jobs) {
    const work = await withContext(system, (tx) => loadCalendarWork(tx, job), opts.db);
    const tenantCtx = { tenantId: job.tenantId, actorLabel: 'agenda' };
    if (!work) {
      summary.superseded++;
      continue;
    }

    const { order, customer, tenant, items } = work;
    const eventId = eventIdForOrder(order.id);
    const onCalendar = order.status && isScheduled(order.type) && order.stage !== 'CANCELADO' && !!order.scheduledAt;
    const calendarId = tenant.calendarId || opts.defaultCalendarId;

    try {
      if (!calendarId) throw new Error('Agenda não configurada (GOOGLE_CALENDAR_ID ou agenda da unidade).');
      if (onCalendar) {
        await opts.client.upsertEvent(
          calendarId,
          buildCalendarEvent({
            order: { ...order, scheduledAt: order.scheduledAt! },
            customer,
            items,
            timezone: tenant.timezone,
            adminBaseUrl: opts.adminBaseUrl,
          }),
        );
      } else {
        await opts.client.deleteEvent(calendarId, eventId);
      }
    } catch (error) {
      summary.failed++;
      const message = error instanceof Error ? error.message : String(error);
      await withContext(tenantCtx, (tx) => recordCalendarFailure(tx, job, message, opts.maxAttempts), opts.db);
      continue;
    }

    await withContext(tenantCtx, (tx) => recordCalendarSuccess(tx, job, { eventId, onCalendar }), opts.db);
    if (onCalendar) summary.synced++;
    else summary.removed++;
  }
  return summary;
}
