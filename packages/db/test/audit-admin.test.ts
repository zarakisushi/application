import { adminOrderSchema, productSchema } from '@zaraki/core';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  changeOrderStage,
  createDb,
  createOrder,
  createProduct,
  createUserWithPassword,
  getAuditLog,
  listAuditActors,
  listAuditLogs,
  listRecordHistory,
  logEvent,
  setProductStatus,
  updateProduct,
  withContext,
} from '../src';
import { tenants } from '../src/schema';

const app = createDb(inject('appUrl'), 5);
afterAll(() => app.$client.end());

let tenant: typeof tenants.$inferSelect;
let userId: string;
const ctx = () => ({ tenantId: tenant.id, userId, ip: '189.10.10.10' });

beforeAll(async () => {
  await withContext(
    { platformAdmin: true, actorLabel: 'teste' },
    async (tx) => {
      [tenant] = (await tx.insert(tenants).values({ name: 'Auditoria', slug: `au-${randomUUID()}` }).returning()) as [typeof tenants.$inferSelect];
      const user = await createUserWithPassword(tx, {
        name: 'Fernanda Gerente',
        email: `${randomUUID()}@zaraki.test`,
        passwordHash: 'x',
        memberships: [{ tenantId: tenant.id, role: 'GERENTE' }],
      });
      userId = user.id;
    },
    app,
  );
});

describe('consultas da auditoria', () => {
  it('lista com o nome de quem fez e filtra por tipo de registro e ação', async () => {
    const product = await withContext(ctx(), (tx) => createProduct(tx, tenant.id, productSchema.parse({ name: 'Temaki', price: '30' })), app);
    await withContext(ctx(), (tx) => updateProduct(tx, tenant.id, product.id, productSchema.parse({ name: 'Temaki', price: '32' })), app);
    await withContext(ctx(), (tx) => setProductStatus(tx, tenant.id, product.id, false), app);

    const scope = { tenantId: tenant.id };
    const page = await withContext(ctx(), (tx) => listAuditLogs(tx, { scope, entity: 'products' }), app);
    expect(page.rows.map((r) => r.action)).toEqual(['SOFT_DELETE', 'UPDATE', 'CREATE']); // mais recente primeiro
    expect(page.rows[0]).toMatchObject({ actorName: 'Fernanda Gerente', ip: '189.10.10.10', entityId: product.id });

    const deletions = await withContext(ctx(), (tx) => listAuditLogs(tx, { scope, action: 'SOFT_DELETE' }), app);
    expect(deletions.rows).toHaveLength(1);

    const byRecord = await withContext(ctx(), (tx) => listAuditLogs(tx, { scope, q: product.id }), app);
    expect(byRecord.rows).toHaveLength(3);

    const entry = await withContext(ctx(), (tx) => getAuditLog(tx, page.rows[1]!.id), app);
    expect(entry).toMatchObject({ action: 'UPDATE', changedFields: ['price_cents'] });
    expect(entry!.hash).toMatch(/^[0-9a-f]{64}$/);

    const actors = await withContext(ctx(), (tx) => listAuditActors(tx, scope), app);
    expect(actors).toEqual([{ id: userId, name: 'Fernanda Gerente' }]);
  });

  it('histórico do pedido inclui itens e mudanças de etapa', async () => {
    const product = await withContext(ctx(), (tx) => createProduct(tx, tenant.id, productSchema.parse({ name: 'Hossomaki', price: '20' })), app);
    const input = adminOrderSchema.parse({
      type: 'DELIVERY',
      name: 'Ana',
      phone: '62 98123-4567',
      source: 'BALCAO',
      neighborhood: 'Centro',
      address: 'Rua 2',
      items: [{ productId: product.id, qty: 2 }],
    });
    const { order } = await withContext(ctx(), (tx) => createOrder(tx, tenant, input, { source: 'BALCAO' }), app);
    await withContext(ctx(), (tx) => changeOrderStage(tx, tenant.id, order.id, 'CONFIRMADO'), app);

    const history = await withContext(ctx(), (tx) => listRecordHistory(tx, 'orders', order.id), app);
    expect(history.map((h) => `${h.entity}:${h.action}`)).toEqual([
      'orders:CREATE',
      'order_items:CREATE',
      'order_stage_history:CREATE',
      'orders:UPDATE',
      'order_stage_history:CREATE',
    ]);
  });

  it('eventos globais (logins) só aparecem para a Matriz', async () => {
    const email = `${randomUUID()}@zaraki.test`;
    await logEvent({ actorLabel: email, ip: '200.1.1.1' }, { action: 'LOGIN_FAILED', entity: 'users', details: { email } }, app);

    const asUnit = await withContext(ctx(), (tx) => listAuditLogs(tx, { scope: 'global', q: email }), app);
    expect(asUnit.rows).toHaveLength(0);
    const asNetwork = await withContext({ platformAdmin: true }, (tx) => listAuditLogs(tx, { scope: 'global', q: email }), app);
    expect(asNetwork.rows).toMatchObject([{ action: 'LOGIN_FAILED', actorLabel: email, tenantId: null }]);
  });
});
