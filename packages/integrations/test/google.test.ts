import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildCalendarEvent, CalendarApiError, eventIdForOrder, googleCalendarClient } from '../src';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const EMAIL = 'zaraki-agenda@projeto.iam.gserviceaccount.com';

type Call = { method: string; url: string; body?: string };

/** API do Google simulada: responde na ordem dada e registra as chamadas. */
function fakeGoogle(responses: Record<string, number[]>) {
  const calls: Call[] = [];
  const counters: Record<string, number> = {};
  const http = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? String(init.body) : undefined });
    if (url.includes('oauth2.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 'token-123', expires_in: 3600 }), { status: 200 });
    }
    const queue = responses[method] ?? [200];
    const i = (counters[method] = (counters[method] ?? -1) + 1);
    const status = queue[Math.min(i, queue.length - 1)]!;
    return new Response(status >= 400 ? 'erro simulado' : '{}', { status });
  };
  return { calls, http: http as typeof fetch };
}

const ORDER_ID = '0c9a3b2e-7f41-4d2a-9b1c-5e6f7a8b9c0d';
const event = buildCalendarEvent({
  order: {
    id: ORDER_ID,
    code: 'ZK-000042',
    type: 'FESTA',
    scheduledAt: new Date('2026-10-24T22:30:00Z'),
    guests: 40,
    neighborhood: 'Setor Bueno',
    address: 'Rua T-30, 100',
    notes: 'Portão azul',
    totalCents: 26000,
    paid: true,
  },
  customer: { name: 'Ana Souza', phone: '+5562981092799' },
  items: [
    { productName: 'Uramaki Especial', qty: 1 },
    { productName: 'Uramaki de Salmão', qty: 4 },
  ],
  timezone: 'America/Sao_Paulo',
  adminBaseUrl: 'https://zaraki.com.br/',
});

describe('evento da agenda', () => {
  it('monta título, descrição, local, duração de 2h para festa e id aceito pelo Google', () => {
    expect(event.id).toBe(eventIdForOrder(ORDER_ID));
    expect(event.id).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(event.summary).toBe('Festa · Ana Souza · 5 tubos');
    expect(event.location).toBe('Rua T-30, 100 · Setor Bueno');
    expect(event.start).toEqual({ dateTime: '2026-10-24T22:30:00.000Z', timeZone: 'America/Sao_Paulo' });
    expect(event.end.dateTime).toBe('2026-10-25T00:30:00.000Z');
    expect(event.colorId).toBe('5');
    expect(event.description).toBe(
      [
        'Pedido ZK-000042 · Festa',
        'Cliente: Ana Souza · (62) 98109-2799',
        'Convidados: 40',
        '',
        '• 1x Uramaki Especial',
        '• 4x Uramaki de Salmão',
        'Total: R$ 260,00 (pago)',
        '\nObs: Portão azul',
        `\nAbrir no painel: https://zaraki.com.br/admin/encomendas/${ORDER_ID}`,
      ].join('\n'),
    );
  });
});

describe('cliente do Google Calendar', () => {
  it('autentica com JWT assinado pela conta de serviço e reaproveita o token', async () => {
    const g = fakeGoogle({ PATCH: [200] });
    const client = googleCalendarClient({ clientEmail: EMAIL, privateKey: PEM.replace(/\n/g, '\\n'), fetch: g.http });
    await client.upsertEvent('zarakisushigo@gmail.com', event);
    await client.upsertEvent('zarakisushigo@gmail.com', event);

    const tokenCalls = g.calls.filter((c) => c.url.includes('oauth2'));
    expect(tokenCalls).toHaveLength(1);
    const assertion = new URLSearchParams(tokenCalls[0]!.body).get('assertion')!;
    const [header, claims, signature] = assertion.split('.');
    const valid = createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature!, 'base64url'));
    expect(valid).toBe(true);
    expect(JSON.parse(Buffer.from(claims!, 'base64url').toString())).toMatchObject({
      iss: EMAIL,
      scope: 'https://www.googleapis.com/auth/calendar.events',
      aud: 'https://oauth2.googleapis.com/token',
    });

    const patch = g.calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url).toBe(`https://www.googleapis.com/calendar/v3/calendars/zarakisushigo%40gmail.com/events/${event.id}`);
    expect(JSON.parse(patch.body!)).toMatchObject({ status: 'confirmed', summary: event.summary });
  });

  it('cria o evento com o id do pedido quando ele ainda não existe', async () => {
    const g = fakeGoogle({ PATCH: [404], POST: [200] });
    await googleCalendarClient({ clientEmail: EMAIL, privateKey: PEM, fetch: g.http }).upsertEvent('agenda', event);
    const api = g.calls.filter((c) => !c.url.includes('oauth2')).map((c) => c.method);
    expect(api).toEqual(['PATCH', 'POST']);
    expect(JSON.parse(g.calls.find((c) => c.method === 'POST' && !c.url.includes('oauth2'))!.body!).id).toBe(event.id);
  });

  it('se outra tentativa criou o evento no meio-tempo (409), atualiza em vez de duplicar', async () => {
    const g = fakeGoogle({ PATCH: [404, 200], POST: [409] });
    await googleCalendarClient({ clientEmail: EMAIL, privateKey: PEM, fetch: g.http }).upsertEvent('agenda', event);
    expect(g.calls.filter((c) => !c.url.includes('oauth2')).map((c) => c.method)).toEqual(['PATCH', 'POST', 'PATCH']);
  });

  it('remover evento que já não existe não é erro; erro do Google é repassado', async () => {
    const gone = fakeGoogle({ DELETE: [410] });
    await expect(googleCalendarClient({ clientEmail: EMAIL, privateKey: PEM, fetch: gone.http }).deleteEvent('agenda', event.id)).resolves.toBeUndefined();

    const broken = fakeGoogle({ DELETE: [403] });
    const error = await googleCalendarClient({ clientEmail: EMAIL, privateKey: PEM, fetch: broken.http })
      .deleteEvent('agenda', event.id)
      .catch((e) => e);
    expect(error).toBeInstanceOf(CalendarApiError);
    expect(error.status).toBe(403);
  });
});
