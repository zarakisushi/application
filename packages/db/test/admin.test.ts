import { adminOrderSchema, customerSchema, orderUpdateSchema, productSchema, tenantSchema, userSchema } from '@zaraki/core';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  addUserToTenant,
  changeOrderStage,
  createCustomer,
  createDb,
  createOrder,
  createProduct,
  createTenant,
  getOrderDetail,
  listCustomers,
  listOrders,
  listProducts,
  listTenantUsers,
  setCustomerStatus,
  setOrderStatus,
  setProductStatus,
  setTenantStatus,
  setTenantUserStatus,
  updateOrder,
  updateProduct,
  withContext,
  type DbContext,
} from '../src';
import { calendarSyncJobs, products, sessions, tenants, users } from '../src/schema';

const app = createDb(inject('appUrl'), 10);
afterAll(() => app.$client.end());

let tenant: typeof tenants.$inferSelect;
const ctx = (): DbContext => ({ tenantId: tenant.id, userId: randomUUID() });
const run = <T>(fn: Parameters<typeof withContext<T>>[1], c: DbContext = ctx()) => withContext(c, fn, app);

beforeAll(async () => {
  [tenant] = (await withContext(
    { platformAdmin: true },
    (tx) => tx.insert(tenants).values({ name: 'Admin teste', slug: `a-${randomUUID()}`, kind: 'MATRIZ' }).returning(),
    app,
  )) as [typeof tenants.$inferSelect];
});

describe('cardápio', () => {
  it('cria com slug único, edita, exclui logicamente e filtra por status', async () => {
    const input = productSchema.parse({ name: 'Uramaki Teste', price: '50,00', cost: '21,50' });
    const a = await run((tx) => createProduct(tx, tenant.id, input));
    const b = await run((tx) => createProduct(tx, tenant.id, input));
    expect([a.slug, b.slug]).toEqual(['uramaki-teste', 'uramaki-teste-2']);
    expect(a).toMatchObject({ priceCents: 5000, costCents: 2150 });

    await run((tx) => updateProduct(tx, tenant.id, a.id, { ...input, price: 5500 }));
    await run((tx) => setProductStatus(tx, tenant.id, b.id, false));

    const ativos = await run((tx) => listProducts(tx, tenant.id, { q: 'teste' }));
    expect(ativos.rows.map((p) => [p.slug, p.priceCents])).toEqual([['uramaki-teste', 5500]]);
    const inativos = await run((tx) => listProducts(tx, tenant.id, { q: 'teste', status: 'inativos' }));
    expect(inativos.rows.map((p) => p.id)).toEqual([b.id]);
  });
});

describe('clientes', () => {
  it('não permite dois clientes ativos com o mesmo telefone e mostra estatísticas', async () => {
    const input = customerSchema.parse({ name: 'Bruna', phone: '62 99999-0001' });
    const c = await run((tx) => createCustomer(tx, tenant.id, input));
    await expect(run((tx) => createCustomer(tx, tenant.id, { ...input, name: 'Outra' }))).rejects.toThrow(
      'O telefone (62) 99999-0001 já está cadastrado para Bruna.',
    );

    // Excluído logicamente, o telefone fica livre; restaurar com conflito é recusado.
    await run((tx) => setCustomerStatus(tx, tenant.id, c.id, false));
    await run((tx) => createCustomer(tx, tenant.id, { ...input, name: 'Bruna nova' }));
    await expect(run((tx) => setCustomerStatus(tx, tenant.id, c.id, true))).rejects.toThrow('já está cadastrado');

    const page = await run((tx) => listCustomers(tx, tenant.id, { q: '99999-0001' }));
    expect(page.rows).toMatchObject([{ name: 'Bruna nova', orders: 0, spentCents: 0 }]);
  });
});

describe('pedidos e encomendas no painel', () => {
  let salmao: typeof products.$inferSelect;
  let especial: typeof products.$inferSelect;

  beforeAll(async () => {
    salmao = await run((tx) => createProduct(tx, tenant.id, productSchema.parse({ name: 'Salmão', price: '50' })));
    especial = await run((tx) => createProduct(tx, tenant.id, productSchema.parse({ name: 'Especial', price: '60' })));
  });

  async function newFesta() {
    const input = adminOrderSchema.parse({
      type: 'FESTA',
      name: 'Carlos',
      phone: '62 97777-1111',
      source: 'WHATSAPP',
      date: '2030-06-10',
      time: '20:00',
      guests: '25',
      deliveryFee: '15,00',
      items: [{ productId: salmao.id, qty: 2 }],
    });
    return run((tx) =>
      createOrder(tx, tenant, input, { source: input.source, deliveryFeeCents: input.deliveryFee, paid: input.paid }),
    );
  }

  const jobs = (orderId: string) =>
    run((tx) => tx.select({ op: calendarSyncJobs.op }).from(calendarSyncJobs).where(eq(calendarSyncJobs.orderId, orderId)));

  it('edição mantém o preço antigo dos itens existentes e usa o atual para itens novos', async () => {
    const { order } = await newFesta();
    expect(order.totalCents).toBe(2 * 5000 + 1500);

    // O preço do salmão sobe depois do pedido.
    await run((tx) => updateProduct(tx, tenant.id, salmao.id, productSchema.parse({ name: 'Salmão', price: '70' })));

    const update = orderUpdateSchema.parse({
      type: 'FESTA',
      date: '2030-06-11',
      time: '19:00',
      guests: '30',
      discount: '10',
      deliveryFee: '15',
      items: [
        { productId: salmao.id, qty: 3 },
        { productId: especial.id, qty: 1 },
      ],
    });
    const updated = await run((tx) => updateOrder(tx, tenant, order.id, update));
    expect(updated).toMatchObject({ subtotalCents: 3 * 5000 + 6000, discountCents: 1000, totalCents: 21000 + 1500 - 1000, guests: 30 });
    expect(updated.scheduledAt!.toISOString()).toBe('2030-06-11T22:00:00.000Z');

    const detail = await run((tx) => getOrderDetail(tx, tenant.id, order.id));
    expect(detail!.items.map((i) => [i.productName, i.qty, i.unitPriceCents])).toEqual([
      ['Especial', 1, 6000],
      ['Salmão', 3, 5000],
    ]);
    expect((await jobs(order.id)).map((j) => j.op)).toEqual(['UPSERT', 'UPSERT']);
  });

  it('mudança de etapa vai para o histórico; cancelar exige motivo e tira da agenda', async () => {
    const { order } = await newFesta();
    const c = ctx();
    await run((tx) => changeOrderStage(tx, tenant.id, order.id, 'CONFIRMADO'), c);
    await expect(run((tx) => changeOrderStage(tx, tenant.id, order.id, 'CANCELADO'))).rejects.toThrow('motivo');
    await run((tx) => changeOrderStage(tx, tenant.id, order.id, 'CANCELADO', 'Cliente desistiu'), c);

    const detail = await run((tx) => getOrderDetail(tx, tenant.id, order.id));
    expect(detail!.stage).toBe('CANCELADO');
    expect(detail!.cancelReason).toBe('Cliente desistiu');
    expect(detail!.history.map((h) => [h.fromStage, h.toStage])).toEqual([
      [null, 'NOVO'],
      ['NOVO', 'CONFIRMADO'],
      ['CONFIRMADO', 'CANCELADO'],
    ]);
    expect((await jobs(order.id)).map((j) => j.op)).toEqual(['UPSERT', 'DELETE']);
  });

  it('excluir e restaurar encomenda remove e recoloca na agenda; listas separam pedidos de encomendas', async () => {
    const { order } = await newFesta();
    await run((tx) => setOrderStatus(tx, tenant.id, order.id, false));
    await run((tx) => setOrderStatus(tx, tenant.id, order.id, true));
    expect((await jobs(order.id)).map((j) => j.op)).toEqual(['UPSERT', 'DELETE', 'UPSERT']);

    const timezone = 'America/Sao_Paulo';
    const encomendas = await run((tx) => listOrders(tx, tenant.id, { kind: 'encomendas', q: 'Carlos', timezone }));
    expect(encomendas.rows.every((r) => r.type === 'FESTA')).toBe(true);
    const pedidos = await run((tx) => listOrders(tx, tenant.id, { kind: 'pedidos', q: 'Carlos', timezone }));
    expect(pedidos.total).toBe(0);
  });
});

describe('usuários da unidade', () => {
  it('dá acesso, reaproveita usuário existente e desativa quem perde o último vínculo', async () => {
    const email = `${randomUUID()}@zaraki.test`;
    const input = userSchema.parse({ name: 'Diego', email, role: 'ATENDENTE', isPlatformAdmin: 'on' });
    const added = await run((tx) => addUserToTenant(tx, tenant.id, { ...input, passwordHash: 'hash', allowPlatformAdmin: false }));
    expect(added.created).toBe(true);
    await expect(
      run((tx) => addUserToTenant(tx, tenant.id, { ...input, passwordHash: 'x', allowPlatformAdmin: false })),
    ).rejects.toThrow('já tem acesso');

    const [u] = await app.select().from(users).where(eq(users.id, added.userId));
    expect(u).toMatchObject({ isPlatformAdmin: false, mustChangePassword: true }); // só a Matriz concede acesso à rede

    await app.insert(sessions).values({ userId: added.userId, token: randomUUID(), expiresAt: new Date(Date.now() + 3600_000) });
    await run((tx) => setTenantUserStatus(tx, tenant.id, added.userId, false));
    const [after] = await app.select({ status: users.status }).from(users).where(eq(users.id, added.userId));
    expect(after!.status).toBe(false);
    expect(await app.select().from(sessions).where(eq(sessions.userId, added.userId))).toHaveLength(0);

    // Readicionar o mesmo e-mail reativa o vínculo e o usuário, sem criar outro.
    const again = await run((tx) => addUserToTenant(tx, tenant.id, { ...input, role: 'GERENTE', passwordHash: 'y', allowPlatformAdmin: false }));
    expect(again).toEqual({ userId: added.userId, created: false });
    const list = await run((tx) => listTenantUsers(tx, tenant.id, { q: email }));
    expect(list.rows).toMatchObject([{ role: 'GERENTE', status: true, userStatus: true }]);
  });
});

describe('unidades', () => {
  it('franqueado nasce com cópia do cardápio; a Matriz não pode ser desativada', async () => {
    const input = tenantSchema.parse({ name: 'Zaraki Teste', slug: `f-${randomUUID().slice(0, 8)}`, orderCodePrefix: 'ZT' });
    const franquia = await withContext({ platformAdmin: true }, (tx) => createTenant(tx, input, tenant.id), app);
    expect(franquia.kind).toBe('FRANQUIA');

    const copied = await withContext({ tenantId: franquia.id }, (tx) => tx.select().from(products), app);
    const original = await run((tx) => tx.select().from(products).where(and(eq(products.tenantId, tenant.id), eq(products.status, true))));
    expect(copied.map((p) => p.slug).sort()).toEqual(original.map((p) => p.slug).sort());

    await expect(withContext({ platformAdmin: true }, (tx) => setTenantStatus(tx, tenant.id, false), app)).rejects.toThrow(
      'A Matriz não pode ser desativada.',
    );
    await expect(
      withContext({ platformAdmin: true }, (tx) => createTenant(tx, input, tenant.id), app),
    ).rejects.toThrow('Já existe uma unidade ativa');
  });
});
