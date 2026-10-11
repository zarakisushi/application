import type { CalendarClient, CalendarEvent } from './types';

/**
 * Agenda simulada em memória, para desenvolvimento offline e testes.
 * Só é usada quando pedida explicitamente (CALENDAR_DRIVER=fake).
 */
export function fakeCalendarClient(options: { fail?: () => string | null } = {}) {
  const events = new Map<string, CalendarEvent & { calendarId: string }>();
  const check = () => {
    const error = options.fail?.();
    if (error) throw new Error(error);
  };
  const client: CalendarClient & { events: typeof events } = {
    events,
    async upsertEvent(calendarId, event) {
      check();
      events.set(event.id, { ...event, calendarId });
    },
    async deleteEvent(_calendarId, eventId) {
      check();
      events.delete(eventId);
    },
  };
  return client;
}
