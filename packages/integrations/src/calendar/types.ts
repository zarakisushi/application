/** Evento no formato da API do Google Calendar (subconjunto usado pela Zaraki). */
export type CalendarEvent = {
  /** Derivado do id do pedido: reenvios atualizam o mesmo evento, nunca duplicam. */
  id: string;
  summary: string;
  description: string;
  location?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  colorId?: string;
  extendedProperties?: { private: Record<string, string> };
};

export interface CalendarClient {
  /** Cria ou atualiza o evento (idempotente pelo `event.id`). */
  upsertEvent(calendarId: string, event: CalendarEvent): Promise<void>;
  /** Remove o evento; se ele já não existir, não é erro. */
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
}

export class CalendarApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'CalendarApiError';
  }
}
