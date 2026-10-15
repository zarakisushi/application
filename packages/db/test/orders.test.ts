import { OrderError, publicOrderSchema, type PublicOrderInput } from '@zaraki/core';
import { asc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { countRecentOrdersFromIp, createDb, createOrder, listActiveMenu, withContext } from '../src';
import {
  calendarSyncJobs,
  customers,
  orderItems,
  orders,
  orderStageHistory,
  products,
  tenants,
} from '../src/schema';

const app = createDb(inject('appUrl'), 10);
afterAll(() => app.$client.end());

let tenant: typeof tenants.$inferSelect;
let salmao: typeof products.$inferSelect;
let especial: typeof products.$inferSelect;

beforeAll(async () => {
  [tenant] = (await withContext(
    { platformAdmin: true },
    (tx) => tx.insert(tenants).values({ name: 'Pedidos', slug: `p-${randomUUID()}`, orderCodePrefix: 'ZK' }).returning(),
    app,
  )) as [typeof tenants.$inferSelect];
  [salmao, especial] = (await withContext(
    { tenantId: tenant.id },
    (tx) =>
      tx
        .insert(products)
        .values([
          { tenantId: tenant.id, name: 'Salmão', slug: 'salmao', priceCents: 5000, costCents: 2100, sortOrder: 1 },
          { tenantId: tenant.id, name: 'Especial', slug: 'especial', priceCents: 6000, costCents: 2800, sortOrder: 2 },
        ])
        .returning(),
    app,
  )) as [typeof products.$inferSelect, typeof products.$inferSelect];
});

const NOW = new Date('2026-10-20T12:00:00Z');
const ctx = () => ({ tenantId: tenant.id, actorLabel: 'site', ip: '177.1.2.3' });

function place(input: Partial<PublicOrderInput>) {
  const parsed = publicOrderSchema.parse({
    type: 'DELIVERY',
    name: 'Ana',
    phone: '(62) 98109-2799',
    neighborhood: 'Setor Bueno',
    address: 'Rua T-30, 100',
    items: [{ productId: salmao.id, qty: 2 }],
    ...input,
  });
  return withContext(ctx(), (tx) => createOrder(tx, tenant, parsed, { source: 'SITE', now: NOW }), app);
}

describe('pedido do site', () => {
  it('grava pedido, itens com preço do cardápio, cliente e histórico', async () => {
    const r = await place({ items: [{ productId: salmao.id, qty: 2 }, { productId: especial.id, qty: 1 }] });

    expect(r.order).toMatchObject({
      code: 'ZK-000001',
      type: 'DELIVERY',
      stage: 'NOVO',
      source: 'SITE',
      subtotalCents: 16000,
      totalCents: 16000,
      calendarSyncState: 'NAO_APLICA',
      scheduledAt: null,
    });

    await withContext(ctx(), async (tx) => {
      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, r.order.id)).orderBy(asc(orderItems.unitPriceCents));
      expect(items.map((i) => [i.productName, i.qty, i.unitPriceCents, i.unitCostCents, i.lineTotalCents])).toEqual([
        ['Salmão', 2, 5000, 2100, 10000],
        ['Especial', 1, 6000, 2800, 6000],
      ]);
      const history = await tx.select().from(orderStageHistory).where(eq(orderStageHistory.orderId, r.order.id));
      expect(history).toMatchObject([{ fromStage: null, toStage: 'NOVO' }]);
      const jobs = await tx.select().from(calendarSyncJobs).where(eq(calendarSyncJobs.orderId, r.order.id));
      expect(jobs).toHaveLength(0);
    }, app);

    expect(r.customer).toMatchObject({ name: 'Ana', phone: '+5562981092799', neighborhood: 'Setor Bueno' });
  });

  it('numera os pedidos em sequência e reaproveita o cliente pelo telefone', async () => {
    const a = await place({ phone: '62 98888-0001' });
    const b = await place({ phone: '+55 (62) 98888-0001', name: 'Outro nome' });
    expect(Number(b.order.code.slice(3))).toBe(Number(a.order.code.slice(3)) + 1);
    expect(b.customer.id).toBe(a.customer.id);
    expect(b.customer.name).toBe('Ana'); // cadastro existente não é sobrescrito pelo site
  });

  it('festa: grava data no fuso da unidade, convidados e enfileira a agenda', async () => {
    const r = await place({ type: 'FESTA', date: '2026-10-24', time: '19:30', guests: 40, neighborhood: '', address: '' });
    expect(r.order.scheduledAt!.toISOString()).toBe('2026-10-24T22:30:00.000Z');
    expect(r.order.guests).toBe(40);
    expect(r.order.calendarSyncState).toBe('PENDENTE');

    const jobs = await withContext(ctx(), (tx) => tx.select().from(calendarSyncJobs).where(eq(calendarSyncJobs.orderId, r.order.id)), app);
    expect(jobs).toMatchObject([{ op: 'UPSERT', state: 'PENDING' }]);
  });

  it('recusa encomenda no passado', async () => {
    await expect(place({ type: 'ENCOMENDA', date: '2026-10-20', time: '08:00' })).rejects.toMatchObject({
      code: 'SCHEDULE_IN_PAST',
    });
  });

  it('recusa produto inativo e não grava nada (transação desfeita)', async () => {
    const before = await withContext(ctx(), (tx) => tx.select({ id: orders.id }).from(orders), app);
    const [inativo] = await withContext(
      ctx(),
      (tx) => tx.insert(products).values({ tenantId: tenant.id, name: 'Antigo', slug: `x-${randomUUID()}`, priceCents: 1, status: false }).returning(),
      app,
    );
    await expect(place({ phone: '62 97777-0000', items: [{ productId: inativo!.id, qty: 1 }] })).rejects.toBeInstanceOf(OrderError);

    const after = await withContext(ctx(), (tx) => tx.select({ id: orders.id }).from(orders), app);
    expect(after).toHaveLength(before.length);
    const c = await withContext(ctx(), (tx) => tx.select().from(customers).where(eq(customers.phone, '+5562977770000')), app);
    expect(c).toHaveLength(0);
  });

  it('cardápio do site lista só produtos ativos, na ordem definida', async () => {
    const menu = await withContext(ctx(), (tx) => listActiveMenu(tx), app);
    expect(menu.map((m) => m.name)).toEqual(['Salmão', 'Especial']);
  });

  it('conta os pedidos recentes por IP (base do limite anti-abuso)', async () => {
    const n = await withContext(ctx(), (tx) => countRecentOrdersFromIp(tx, '177.1.2.3', 10), app);
    expect(n).toBeGreaterThanOrEqual(4);
    const other = await withContext(ctx(), (tx) => countRecentOrdersFromIp(tx, '10.0.0.1', 10), app);
    expect(other).toBe(0);

    // Pedido lançado pela equipe no painel, da mesma rede, não conta para o limite do site.
    const before = await withContext(ctx(), (tx) => countRecentOrdersFromIp(tx, '177.1.2.3', 10), app);
    const panel = publicOrderSchema.parse({
      type: 'DELIVERY',
      name: 'Balcão',
      phone: '62 97777-5555',
      neighborhood: 'Centro',
      address: 'Rua 5',
      items: [{ productId: salmao.id, qty: 1 }],
    });
    await withContext(ctx(), (tx) => createOrder(tx, tenant, panel, { source: 'BALCAO', now: NOW }), app);
    expect(await withContext(ctx(), (tx) => countRecentOrdersFromIp(tx, '177.1.2.3', 10), app)).toBe(before);
  });
});
