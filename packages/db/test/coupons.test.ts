import { adminOrderSchema, couponSchema, orderUpdateSchema, productSchema, publicOrderSchema } from '@zaraki/core';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  changeOrderStage,
  checkCouponCode,
  createCoupon,
  createDb,
  createOrder,
  createProduct,
  getCoupon,
  listCoupons,
  setCouponActive,
  updateOrder,
  withContext,
} from '../src';
import { auditLogs, coupons, products, tenants } from '../src/schema';

const db = createDb(inject('appUrl'), 10);
const owner = createDb(inject('ownerUrl'), 2);
afterAll(async () => {
  await db.$client.end();
  await owner.$client.end();
});

let tenant: typeof tenants.$inferSelect;
let salmao: typeof products.$inferSelect;
const ctx = () => ({ tenantId: tenant.id, actorLabel: 'teste' });
const run = <T>(fn: Parameters<typeof withContext<T>>[1]) => withContext(ctx(), fn, db);

beforeAll(async () => {
  [tenant] = (await withContext(
    { platformAdmin: true },
    (tx) => tx.insert(tenants).values({ name: 'Cupons', slug: `c-${randomUUID()}` }).returning(),
    db,
  )) as [typeof tenants.$inferSelect];
  salmao = await run((tx) => createProduct(tx, tenant.id, productSchema.parse({ name: 'Salmão', price: '50' })));
});

const coupon = (fields: Record<string, string>) =>
  run((tx) => createCoupon(tx, tenant.id, couponSchema.parse({ kind: 'PERCENT', percentOff: '10', active: 'on', ...fields })));

let phoneSeq = 0;
function siteOrder(couponCode: string, tubes = 2, phone = `62 9${String(80000000 + ++phoneSeq)}`) {
  const input = publicOrderSchema.parse({
    type: 'DELIVERY',
    name: 'Cliente',
    phone,
    neighborhood: 'Centro',
    address: 'Rua 1',
    items: [{ productId: salmao.id, qty: tubes }],
    couponCode,
  });
  return run((tx) => createOrder(tx, tenant, input, { source: 'SITE' }));
}

describe('cupons no pedido', () => {
  it('aplica a porcentagem sobre os produtos, guarda o código e conta o uso', async () => {
    const c = await coupon({ code: 'DEZ', maxUses: '5' });
    const { order } = await siteOrder(' dez ', 3);
    expect(order).toMatchObject({ subtotalCents: 15000, discountCents: 1500, totalCents: 13500, couponCode: 'DEZ', couponId: c.id });
    expect((await run((tx) => getCoupon(tx, tenant.id, c.id)))!.stats).toMatchObject({ uses: 1, discountCents: 1500 });
  });

  it('recusa cupom inexistente, inativo ou abaixo do mínimo, sem gravar o pedido', async () => {
    const c = await coupon({ code: 'FESTA20', kind: 'FIXED', percentOff: '', amountOff: '20', minTubes: '5' });
    await expect(siteOrder('NAOEXISTE')).rejects.toThrow('Cupom inválido.');
    await expect(siteOrder('FESTA20', 2)).rejects.toThrow('Válido para pedidos a partir de 5 tubos.');
    expect((await siteOrder('FESTA20', 5)).order.discountCents).toBe(2000);

    await run((tx) => setCouponActive(tx, tenant.id, c.id, false));
    await expect(siteOrder('FESTA20', 5)).rejects.toThrow('Cupom inválido.');
  });

  it('dois pedidos simultâneos não usam a mesma última vaga', async () => {
    await coupon({ code: 'ULTIMA', maxUses: '1' });
    const results = await Promise.allSettled([siteOrder('ULTIMA'), siteOrder('ULTIMA')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(String(rejected.reason)).toContain('Este cupom já foi totalmente utilizado.');
  });

  it('cancelar o pedido devolve o uso', async () => {
    await coupon({ code: 'VOLTA', maxUses: '1' });
    const { order } = await siteOrder('VOLTA');
    await expect(siteOrder('VOLTA')).rejects.toThrow('totalmente utilizado');
    await run((tx) => changeOrderStage(tx, tenant.id, order.id, 'CANCELADO', 'Desistiu'));
    expect((await siteOrder('VOLTA')).order.couponCode).toBe('VOLTA');
  });

  it('cupom exclusivo: só o telefone dono, uma única vez', async () => {
    await coupon({ code: 'ANA-7K2P', kind: 'FIXED', percentOff: '', amountOff: '15', exclusive: 'on', phone: '(62) 98111-0000' });
    await expect(siteOrder('ANA-7K2P', 2, '62 98111-9999')).rejects.toThrow('Este cupom não é válido para este WhatsApp.');
    expect((await siteOrder('ANA-7K2P', 2, '62 98111-0000')).order.discountCents).toBe(1500);
    await expect(siteOrder('ANA-7K2P', 2, '62 98111-0000')).rejects.toThrow('Este cupom já foi utilizado.');
  });

  it('prévia não grava nada e mostra o desconto', async () => {
    await coupon({ code: 'PREVIA', percentOff: '25' });
    const check = await run((tx) => checkCouponCode(tx, tenant, 'PREVIA', { subtotalCents: 10000, tubes: 2, phone: null }));
    expect(check).toMatchObject({ ok: true, discountCents: 2500 });
  });

  it('no painel: edição recalcula o desconto e mantém o cupom mesmo depois de desativado', async () => {
    const c = await coupon({ code: 'PAINEL', percentOff: '10', minTubes: '2' });
    const input = adminOrderSchema.parse({
      type: 'DELIVERY',
      name: 'Bia',
      phone: '62 98222-0000',
      source: 'WHATSAPP',
      neighborhood: 'Centro',
      address: 'Rua 2',
      couponCode: 'PAINEL',
      items: [{ productId: salmao.id, qty: 2 }],
    });
    const { order } = await run((tx) => createOrder(tx, tenant, input, { source: 'WHATSAPP' }));
    expect(order.discountCents).toBe(1000);

    await run((tx) => setCouponActive(tx, tenant.id, c.id, false)); // campanha encerrada
    const edit = (qty: number, couponCode = 'PAINEL') =>
      orderUpdateSchema.parse({ type: 'DELIVERY', neighborhood: 'Centro', address: 'Rua 2', couponCode, items: [{ productId: salmao.id, qty }] });
    expect((await run((tx) => updateOrder(tx, tenant, order.id, edit(4)))).discountCents).toBe(2000);
    await expect(run((tx) => updateOrder(tx, tenant, order.id, edit(1)))).rejects.toThrow('a partir de 2 tubos');
    const removed = await run((tx) => updateOrder(tx, tenant, order.id, edit(1, '')));
    expect(removed).toMatchObject({ couponId: null, couponCode: null, discountCents: 0, totalCents: 5000 });

    // desconto manual e cupom ao mesmo tempo não passam na validação do painel
    expect(orderUpdateSchema.safeParse({ type: 'DELIVERY', neighborhood: 'C', address: 'R', couponCode: 'PAINEL', discount: '5', items: [{ productId: salmao.id, qty: 2 }] }).success).toBe(false);
  });
});

describe('gestão de cupons', () => {
  it('código único, filtros de situação e auditoria', async () => {
    await expect(coupon({ code: 'DEZ' })).rejects.toThrow('Já existe um cupom com o código DEZ.');
    const timezone = 'America/Sao_Paulo';
    const esgotados = await run((tx) => listCoupons(tx, tenant.id, { state: 'esgotados', timezone }));
    expect(esgotados.rows.map((c) => c.code)).toContain('ANA-7K2P');
    const inativos = await run((tx) => listCoupons(tx, tenant.id, { state: 'inativos', timezone }));
    expect(inativos.rows.map((c) => c.code)).toEqual(expect.arrayContaining(['FESTA20', 'PAINEL']));
    const validos = await run((tx) => listCoupons(tx, tenant.id, { state: 'validos', timezone }));
    expect(validos.rows.map((c) => c.code)).not.toContain('ANA-7K2P');

    const audit = await run((tx) => tx.select().from(auditLogs).where(and(eq(auditLogs.entity, 'coupons'), eq(auditLogs.action, 'UPDATE'))));
    expect(audit.some((a) => a.changedFields?.includes('active'))).toBe(true);
  });

  it('exclusão física bloqueada e isolamento entre unidades', async () => {
    const [c] = await run((tx) => tx.select().from(coupons).limit(1));
    await expect(owner.delete(coupons).where(eq(coupons.id, c!.id))).rejects.toThrow();
    const other = await withContext({ tenantId: randomUUID() }, (tx) => tx.select().from(coupons), db);
    expect(other).toHaveLength(0);
  });
});
