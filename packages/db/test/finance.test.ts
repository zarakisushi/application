import { addMonths, adminOrderSchema, buildDre, statementSchema, todayInZone, computeDre, financeAccountSchema, financeEntrySchema, orderUpdateSchema, productSchema, transferSchema } from '@zaraki/core';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  changeOrderStage,
  accountBalanceAt,
  adjustFromStatement,
  averageMonthlyOutflow,
  createStatement,
  listStatements,
  setStatementStatus,
  statementSummary,
  closeMonth,
  closedMonthMessage,
  generateRoyalties,
  listRoyaltyCharges,
  recalculateRoyalty,
  reconcileAccount,
  reopenMonth,
  cashFlowByMonth,
  cmvPurchases,
  createAccount,
  createAttachment,
  createDb,
  createEntries,
  createOrder,
  createProduct,
  createTenant,
  createTransfer,
  dreRows,
  ensureFinanceDefaults,
  findReport,
  getAttachment,
  getEntry,
  listAccounts,
  listCategories,
  listEntries,
  listOpenEntries,
  listUnpaidDeliveredOrders,
  openSummary,
  payEntry,
  projectedBalance,
  setAccountStatus,
  setCategoryStatus,
  setEntryStatus,
  setOrderPayment,
  setOrderStatus,
  totalBalance,
  updateAccount,
  updateEntry,
  updateOrder,
  withContext,
} from '../src';
import { auditLogs, financeEntries, products, tenants } from '../src/schema';

const db = createDb(inject('appUrl'), 10);
const owner = createDb(inject('ownerUrl'), 2);
afterAll(async () => {
  await db.$client.end();
  await owner.$client.end();
});

type Tenant = typeof tenants.$inferSelect;
let tenant: Tenant;
let salmao: typeof products.$inferSelect;
const TODAY = '2026-10-14';
const run = <T>(fn: Parameters<typeof withContext<T>>[1], t: Tenant = tenant) => withContext({ tenantId: t.id, actorLabel: 'teste' }, fn, db);

async function newTenant(name: string, kind: 'MATRIZ' | 'FRANQUIA' = 'FRANQUIA') {
  const [t] = await withContext({ platformAdmin: true }, (tx) => tx.insert(tenants).values({ name, slug: `f-${randomUUID()}`, kind }).returning(), db);
  await withContext({ platformAdmin: true }, (tx) => ensureFinanceDefaults(tx, t!.id), db);
  return t!;
}

const category = async (name: string, t: Tenant = tenant) => (await run((tx) => listCategories(tx, t.id), t)).find((c) => c.name === name)!;
const account = async (name: string, t: Tenant = tenant) => (await run((tx) => listAccounts(tx, t.id), t)).find((a) => a.name === name)!;
const balance = async (name: string) => (await account(name)).balanceCents;
const orderEntries = (orderId: string) => owner.select().from(financeEntries).where(eq(financeEntries.orderId, orderId));

function adminOrder(fields: Record<string, unknown> = {}) {
  const input = adminOrderSchema.parse({
    type: 'DELIVERY',
    name: 'Cliente Caixa',
    phone: `62 9${String(80000000 + Math.floor(Math.random() * 9999999))}`,
    neighborhood: 'Centro',
    address: 'Rua 1',
    source: 'BALCAO',
    items: [{ productId: salmao.id, qty: 2 }],
    ...fields,
  });
  return run((tx) =>
    createOrder(tx, tenant, input, { source: input.source, paid: input.paid, paymentMethod: input.paymentMethod, deliveryFeeCents: input.deliveryFee }),
  );
}

beforeAll(async () => {
  tenant = await newTenant('Financeiro');
  salmao = await run((tx) => createProduct(tx, tenant.id, productSchema.parse({ name: 'Salmão', price: '50', cost: '20' })));
});

describe('cadastros padrão', () => {
  it('cria contas e plano de contas, com categorias da franquia e sem as da Matriz', async () => {
    const accounts = await run((tx) => listAccounts(tx, tenant.id));
    expect(accounts.map((a) => [a.name, a.receivesMethods])).toEqual([
      ['Caixa da loja', ['DINHEIRO']],
      ['Conta bancária', ['PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'OUTRO']],
    ]);
    const names = (await run((tx) => listCategories(tx, tenant.id))).map((c) => c.name);
    expect(names).toContain('Royalties à Matriz');
    expect(names).not.toContain('Royalties recebidos');
  });

  it('é idempotente e a unidade nova criada pelo painel já nasce com o financeiro', async () => {
    const before = (await run((tx) => listCategories(tx, tenant.id))).length;
    await withContext({ platformAdmin: true }, (tx) => ensureFinanceDefaults(tx, tenant.id), db);
    expect((await run((tx) => listCategories(tx, tenant.id))).length).toBe(before);

    const created = await withContext(
      { platformAdmin: true },
      (tx) =>
        createTenant(
          tx,
          { name: 'Setor Bueno', slug: `sb-${randomUUID().slice(0, 8)}`, cnpj: null, city: null, whatsappNumber: null, calendarId: null, domain: null, royaltyPct: '5.00', orderCodePrefix: 'ZB', royaltyDueDay: 10 },
          tenant.id,
        ),
      db,
    );
    expect((await run((tx) => listAccounts(tx, created.id), created)).length).toBe(2);
  });

  it('categoria do sistema não pode ser excluída', async () => {
    const vendas = await category('Vendas (pedidos)');
    await expect(run((tx) => setCategoryStatus(tx, tenant.id, vendas.id, false))).rejects.toThrow('usada pelo sistema');
  });
});

describe('pedidos no caixa', () => {
  it('pedido lançado já pago entra no caixa, na conta da forma de pagamento', async () => {
    const before = await balance('Caixa da loja');
    const { order } = await adminOrder({ paid: 'on', paymentMethod: 'DINHEIRO', deliveryFee: '8' });
    const [entry] = await orderEntries(order.id);
    expect(entry).toMatchObject({ direction: 'ENTRADA', amountCents: 10800, origin: 'PEDIDO', paymentMethod: 'DINHEIRO', status: true });
    expect(entry!.description).toBe(`Pedido ${order.code} · Cliente Caixa`);
    expect(entry!.paidOn).not.toBeNull();
    expect(await balance('Caixa da loja')).toBe(before + 10800);
  });

  it('pedido não pago não entra; registrar o pagamento cria a entrada e desfazer estorna', async () => {
    const { order } = await adminOrder();
    expect(await orderEntries(order.id)).toHaveLength(0);

    await run((tx) => setOrderPayment(tx, tenant.id, order.id, { paid: true, method: 'PIX' }));
    const [entry] = await orderEntries(order.id);
    expect(entry).toMatchObject({ amountCents: 10000, status: true, accountId: (await account('Conta bancária')).id });

    await run((tx) => setOrderPayment(tx, tenant.id, order.id, { paid: false, method: null }));
    expect((await orderEntries(order.id)).map((e) => e.status)).toEqual([false]);

    // Pagar de novo cria uma entrada nova (a anterior fica estornada no histórico).
    await run((tx) => setOrderPayment(tx, tenant.id, order.id, { paid: true, method: 'PIX' }));
    expect((await orderEntries(order.id)).filter((e) => e.status)).toHaveLength(1);
  });

  it('editar o pedido atualiza o valor; trocar a forma de pagamento troca a conta', async () => {
    const { order } = await adminOrder({ paid: 'on', paymentMethod: 'PIX' });
    const update = orderUpdateSchema.parse({
      type: 'DELIVERY',
      neighborhood: 'Centro',
      address: 'Rua 1',
      items: [{ productId: salmao.id, qty: 3 }],
      paymentMethod: 'DINHEIRO',
      paid: 'on',
    });
    await run((tx) => updateOrder(tx, tenant, order.id, update));
    const active = (await orderEntries(order.id)).filter((e) => e.status);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ amountCents: 15000, paymentMethod: 'DINHEIRO', accountId: (await account('Caixa da loja')).id });
  });

  it('cancelar ou excluir o pedido estorna a entrada; restaurar devolve', async () => {
    const { order } = await adminOrder({ paid: 'on', paymentMethod: 'PIX' });
    await run((tx) => changeOrderStage(tx, tenant.id, order.id, 'CANCELADO', 'cliente desistiu'));
    expect((await orderEntries(order.id)).filter((e) => e.status)).toHaveLength(0);
    await expect(run((tx) => setOrderPayment(tx, tenant.id, order.id, { paid: true, method: 'PIX' }))).rejects.toThrow('cancelado');

    const other = (await adminOrder({ paid: 'on', paymentMethod: 'PIX' })).order;
    await run((tx) => setOrderStatus(tx, tenant.id, other.id, false));
    expect((await orderEntries(other.id)).filter((e) => e.status)).toHaveLength(0);
    await run((tx) => setOrderStatus(tx, tenant.id, other.id, true));
    expect((await orderEntries(other.id)).filter((e) => e.status)).toHaveLength(1);
  });

  it('o banco não aceita duas entradas ativas para o mesmo pedido', async () => {
    const { order } = await adminOrder({ paid: 'on', paymentMethod: 'PIX' });
    const [entry] = await orderEntries(order.id);
    const { id: _id, createdAt: _c, updatedAt: _u, ...copy } = entry!;
    await expect(run((tx) => tx.insert(financeEntries).values(copy))).rejects.toThrow();
  });

  it('lançamento de pedido não é editado nem excluído pelo financeiro', async () => {
    const { order } = await adminOrder({ paid: 'on', paymentMethod: 'PIX' });
    const [entry] = await orderEntries(order.id);
    await expect(run((tx) => setEntryStatus(tx, tenant.id, entry!.id, false))).rejects.toThrow('vem de um pedido');
  });

  it('pedidos entregues e não pagos aparecem em "A receber"', async () => {
    const { order } = await adminOrder();
    await run((tx) => changeOrderStage(tx, tenant.id, order.id, 'ENTREGUE'));
    const unpaid = await run((tx) => listUnpaidDeliveredOrders(tx, tenant.id));
    expect(unpaid.map((o) => o.id)).toContain(order.id);
    await run((tx) => setOrderPayment(tx, tenant.id, order.id, { paid: true, method: 'DINHEIRO' }));
    expect((await run((tx) => listUnpaidDeliveredOrders(tx, tenant.id))).map((o) => o.id)).not.toContain(order.id);
  });
});

describe('lançamentos manuais', () => {
  const entry = async (fields: Record<string, string>) =>
    financeEntrySchema.parse({ direction: 'SAIDA', competenceDate: '2026-10-01', dueDate: '2026-10-10', ...fields });

  it('aluguel recorrente gera 3 meses em aberto; pagar um muda o saldo da conta', async () => {
    const aluguel = await category('Aluguel');
    const banco = await account('Conta bancária');
    const rows = await run(async (tx) => createEntries(tx, tenant.id, await entry({ description: 'Aluguel loja', amount: '3.500,00', categoryId: aluguel.id, repeat: 'MENSAL', repeatCount: '3' })));
    expect(rows.map((r) => [r.dueDate, r.installment, r.paidOn])).toEqual([
      ['2026-10-10', 1, null],
      ['2026-11-10', 2, null],
      ['2026-12-10', 3, null],
    ]);
    expect(new Set(rows.map((r) => r.seriesId)).size).toBe(1);

    const open = await run((tx) => listOpenEntries(tx, tenant.id, '2026-12-31'));
    expect(open.filter((o) => o.description === 'Aluguel loja')).toHaveLength(3);

    const before = await balance('Conta bancária');
    await run((tx) => payEntry(tx, tenant.id, rows[0]!.id, { paidOn: '2026-10-10', accountId: banco.id, paymentMethod: 'PIX' }));
    expect(await balance('Conta bancária')).toBe(before - 350000);
    await expect(run((tx) => payEntry(tx, tenant.id, rows[0]!.id, { paidOn: '2026-10-10', accountId: banco.id, paymentMethod: null }))).rejects.toThrow('já está pago');
  });

  it('editar "este e os próximos" leva o novo valor às parcelas em aberto seguintes', async () => {
    const energia = await category('Energia');
    const rows = await run(async (tx) => createEntries(tx, tenant.id, await entry({ description: 'Conta de luz', amount: '800', categoryId: energia.id, repeat: 'MENSAL', repeatCount: '3' })));
    const input = await entry({ description: 'Conta de luz (Equatorial)', amount: '950', categoryId: energia.id, competenceDate: rows[1]!.competenceDate, dueDate: rows[1]!.dueDate });
    await run((tx) => updateEntry(tx, tenant.id, rows[1]!.id, input, 'PROXIMOS'));
    const after = await owner.select().from(financeEntries).where(eq(financeEntries.seriesId, rows[0]!.seriesId!));
    const byInstallment = Object.fromEntries(after.map((r) => [r.installment, [r.amountCents, r.description, r.dueDate]]));
    expect(byInstallment).toEqual({
      1: [80000, 'Conta de luz', '2026-10-10'],
      2: [95000, 'Conta de luz (Equatorial)', '2026-11-10'],
      3: [95000, 'Conta de luz (Equatorial)', '2026-12-10'],
    });
  });

  it('categoria precisa ser do mesmo tipo do lançamento', async () => {
    const vendas = await category('Vendas (pedidos)');
    await expect(run(async (tx) => createEntries(tx, tenant.id, await entry({ description: 'Errado', amount: '10', categoryId: vendas.id })))).rejects.toThrow('categoria de saída');
  });

  it('lista da mais recente para a mais antiga, pela data do movimento (pagamento ou vencimento)', async () => {
    const page = await run((tx) => listEntries(tx, tenant.id, { pageSize: 100, today: TODAY }));
    const dates = page.rows.map((r) => r.paidOn ?? r.dueDate);
    expect(dates.length).toBeGreaterThan(3);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it('filtros e totais da lista', async () => {
    const insumos = await category('Insumos: peixes e frutos do mar');
    const caixa = await account('Caixa da loja');
    await run(async (tx) =>
      createEntries(tx, tenant.id, await entry({ description: 'Salmão fresco', amount: '1.200', categoryId: insumos.id, counterparty: 'Peixaria Goiás', paid: 'on', paidOn: '2026-10-05', accountId: caixa.id })),
    );
    const page = await run((tx) => listEntries(tx, tenant.id, { q: 'peixaria', from: '2026-10-01', to: '2026-10-31', today: TODAY }));
    expect(page.rows.map((r) => [r.description, r.categoryName, r.accountName])).toEqual([['Salmão fresco', 'Insumos: peixes e frutos do mar', 'Caixa da loja']]);
    expect(page).toMatchObject({ incomeCents: 0, expenseCents: 120000 });

    const overdue = await run((tx) => listEntries(tx, tenant.id, { situation: 'vencidos', today: '2026-10-11' }));
    expect(overdue.rows.every((r) => !r.paidOn && r.dueDate < '2026-10-11')).toBe(true);
    expect(overdue.rows.length).toBeGreaterThan(0);
  });

  it('exclusão é lógica, com auditoria, e o banco bloqueia DELETE', async () => {
    const outras = await category('Outras receitas');
    const [row] = await run(async (tx) => createEntries(tx, tenant.id, await entry({ direction: 'ENTRADA', description: 'Venda de equipamento usado', amount: '300', categoryId: outras.id })));
    await run((tx) => setEntryStatus(tx, tenant.id, row!.id, false));
    expect((await run((tx) => getEntry(tx, tenant.id, row!.id)))!.status).toBe(false);
    const logs = await owner.select().from(auditLogs).where(and(eq(auditLogs.entity, 'finance_entries'), eq(auditLogs.entityId, row!.id)));
    expect(logs.map((l) => l.action).sort()).toEqual(['CREATE', 'SOFT_DELETE']);
    await expect(run((tx) => tx.execute(sql`delete from finance_entries where id = ${row!.id}`))).rejects.toThrow();
  });
});

describe('contas e transferências', () => {
  it('transferência move o saldo entre contas sem virar entrada ou saída', async () => {
    const caixa = await account('Caixa da loja');
    const banco = await account('Conta bancária');
    const [c0, b0] = [caixa.balanceCents, banco.balanceCents];
    const [out] = await run((tx) => createTransfer(tx, tenant.id, transferSchema.parse({ fromAccountId: caixa.id, toAccountId: banco.id, amount: '50', date: TODAY })));
    expect(await balance('Caixa da loja')).toBe(c0 - 5000);
    expect(await balance('Conta bancária')).toBe(b0 + 5000);

    const totals = await run((tx) => listEntries(tx, tenant.id, { origin: 'TRANSFERENCIA', today: TODAY }));
    expect(totals.rows).toHaveLength(2);
    expect([totals.incomeCents, totals.expenseCents]).toEqual([0, 0]);

    // Excluir uma perna exclui as duas.
    await run((tx) => setEntryStatus(tx, tenant.id, out!.id, false));
    expect(await balance('Caixa da loja')).toBe(c0);
    expect(await balance('Conta bancária')).toBe(b0);
  });

  it('cada forma de pagamento cai numa conta só; conta com saldo não é excluída', async () => {
    const carteira = await run((tx) =>
      createAccount(tx, tenant.id, financeAccountSchema.parse({ name: 'Carteira Pix', kind: 'CARTEIRA_DIGITAL', openingDate: TODAY, openingBalance: '10', receivesMethods: ['PIX'], active: 'on' })),
    );
    expect((await account('Conta bancária')).receivesMethods).not.toContain('PIX');
    const { order } = await adminOrder({ paid: 'on', paymentMethod: 'PIX' });
    expect((await orderEntries(order.id))[0]!.accountId).toBe(carteira.id);

    await expect(run((tx) => setAccountStatus(tx, tenant.id, carteira.id, false))).rejects.toThrow('ainda tem saldo');
  });
});

describe('isolamento entre unidades', () => {
  it('uma unidade não vê nem usa o financeiro da outra', async () => {
    const other = await newTenant('Outra unidade');
    const theirs = await category('Aluguel', other);
    expect(await run((tx) => listEntries(tx, other.id, { today: TODAY }), tenant)).toMatchObject({ total: 0 });
    expect(await run((tx) => listAccounts(tx, other.id), tenant)).toEqual([]);

    // Tentar lançar com a categoria de outra unidade: a categoria nem é encontrada.
    const input = financeEntrySchema.parse({ direction: 'SAIDA', description: 'Teste', amount: '1', categoryId: theirs.id, competenceDate: TODAY, dueDate: TODAY });
    await expect(run((tx) => createEntries(tx, tenant.id, input))).rejects.toThrow('Categoria não encontrada');
    // E, mesmo gravando direto, o banco recusa a categoria de outra unidade.
    await expect(
      run((tx) => tx.insert(financeEntries).values({ tenantId: tenant.id, direction: 'SAIDA', description: 'x', amountCents: 1, categoryId: theirs.id, competenceDate: TODAY, dueDate: TODAY })),
    ).rejects.toMatchObject({ cause: { message: 'A categoria pertence a outra unidade' } });
  });
});

describe('painel financeiro (visão geral, fluxo e DRE)', () => {
  const T = '2026-10-14';
  let q: Tenant;
  const runQ = <R>(fn: Parameters<typeof withContext<R>>[1]) => run(fn, q);

  beforeAll(async () => {
    q = await newTenant('Painel');
    const banco = await account('Conta bancária', q);
    const caixa = await account('Caixa da loja', q);
    await runQ((tx) =>
      updateAccount(tx, q.id, banco.id, financeAccountSchema.parse({ name: banco.name, kind: 'BANCO', openingBalance: '10.000', openingDate: '2026-01-01', receivesMethods: banco.receivesMethods, active: 'on' })),
    );
    const cat = async (name: string) => (await category(name, q)).id;
    const e = async (f: Record<string, string>) =>
      runQ(async (tx) => createEntries(tx, q.id, financeEntrySchema.parse({ direction: 'SAIDA', description: 'Teste', ...f })));
    const paid = (date: string) => ({ paid: 'on', paidOn: date, accountId: banco.id });
    await e({ direction: 'ENTRADA', description: 'Evento corporativo', amount: '20.000', categoryId: await cat('Outras receitas'), competenceDate: '2026-09-05', dueDate: '2026-09-05', ...paid('2026-09-05') });
    await e({ description: 'Salmão', amount: '6.000', categoryId: await cat('Insumos: peixes e frutos do mar'), competenceDate: '2026-09-10', dueDate: '2026-09-10', ...paid('2026-09-10') });
    await e({ description: 'Aluguel', amount: '5.000', categoryId: await cat('Aluguel'), competenceDate: '2026-09-01', dueDate: '2026-09-10', ...paid('2026-09-12') });
    await e({ description: 'Energia de setembro', amount: '1.000', categoryId: await cat('Energia'), competenceDate: '2026-09-30', dueDate: '2026-10-15' });
    await e({ direction: 'ENTRADA', description: 'Sinal de festa', amount: '3.000', categoryId: await cat('Outras receitas'), competenceDate: '2026-10-01', dueDate: '2026-10-20' });
    await e({ description: 'Gás', amount: '500', categoryId: await cat('Gás'), competenceDate: '2026-10-01', dueDate: '2026-10-05' });
    await runQ((tx) => createTransfer(tx, q.id, transferSchema.parse({ fromAccountId: banco.id, toAccountId: caixa.id, amount: '1.000', date: '2026-09-20' })));
  });

  it('saldo das contas soma o inicial e o que foi pago; transferência não muda o total', async () => {
    expect(await runQ((tx) => totalBalance(tx, q.id))).toBe(1_900_000);
    expect(await runQ((tx) => totalBalance(tx, q.id, '2026-08-31'))).toBe(1_000_000);
  });

  it('fluxo de caixa: realizado nos meses passados e previsto do mês atual em diante (vencidos entram hoje)', async () => {
    const flow = await runQ((tx) => cashFlowByMonth(tx, q.id, ['2026-09', '2026-10', '2026-11'], T));
    expect(flow.map((m) => [m.month, m.openingCents, m.incomeCents, m.expenseCents, m.plannedIncomeCents, m.plannedExpenseCents, m.closingCents])).toEqual([
      ['2026-09', 1_000_000, 2_000_000, 1_100_000, 0, 0, 1_900_000],
      ['2026-10', 1_900_000, 0, 0, 300_000, 150_000, 2_050_000],
      ['2026-11', 2_050_000, 0, 0, 0, 0, 2_050_000],
    ]);
  });

  it('DRE por competência: a energia de setembro paga em outubro conta em setembro', async () => {
    const dre = computeDre(await runQ((tx) => dreRows(tx, q.id, '2026-09-01', '2026-09-30')));
    expect(dre).toMatchObject({ receita: 2_000_000, custosVariaveis: 600_000, despesasFixas: 600_000, resultadoOperacional: 800_000 });
    expect(await runQ((tx) => cmvPurchases(tx, q.id, '2026-09-01', '2026-09-30'))).toBe(600_000);
  });

  it('saldo previsto dia a dia e o menor saldo dos próximos dias', async () => {
    const { series, min, dailySalesCents } = await runQ((tx) => projectedBalance(tx, q.id, T, 30));
    const day = (d: string) => series.find((s) => s.date === d)!.cents;
    expect([day(T), day('2026-10-15'), day('2026-10-20')]).toEqual([1_850_000, 1_750_000, 2_050_000]);
    // Sem vendas de pedidos nos últimos 28 dias, a linha com vendas estimadas é igual à das contas.
    expect(dailySalesCents).toBe(0);
    expect(min).toEqual({ date: '2026-10-15', cents: 1_750_000 });
  });

  it('contas em aberto por faixa e média de saídas para o fôlego de caixa', async () => {
    const open = await runQ((tx) => openSummary(tx, q.id, T));
    expect(open.payables).toEqual({ overdue: { count: 1, cents: 50_000 }, week: { count: 1, cents: 100_000 }, month: { count: 0, cents: 0 } });
    expect(open.receivables.week).toEqual({ count: 1, cents: 300_000 });
    // Primeiro mês com movimento: divide só por ele (unidade nova).
    expect(await runQ((tx) => averageMonthlyOutflow(tx, q.id, T))).toBe(1_100_000);
  });

  it('relatórios DRE e fluxo de caixa batem com o painel', async () => {
    const params = { tenantIds: [q.id], timezone: 'America/Sao_Paulo', from: '2026-09-01', to: '2026-10-31', days: 61, previous: { from: '2026-07-01', to: '2026-08-31' }, extra: {} };
    const dre = await runQ((tx) => findReport('dre')!.run(tx, params));
    expect(dre.rows.find((r) => r.linha === 'Receita')).toMatchObject({ 'm2026-09': 2_000_000, 'm2026-10': 300_000, total: 2_300_000 });
    expect(buildDre([], ['2026-09'])[0]!.values.resultado).toBe(0);
    const fluxo = await runQ((tx) => findReport('fluxo-caixa')!.run(tx, params));
    expect(fluxo.rows.map((r) => [r.inicial, r.entradas, r.saidas, r.final])).toEqual([
      [1_000_000, 2_000_000, 1_100_000, 1_900_000],
      [1_900_000, 0, 0, 1_900_000],
    ]);
  });
});

describe('comprovantes privados', () => {
  it('ficam na unidade: outra unidade não lê nem consegue ligar a um lançamento', async () => {
    const file = { fileName: 'nota.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF-1.4 teste') };
    const id = await run((tx) => createAttachment(tx, tenant.id, file));
    expect((await run((tx) => getAttachment(tx, tenant.id, id)))!.content.toString()).toBe('%PDF-1.4 teste');

    const other = await newTenant('Sem acesso');
    expect(await run((tx) => getAttachment(tx, tenant.id, id), other)).toBeNull();
    const outras = await category('Outras receitas', other);
    await expect(
      run(
        (tx) =>
          tx.insert(financeEntries).values({ tenantId: other.id, direction: 'ENTRADA', description: 'x', amountCents: 1, categoryId: outras.id, competenceDate: TODAY, dueDate: TODAY, attachmentId: id }),
        other,
      ),
    ).rejects.toMatchObject({ cause: { message: 'O comprovante pertence a outra unidade' } });

    // O conteúdo binário não vai para a auditoria.
    const logs = await owner.select().from(auditLogs).where(eq(auditLogs.entityId, id));
    expect(logs).toEqual([]);
  });
});

describe('royalties automáticos', () => {
  const thisMonth = `${todayInZone('America/Sao_Paulo').slice(0, 7)}-01`;
  let franquia: Tenant;
  let prato: typeof products.$inferSelect;

  beforeAll(async () => {
    // Garante uma Matriz ativa no banco de teste.
    const [m] = await owner.select().from(tenants).where(and(eq(tenants.kind, 'MATRIZ'), eq(tenants.status, true)));
    if (!m) await newTenant('Matriz de teste', 'MATRIZ');
    franquia = await newTenant('Franquia Royalties');
    await owner.update(tenants).set({ royaltyPct: '5.00', royaltyDueDay: 12 }).where(eq(tenants.id, franquia.id));
    prato = await run((tx) => createProduct(tx, franquia.id, productSchema.parse({ name: 'Hot roll', price: '100' })), franquia);
  });

  async function deliveredOrder(qty: number) {
    const input = adminOrderSchema.parse({
      type: 'DELIVERY',
      name: 'Cliente Franquia',
      phone: `62 9${String(70000000 + Math.floor(Math.random() * 9999999))}`,
      neighborhood: 'Centro',
      address: 'Rua 2',
      source: 'BALCAO',
      items: [{ productId: prato.id, qty }],
    });
    const { order } = await run((tx) => createOrder(tx, franquia, input, { source: 'BALCAO' }), franquia);
    await run((tx) => changeOrderStage(tx, franquia.id, order.id, 'ENTREGUE'), franquia);
  }

  it('gera a saída na franquia e a entrada na Matriz, uma vez por mês', async () => {
    await deliveredOrder(2); // R$ 200 → 5% = R$ 10
    const first = await withContext({ platformAdmin: true, actorLabel: 'cron' }, (tx) => generateRoyalties(tx, thisMonth), db);
    expect(first.created).toContain('Franquia Royalties');
    const again = await withContext({ platformAdmin: true, actorLabel: 'cron' }, (tx) => generateRoyalties(tx, thisMonth), db);
    expect(again.skipped).toContain('Franquia Royalties');

    const [charge] = await run((tx) => listRoyaltyCharges(tx, { tenantId: franquia.id }), franquia);
    expect(charge).toMatchObject({ month: thisMonth, revenue_cents: 20000, amount_cents: 1000, due_date: addMonths(thisMonth, 1).slice(0, 8) + '12' });
    const pair = await owner.select().from(financeEntries).where(and(eq(financeEntries.royaltyChargeId, charge!.id), eq(financeEntries.status, true)));
    expect(pair.map((e) => [e.tenantId === franquia.id ? 'franquia' : 'matriz', e.direction, e.amountCents, e.origin]).sort()).toEqual([
      ['franquia', 'SAIDA', 1000, 'ROYALTIES'],
      ['matriz', 'ENTRADA', 1000, 'ROYALTIES'],
    ]);

    // Outra unidade não vê a cobrança.
    expect(await run((tx) => listRoyaltyCharges(tx, { tenantId: franquia.id }))).toEqual([]);
    // O lançamento de royalties não é excluído à mão.
    const mine = pair.find((e) => e.tenantId === franquia.id)!;
    await expect(run((tx) => setEntryStatus(tx, franquia.id, mine.id, false), franquia)).rejects.toThrow('Recalcular');
  });

  it('recalcula enquanto ninguém pagou; depois de pago, não', async () => {
    await deliveredOrder(1); // faturamento vai a R$ 300 → R$ 15
    const [charge] = await run((tx) => listRoyaltyCharges(tx, { tenantId: franquia.id }), franquia);
    const r = await withContext({ platformAdmin: true }, (tx) => recalculateRoyalty(tx, charge!.id), db);
    expect(r).toMatchObject({ changed: true, charge: { revenueCents: 30000, amountCents: 1500 } });
    const active = await owner.select().from(financeEntries).where(and(eq(financeEntries.royaltyChargeId, charge!.id), eq(financeEntries.status, true)));
    expect(active.map((e) => e.amountCents)).toEqual([1500, 1500]);

    const mine = active.find((e) => e.tenantId === franquia.id)!;
    const caixa = await account('Caixa da loja', franquia);
    await run((tx) => payEntry(tx, franquia.id, mine.id, { paidOn: todayInZone('America/Sao_Paulo'), accountId: caixa.id, paymentMethod: 'PIX' }), franquia);
    await expect(withContext({ platformAdmin: true }, (tx) => recalculateRoyalty(tx, charge!.id), db)).rejects.toThrow('já foi paga');
  });
});

describe('fechamento de mês', () => {
  const today = todayInZone('America/Sao_Paulo');
  const last = addMonths(`${today.slice(0, 7)}-01`, -1);
  let u: Tenant;

  beforeAll(async () => {
    u = await newTenant('Fechamento');
  });

  const entry = async (f: Record<string, string>) =>
    run(async (tx) => createEntries(tx, u.id, financeEntrySchema.parse({ direction: 'SAIDA', description: 'Conta', amount: '100', categoryId: (await category('Energia', u)).id, ...f })), u);
  const blocked = (p: Promise<unknown>) => p.then(() => null, (e) => closedMonthMessage(e));

  it('bloqueia mudar a DRE e o caixa do mês fechado, mas deixa pagar hoje a conta de competência fechada', async () => {
    const caixa = await account('Caixa da loja', u);
    const [paidLast] = await entry({ competenceDate: last, dueDate: last, paid: 'on', paidOn: last, accountId: caixa.id });
    const [openLast] = await entry({ description: 'Energia do mês passado', competenceDate: last, dueDate: today });
    await run((tx) => closeMonth(tx, u.id, last, today), u);
    const label = `${last.slice(5, 7)}/${last.slice(0, 4)}`;

    expect(await blocked(entry({ competenceDate: last, dueDate: today }))).toBe(`O financeiro de ${label} está fechado. Reabra o mês para alterar.`);
    expect(await blocked(run((tx) => tx.update(financeEntries).set({ amountCents: 999 }).where(eq(financeEntries.id, paidLast!.id)), u))).toContain(label);
    expect(await blocked(run((tx) => tx.update(financeEntries).set({ status: false }).where(eq(financeEntries.id, paidLast!.id)), u))).toContain(label);
    // Pagar hoje: caixa do mês atual, DRE do mês fechado intacta.
    await run((tx) => payEntry(tx, u.id, openLast!.id, { paidOn: today, accountId: caixa.id, paymentMethod: null }), u);
    // Trocar só a descrição não muda números.
    await run((tx) => tx.update(financeEntries).set({ description: 'Conta de luz' }).where(eq(financeEntries.id, paidLast!.id)), u);

    await expect(run((tx) => closeMonth(tx, u.id, today, today), u)).rejects.toThrow('já terminaram');
    await run((tx) => reopenMonth(tx, u.id, last), u);
    await run((tx) => tx.update(financeEntries).set({ amountCents: 999 }).where(eq(financeEntries.id, paidLast!.id)), u);
    const logs = await owner.select().from(auditLogs).where(eq(auditLogs.entity, 'finance_closings'));
    expect(logs.filter((l) => l.tenantId === u.id).map((l) => l.action).sort()).toEqual(['CREATE', 'SOFT_DELETE']);
  });
});

describe('conferência de saldo', () => {
  it('lança a diferença como ajuste e não grava nada quando confere', async () => {
    const u = await newTenant('Conferência');
    const caixa = await account('Caixa da loja', u);
    const today = todayInZone('America/Sao_Paulo');
    expect(await run((tx) => reconcileAccount(tx, u.id, caixa.id, 0, today), u)).toEqual({ diff: 0, entry: null });
    const sobra = await run((tx) => reconcileAccount(tx, u.id, caixa.id, 2550, today), u);
    expect(sobra.entry).toMatchObject({ direction: 'ENTRADA', amountCents: 2550, origin: 'AJUSTE', paidOn: today });
    const falta = await run((tx) => reconcileAccount(tx, u.id, caixa.id, 2000, today), u);
    expect(falta.entry).toMatchObject({ direction: 'SAIDA', amountCents: 550 });
    expect((await account('Caixa da loja', u)).balanceCents).toBe(2000);
  });
});

describe('extratos bancários', () => {
  const pdf = { fileName: 'extrato.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF-1.4 extrato') };
  let u: Tenant;

  beforeAll(async () => {
    u = await newTenant('Extratos');
  });

  it('compara o saldo do extrato com o do sistema na mesma data e lança o ajuste na data do extrato', async () => {
    const banco = await account('Conta bancária', u);
    const outras = await category('Outras receitas', u);
    await run(
      async (tx) =>
        createEntries(tx, u.id, financeEntrySchema.parse({ direction: 'ENTRADA', description: 'Evento', amount: '1.000', categoryId: outras.id, competenceDate: '2026-09-05', dueDate: '2026-09-05', paid: 'on', paidOn: '2026-09-05', accountId: banco.id })),
      u,
    );
    await run(
      async (tx) =>
        createEntries(tx, u.id, financeEntrySchema.parse({ direction: 'ENTRADA', description: 'Evento 2', amount: '500', categoryId: outras.id, competenceDate: '2026-09-20', dueDate: '2026-09-20', paid: 'on', paidOn: '2026-09-20', accountId: banco.id })),
      u,
    );
    expect(await run((tx) => accountBalanceAt(tx, u.id, banco.id, '2026-09-10'), u)).toBe(100_000);

    const file = await run((tx) => createAttachment(tx, u.id, pdf), u);
    const st = await run((tx) => createStatement(tx, u.id, banco.id, statementSchema.parse({ statementDate: '2026-09-10', balance: '1.020,00', attachmentIds: [file] })), u);
    let [listed] = await run((tx) => listStatements(tx, u.id, banco.id), u);
    expect(listed).toMatchObject({ id: st.id, balanceCents: 102_000, systemCents: 100_000, diffCents: 2_000, files: [{ id: file, fileName: 'extrato.pdf' }] });
    expect((await run((tx) => statementSummary(tx, u.id), u)).find((a) => a.accountId === banco.id)).toMatchObject({ count: 1, lastDate: '2026-09-10', lastDiffCents: 2_000 });

    const r = await run((tx) => adjustFromStatement(tx, u.id, st.id), u);
    expect(r.entry).toMatchObject({ direction: 'ENTRADA', amountCents: 2_000, paidOn: '2026-09-10', origin: 'AJUSTE' });
    [listed] = await run((tx) => listStatements(tx, u.id, banco.id), u);
    expect(listed).toMatchObject({ diffCents: 0, adjustmentEntryId: r.entry!.id });
    // O ajuste entra no saldo a partir da data do extrato.
    expect(await run((tx) => accountBalanceAt(tx, u.id, banco.id, '2026-09-30'), u)).toBe(152_000);
  });

  it('ajuste num mês fechado é recusado com a mensagem do fechamento', async () => {
    const banco = await account('Conta bancária', u);
    const file = await run((tx) => createAttachment(tx, u.id, pdf), u);
    const today = todayInZone('America/Sao_Paulo');
    const last = addMonths(`${today.slice(0, 7)}-01`, -1);
    const st = await run((tx) => createStatement(tx, u.id, banco.id, statementSchema.parse({ statementDate: last, balance: '9,99', attachmentIds: [file] })), u);
    await run((tx) => closeMonth(tx, u.id, last, today), u);
    expect(await run((tx) => adjustFromStatement(tx, u.id, st.id), u).then(() => null, (e) => closedMonthMessage(e))).toContain('está fechado');
    await run((tx) => reopenMonth(tx, u.id, last), u);
  });

  it('não aceita conta nem arquivos de outra unidade; exclusão lógica com auditoria', async () => {
    const other = await newTenant('Extratos 2');
    const theirFile = await run((tx) => createAttachment(tx, other.id, pdf), other);
    const banco = await account('Conta bancária', u);
    await expect(
      run((tx) => createStatement(tx, u.id, banco.id, statementSchema.parse({ statementDate: '2026-09-01', balance: '1', attachmentIds: [theirFile] })), u),
    ).rejects.toThrow('não foi encontrado');
    // Gravando direto, o banco também recusa.
    await expect(
      run((tx) => tx.execute(sql`insert into finance_statements (tenant_id, account_id, statement_date, balance_cents, attachment_ids) values (${u.id}, ${banco.id}, '2026-09-01', 1, ${`{${theirFile}}`}::uuid[])`), u),
    ).rejects.toMatchObject({ cause: { message: 'Algum arquivo do extrato pertence a outra unidade' } });

    const mine = await run((tx) => createAttachment(tx, u.id, pdf), u);
    const st = await run((tx) => createStatement(tx, u.id, banco.id, statementSchema.parse({ statementDate: '2026-09-02', balance: '1', attachmentIds: [mine] })), u);
    expect(await run((tx) => listStatements(tx, u.id, banco.id), other)).toEqual([]);
    await run((tx) => setStatementStatus(tx, u.id, st.id, false), u);
    expect((await run((tx) => listStatements(tx, u.id, banco.id), u)).map((s) => s.id)).not.toContain(st.id);
    const logs = await owner.select().from(auditLogs).where(eq(auditLogs.entityId, st.id));
    expect(logs.map((l) => l.action).sort()).toEqual(['CREATE', 'SOFT_DELETE']);
    expect((logs.find((l) => l.action === 'CREATE')!.after as { attachment_ids: string[] }).attachment_ids).toEqual([mine]);
    await expect(run((tx) => tx.execute(sql`delete from finance_statements where id = ${st.id}`), u)).rejects.toThrow();
  });
});
