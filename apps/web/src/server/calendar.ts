import 'server-only';
import { getDb } from '@zaraki/db';
import { fakeCalendarClient, googleCalendarClient, syncCalendar, type CalendarClient } from '@zaraki/integrations';
import { after } from 'next/server';

const globalForCalendar = globalThis as unknown as { __zarakiCalendar?: CalendarClient | null; __zarakiCalendarWarned?: boolean };

/**
 * Cliente da agenda conforme o ambiente:
 * - credenciais da conta de serviço → Google Agenda real;
 * - CALENDAR_DRIVER=fake → agenda simulada (desenvolvimento offline e testes);
 * - nada configurado → null: os pedidos ficam "Agenda: pendente" até a configuração (nunca fingimos sincronizar).
 */
export function calendarClient(): CalendarClient | null {
  if (globalForCalendar.__zarakiCalendar !== undefined) return globalForCalendar.__zarakiCalendar;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  globalForCalendar.__zarakiCalendar =
    email && key
      ? googleCalendarClient({ clientEmail: email, privateKey: key })
      : process.env.CALENDAR_DRIVER === 'fake'
        ? fakeCalendarClient()
        : null;
  return globalForCalendar.__zarakiCalendar;
}

/** Processa a fila de sincronização agora. Retorna null se a agenda não estiver configurada. */
export async function runCalendarSync() {
  const client = calendarClient();
  if (!client) {
    if (!globalForCalendar.__zarakiCalendarWarned) {
      console.warn('[agenda] Google Agenda não configurada: encomendas ficam pendentes (veja docs/google-agenda.md)');
      globalForCalendar.__zarakiCalendarWarned = true;
    }
    return null;
  }
  return syncCalendar({
    db: getDb(),
    client,
    defaultCalendarId: process.env.GOOGLE_CALENDAR_ID,
    adminBaseUrl: process.env.BETTER_AUTH_URL,
  });
}

/** Agenda a sincronização para logo depois da resposta (não atrasa quem salvou o pedido). */
export function scheduleCalendarSync() {
  after(async () => {
    try {
      await runCalendarSync();
    } catch (error) {
      console.error('[agenda] falha ao sincronizar (o cron tenta de novo)', error);
    }
  });
}
