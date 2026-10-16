import { adminOrderSchema, orderUpdateSchema, productSchema, recipeSchema, stockCountSchema, stockItemSchema, stockMovementSchema, stockPurchaseSchema } from '@zaraki/core';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  applyRecipeCost,
  applyStockCount,
  cancelStockPurchase,
  changeOrderStage,
  createDb,
  createOrder,
  createProduct,
  createStockItem,
  createStockMovement,
  createStockPurchase,
  createSuggestedStockItems,
  ensureFinanceDefaults,
  getStockItem,
  listStockItems,
  payEntry,
  saveRecipe,
  setEntryStatus,
  stockSummary,
  updateEntry,
  updateOrder,
  withContext,
  listAccounts,
} from '../src';
import { auditLogs, financeEntries, products, stockMovements, tenants } from '../src/schema';

const db = createDb(inject('appUrl'), 10);
const owner = createDb(inject('ownerUrl'), 2);
afterAll(async () => {
  await db.$client.end();
  await owner.$client.end();
});

type Tenant = typeof tenants.$inferSelect;
let tenant: Tenant;
let prato: typeof products.$inferSelect;
const TODAY = '2026-10-16';
const run = <T>(fn: Parameters<typeof withContext<T>>[1], t: Tenant = tenant) => withContext({ tenantId: t.id, actorLabel: 'teste' }, fn, db);

async function newTenant(name: string) {
  const [t] = await withContext({ platformAdmin: true }, (tx) => tx.insert(tenants).values({ name, slug: `e-${randomUUID()}` }).returning(), db);
  await withContext({ platformAdmin: true }, (tx) => ensureFinanceDefaults(tx, t!.id), db);
  return t!;
}
const item = async (name: string, t: Tenant = tenant) => (await run((tx) => listStockItems(tx, t.id), t)).rows.find((i) => i.name === name)!;
const balance = async (name: string) => (await item(name)).balance;

beforeAll(async () => {
  tenant = await newTenant('Estoque');
  prato = await run((tx) => createProduct(tx, tenant.id, productSchema.parse({ name: 'Uramaki de Salmão', price: '50' })));
});

describe('itens e compras', () => {
  it('lista sugerida cria os itens do Push Pop ligados às categorias do Financeiro, sem duplicar', async () => {
    const n = await run((tx) => createSuggestedStockItems(tx, tenant.id));
    expect(n).toBeGreaterThan(10);
    expect(await run((tx) => createSuggestedStockItems(tx, tenant.id))).toBe(0);
    const tubo = await item('Tubo Push Pop');
    expect(tubo).toMatchObject({ kind: 'EMBALAGEM', unit: 'un', balance: 0, situation: 'ZERADO' });
    expect(tubo.financeCategoryId).not.toBeNull();
  });

  it('compra entra no estoque, define o custo médio e gera uma conta a pagar por categoria', async () => {
    const salmao = await item('Salmão');
    const tubo = await item('Tubo Push Pop');
    const purchase = await run((tx) =>
      createStockPurchase(
        tx,
        tenant.id,
        stockPurchaseSchema.parse({
          supplier: 'Peixaria Goiás',
          purchasedOn: '2026-10-10',
          dueDate: '2026-10-20',
          lines: [
            { itemId: salmao.id, qty: '5', total: '450,00' },
            { itemId: tubo.id, qty: '1.000', total: '600,00' },
          ],
        }),
      ),
    );
    expect(purchase).toMatchObject({ totalCents: 105000 });
    expect(purchase.financeEntryIds).toHaveLength(2);
    expect(await balance('Salmão')).toBe(5);
    expect((await item('Salmão')).avgCostCents).toBe(9000); // R$ 90/kg
    expect((await item('Tubo Push Pop')).avgCostCents).toBe(60); // R$ 0,60/un

    const entries = await owner.select().from(financeEntries).where(sql`${financeEntries.id} = any(${`{${purchase.financeEntryIds.join(',')}}`}::uuid[])`);
    expect(entries.map((e) => [e.origin, e.direction, e.amountCents, e.paidOn]).sort()).toEqual([
      ['ESTOQUE', 'SAIDA', 45000, null],
      ['ESTOQUE', 'SAIDA', 60000, null],
    ]);

    // No Financeiro, a conta pode ser paga, mas não editada nem excluída por lá.
    const banco = (await run((tx) => listAccounts(tx, tenant.id))).find((a) => a.kind === 'BANCO')!;
    await run((tx) => payEntry(tx, tenant.id, entries[0]!.id, { paidOn: '2026-10-20', accountId: banco.id, paymentMethod: 'PIX' }));
    await expect(run((tx) => setEntryStatus(tx, tenant.id, entries[0]!.id, false))).rejects.toThrow('cancele a compra');
    await expect(
      run((tx) => updateEntry(tx, tenant.id, entries[1]!.id, { ...entries[1]!, categoryId: entries[1]!.categoryId!, notes: null, attachmentId: null, repeat: 'NAO', repeatCount: 1 } as never)),
    ).rejects.toThrow('compra de estoque');
  });

  it('cancelar a compra tira do estoque e estorna as contas', async () => {
    const nori = await item('Alga nori');
    const p = await run((tx) =>
      createStockPurchase(tx, tenant.id, stockPurchaseSchema.parse({ supplier: 'Oriental', purchasedOn: '2026-10-11', dueDate: '2026-10-11', lines: [{ itemId: nori.id, qty: '100', total: '80' }] })),
    );
    expect(await balance('Alga nori')).toBe(100);
    await run((tx) => cancelStockPurchase(tx, tenant.id, p.id));
    expect(await balance('Alga nori')).toBe(0);
    const [entry] = await owner.select().from(financeEntries).where(eq(financeEntries.id, p.financeEntryIds[0]!));
    expect(entry!.status).toBe(false);
  });

  it('perda, consumo e contagem ajustam o saldo; a contagem lança só a diferença', async () => {
    const salmao = await item('Salmão');
    await run((tx) => createStockMovement(tx, tenant.id, stockMovementSchema.parse({ itemId: salmao.id, kind: 'PERDA', qty: '0,25', occurredOn: TODAY, notes: 'Vencido' })));
    expect(await balance('Salmão')).toBe(4.75);
    const tubo = await item('Tubo Push Pop');
    const result = await run((tx) =>
      applyStockCount(tx, tenant.id, stockCountSchema.parse({ occurredOn: TODAY, counts: [{ itemId: salmao.id, counted: '4,5' }, { itemId: tubo.id, counted: '1000' }] })),
    );
    expect(result).toEqual({ counted: 2, adjusted: 1 });
    expect(await balance('Salmão')).toBe(4.5);
    const summary = await run((tx) => stockSummary(tx, tenant.id, '2026-10-01'));
    // Perdas do mês: 0,25 kg (perda) + 0,25 kg (falta na contagem) a R$ 90/kg.
    expect(summary.lossesCents).toBe(4500);
  });
});

describe('ficha técnica e baixa pelos pedidos', () => {
  async function deliveredOrder(qty: number) {
    const input = adminOrderSchema.parse({
      type: 'DELIVERY',
      name: 'Cliente Estoque',
      phone: `62 9${String(60000000 + Math.floor(Math.random() * 9999999))}`,
      neighborhood: 'Centro',
      address: 'Rua 3',
      source: 'BALCAO',
      items: [{ productId: prato.id, qty }],
    });
    const { order } = await run((tx) => createOrder(tx, tenant, input, { source: 'BALCAO' }));
    await run((tx) => changeOrderStage(tx, tenant.id, order.id, 'ENTREGUE'));
    return order;
  }

  it('calcula o custo do tubo pela ficha e pode usar como custo do sabor', async () => {
    const [salmao, tubo] = [await item('Salmão'), await item('Tubo Push Pop')];
    const recipe = await run((tx) =>
      saveRecipe(tx, tenant.id, prato.id, recipeSchema.parse({ lines: [{ itemId: salmao.id, qty: '0,08' }, { itemId: tubo.id, qty: '1' }] })),
    );
    // 0,08 kg × R$ 90 + 1 × R$ 0,60 = R$ 7,80
    expect(recipe).toMatchObject({ costCents: 780, missingCosts: 0 });
    const updated = await run((tx) => applyRecipeCost(tx, tenant.id, prato.id));
    expect(updated.costCents).toBe(780);
  });

  it('pedido entregue baixa o estoque; editar recalcula; voltar de etapa ou cancelar estorna', async () => {
    const before = await balance('Tubo Push Pop');
    const order = await deliveredOrder(3);
    expect(await balance('Tubo Push Pop')).toBe(before - 3);
    expect(await balance('Salmão')).toBeCloseTo(4.5 - 0.24, 3);

    await run((tx) => updateOrder(tx, tenant, order.id, orderUpdateSchema.parse({ type: 'DELIVERY', neighborhood: 'Centro', address: 'Rua 3', items: [{ productId: prato.id, qty: 5 }] })));
    expect(await balance('Tubo Push Pop')).toBe(before - 5);

    await run((tx) => changeOrderStage(tx, tenant.id, order.id, 'CANCELADO', 'teste'));
    expect(await balance('Tubo Push Pop')).toBe(before);
    const moves = await owner.select().from(stockMovements).where(eq(stockMovements.orderId, order.id));
    expect(moves.every((m) => m.kind === 'PEDIDO' && !m.status)).toBe(true);
  });

  it('a ficha é auditada e o banco não aceita apagar movimentações', async () => {
    const logs = await owner.select().from(auditLogs).where(and(eq(auditLogs.entity, 'product_recipes'), eq(auditLogs.tenantId, tenant.id)));
    expect(logs.length).toBeGreaterThan(0);
    await expect(run((tx) => tx.execute(sql`delete from stock_movements where tenant_id = ${tenant.id}`))).rejects.toThrow();
  });
});

describe('isolamento entre unidades', () => {
  it('outra unidade não vê nem usa os itens desta', async () => {
    const other = await newTenant('Estoque 2');
    const theirs = await run((tx) => createStockItem(tx, other.id, stockItemSchema.parse({ name: 'Salmão', kind: 'INSUMO', unit: 'kg', active: 'on' })), other);
    expect(await run((tx) => getStockItem(tx, other.id, theirs.id))).toBeNull();
    await expect(
      run((tx) => tx.insert(stockMovements).values({ tenantId: tenant.id, itemId: theirs.id, kind: 'ENTRADA', qty: '1', occurredOn: TODAY })),
    ).rejects.toMatchObject({ cause: { message: 'O item pertence a outra unidade' } });
  });
});
