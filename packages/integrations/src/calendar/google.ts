import { createSign } from 'node:crypto';
import { CalendarApiError, type CalendarClient, type CalendarEvent } from './types';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

export type GoogleCredentials = {
  /** E-mail da conta de serviço (…@….iam.gserviceaccount.com). */
  clientEmail: string;
  /** Chave privada PEM da conta de serviço (aceita "\n" escapado, como vem de variáveis de ambiente). */
  privateKey: string;
  fetch?: typeof fetch;
};

const b64url = (data: string | Buffer) => Buffer.from(data).toString('base64url');

/**
 * Cliente da API do Google Calendar autenticado por conta de serviço (JWT assinado com a chave
 * privada, sem SDK). A agenda de destino precisa estar compartilhada com o e-mail da conta de
 * serviço com permissão "Fazer alterações nos eventos".
 */
export function googleCalendarClient({ clientEmail, privateKey, fetch: http = fetch }: GoogleCredentials): CalendarClient {
  const key = privateKey.replace(/\\n/g, '\n');
  let cached: { token: string; expiresAt: number } | null = null;

  async function accessToken() {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(
      JSON.stringify({ iss: clientEmail, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }),
    )}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(key);
    const res = await http(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${b64url(signature)}`,
      }),
    });
    if (!res.ok) throw new CalendarApiError(res.status, `Falha na autenticação com o Google (${res.status}): ${await res.text()}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return cached.token;
  }

  async function call(method: string, path: string, body?: unknown) {
    const res = await http(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res;
  }

  const eventsPath = (calendarId: string) => `/calendars/${encodeURIComponent(calendarId)}/events`;

  async function fail(res: Response, what: string): Promise<never> {
    throw new CalendarApiError(res.status, `Google Agenda recusou ${what} (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }

  return {
    async upsertEvent(calendarId, event: CalendarEvent) {
      const { id, ...fields } = event;
      // 1) Atualiza (também "ressuscita" um evento cancelado com o mesmo id).
      const patch = await call('PATCH', `${eventsPath(calendarId)}/${id}`, { ...fields, status: 'confirmed' });
      if (patch.ok) return;
      if (patch.status !== 404) return fail(patch, 'a atualização do evento');
      // 2) Não existe: cria com o id determinístico.
      const insert = await call('POST', eventsPath(calendarId), event);
      if (insert.ok) return;
      if (insert.status === 409) {
        // Criado por outra tentativa nesse meio-tempo: atualiza.
        const retry = await call('PATCH', `${eventsPath(calendarId)}/${id}`, { ...fields, status: 'confirmed' });
        if (retry.ok) return;
        return fail(retry, 'a atualização do evento');
      }
      return fail(insert, 'a criação do evento');
    },

    async deleteEvent(calendarId, eventId) {
      const res = await call('DELETE', `${eventsPath(calendarId)}/${eventId}`);
      if (res.ok || res.status === 404 || res.status === 410) return;
      return fail(res, 'a remoção do evento');
    },
  };
}
