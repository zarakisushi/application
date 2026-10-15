import { adminOrderSchema } from '@zaraki/core';
import {
  changeOrderStage,
  createDb,
  createOrder,
  enqueueCalendarSync,
  setOrderStatus,
  withContext,
} from '@zaraki/db';
import { auditLogs, calendarSyncJobs, orders, products, tenants } from '@zaraki/db/schema';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { eventIdForOrder, fakeCalendarClient, syncCalendar } from '../src';

const db = createDb(inject('appUrl'), 10);
afterAll(() => db.$client.end());

let tenant: typeof tenants.$inferSelect;
let productId: string;
const ctx = () => ({ tenantId: tenant.id, actorLabel: 'teste' });
const CALENDAR = 'zarakisushigo@gmail.com';

beforeAll(async () => {
  [tenant] = (await withContext(
    { platformAdmin: true },
    (tx) => tx.insert(tenants).values({ name: 'Agenda', slug: `ag-${randomUUID()}` }).returning(),
    db,
  )) as [typeof tenants.$inferSelect];
  const [p] = await withContext(
    ctx(),
    (tx) => tx.insert(products).values({ tenantId: tenant.id, name: 'Salmão', slug: 'salmao', priceCents: 5000 }).returning(),
    db,
  );
  productId = p!.id;
});

async function newFesta(time = '20:00') {
  const input = adminOrderSchema.parse({
    type: 'FESTA',
    name: 'Ana',
    phone: `62 9${Math.floor(1e7 + Math.random() * 9e7)}`,
    source: 'WHATSAPP',
    date: '2030-03-15',
    time,
    guests: '20',
    items: [{ productId, qty: 3 }],
  });
  const { order } = await withContext(ctx(), (tx) => createOrder(tx, tenant, input, { source: 'WHATSAPP' }), db);
  return order;
}

const orderRow = async (id: string) =>
  (await withContext(ctx(), (tx) => tx.select().from(orders).where(eq(orders.id, id)), db))[0]!;
const jobsOf = (id: string) =>
  withContext(ctx(), (tx) => tx.select().from(calendarSyncJobs).where(eq(calendarSyncJobs.orderId, id)), db);
/** Faz os jobs pendentes ficarem devidos agora (simula a passagem do tempo da espera entre tentativas). */
const makeDue = () =>
  withContext(ctx(), (tx) => tx.update(calendarSyncJobs).set({ runAfter: new Date(0) }).where(eq(calendarSyncJobs.state, 'PENDING')), db);

describe('sincronização com a Google Agenda', () => {
  it('cria o evento da festa e marca o pedido como "Na agenda"', async () => {
    const order = await newFesta();
    const client = fakeCalendarClient();
    const summary = await syncCalendar({ db, client, defaultCalendarId: CALENDAR });

    expect(summary.synced).toBeGreaterThanOrEqual(1);
    const event = client.events.get(eventIdForOrder(order.id))!;
    expect(event).toMatchObject({ calendarId: CALENDAR, summary: 'Festa · Ana · 3 tubos' });
    expect(await orderRow(order.id)).toMatchObject({ calendarSyncState: 'SINCRONIZADO', googleEventId: eventIdForOrder(order.id) });
    expect((await jobsOf(order.id)).every((j) => j.state === 'DONE')).toBe(true);
  });

  it('cancelar remove da agenda; restaurar a etapa recoloca', async () => {
    const order = await newFesta();
    const client = fakeCalendarClient();
    await syncCalendar({ db, client, defaultCalendarId: CALENDAR });

    await withContext(ctx(), (tx) => changeOrderStage(tx, tenant.id, order.id, 'CANCELADO', 'Chuva'), db);
    await syncCalendar({ db, client, defaultCalendarId: CALENDAR });
    expect(client.events.has(eventIdForOrder(order.id))).toBe(false);
    expect(await orderRow(order.id)).toMatchObject({ calendarSyncState: 'NAO_APLICA', googleEventId: null });

    await withContext(ctx(), (tx) => changeOrderStage(tx, tenant.id, order.id, 'CONFIRMADO'), db);
    await syncCalendar({ db, client, defaultCalendarId: CALENDAR });
    expect(client.events.has(eventIdForOrder(order.id))).toBe(true);
  });

  it('várias alterações seguidas viram uma única ida à agenda', async () => {
    const order = await newFesta();
    await withContext(ctx(), async (tx) => {
      await setOrderStatus(tx, tenant.id, order.id, false);
      await setOrderStatus(tx, tenant.id, order.id, true);
      await enqueueCalendarSync(tx, order, 'UPSERT');
    }, db);

    let calls = 0;
    const client = fakeCalendarClient({ fail: () => (calls++, null) });
    const summary = await syncCalendar({ db, client, defaultCalendarId: CALENDAR });
    expect(summary).toMatchObject({ synced: 1, superseded: 3 });
    expect(calls).toBe(1);
  });

  it('falha volta para a fila com espera; esgotadas as tentativas, marca "falhou" e audita', async () => {
    const order = await newFesta();
    const broken = fakeCalendarClient({ fail: () => 'Google fora do ar' });

    await syncCalendar({ db, client: broken, defaultCalendarId: CALENDAR, maxAttempts: 2 });
    let [job] = await jobsOf(order.id);
    expect(job).toMatchObject({ state: 'PENDING', attempts: 1, lastError: 'Google fora do ar' });
    expect(job!.runAfter.getTime()).toBeGreaterThan(Date.now()); // espera antes de tentar de novo
    expect((await orderRow(order.id)).calendarSyncState).toBe('PENDENTE');

    await makeDue();
    await syncCalendar({ db, client: broken, defaultCalendarId: CALENDAR, maxAttempts: 2 });
    [job] = await jobsOf(order.id);
    expect(job).toMatchObject({ state: 'FAILED', attempts: 2 });
    expect((await orderRow(order.id)).calendarSyncState).toBe('FALHA');

    const audit = await withContext(
      ctx(),
      (tx) => tx.select().from(auditLogs).where(and(eq(auditLogs.action, 'CALENDAR_SYNC_FAILED'), eq(auditLogs.entityId, order.id))),
      db,
    );
    expect(audit).toHaveLength(1);

    // Uma nova tentativa manual (novo job) funciona quando o Google volta.
    await withContext(ctx(), (tx) => enqueueCalendarSync(tx, order, 'UPSERT'), db);
    await syncCalendar({ db, client: fakeCalendarClient(), defaultCalendarId: CALENDAR });
    expect((await orderRow(order.id)).calendarSyncState).toBe('SINCRONIZADO');
  });

  it('sem agenda configurada, registra o motivo em vez de fingir que sincronizou', async () => {
    const order = await newFesta();
    await syncCalendar({ db, client: fakeCalendarClient() });
    const [job] = await jobsOf(order.id);
    expect(job!.lastError).toContain('Agenda não configurada');
    expect((await orderRow(order.id)).calendarSyncState).toBe('PENDENTE');
    await makeDue();
    await syncCalendar({ db, client: fakeCalendarClient(), defaultCalendarId: CALENDAR }); // limpa para os próximos testes
  });

  it('dois processos ao mesmo tempo não enviam o mesmo pedido duas vezes', async () => {
    const created = await Promise.all(Array.from({ length: 10 }, (_, i) => newFesta(`1${i % 10}:00`)));
    const seen: string[] = [];
    const client = fakeCalendarClient();
    const upsert = client.upsertEvent.bind(client);
    client.upsertEvent = async (calendarId, event) => {
      seen.push(event.id);
      await new Promise((r) => setTimeout(r, 20));
      return upsert(calendarId, event);
    };
    await Promise.all([
      syncCalendar({ db, client, defaultCalendarId: CALENDAR }),
      syncCalendar({ db, client, defaultCalendarId: CALENDAR }),
    ]);
    const ids = created.map((o) => eventIdForOrder(o.id));
    expect(seen.filter((id) => ids.includes(id)).sort()).toEqual([...ids].sort());
  });
});
