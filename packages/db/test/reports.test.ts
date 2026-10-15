import { previousPeriod, todayInZone, type OrderStage, type OrderType } from '@zaraki/core';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDb, findReport, withContext, type ReportParams, type ReportResult } from '../src';
import { customers, orderItems, orders, orderStageHistory, products, tenants } from '../src/schema';

const db = createDb(inject('appUrl'), 5);
afterAll(() => db.$client.end());

const TZ = 'America/Sao_Paulo';
type Tenant = typeof tenants.$inferSelect;
type Product = typeof products.$inferSelect;
let A: Tenant;
let B: Tenant;
const P: Record<string, Product> = {};
const C: Record<string, string> = {};
let seq = 0;

/** Horário local de Goiânia (UTC−3) → instante UTC. */
const at = (day: string, hour: number, plusMinutes = 0) =>
  new Date(Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00-03:00`) + plusMinutes * 60_000);

async function order(
  tenant: Tenant,
  o: {
    customer: string;
    type: OrderType;
    day: string;
    hour: number;
    items: [Product, number][];
    stage: OrderStage;
    reason?: string;
    guests?: number;
    deliveredAfter?: number;
  },
) {
  const created = at(o.day, o.hour);
  const lines = o.items.map(([p, qty]) => ({ p, qty, total: p.priceCents * qty }));
  const total = lines.reduce((s, l) => s + l.total, 0);
  await withContext(
    { tenantId: tenant.id, allowBackdate: true },
    async (tx) => {
      const [row] = await tx
        .insert(orders)
        .values({
          tenantId: tenant.id,
          code: `T-${++seq}`,
          type: o.type,
          stage: o.stage,
          customerId: C[o.customer]!,
          scheduledAt: o.type === 'DELIVERY' ? null : created,
          guests: o.guests ?? null,
          subtotalCents: total,
          totalCents: total,
          source: 'SITE',
          cancelReason: o.reason ?? null,
          createdAt: created,
        })
        .returning();
      await tx.insert(orderItems).values(
        lines.map((l) => ({
          tenantId: tenant.id,
          orderId: row!.id,
          productId: l.p.id,
          productName: l.p.name,
          unitPriceCents: l.p.priceCents,
          unitCostCents: l.p.costCents,
          qty: l.qty,
          lineTotalCents: l.total,
        })),
      );
      const history: { toStage: OrderStage; createdAt: Date }[] = [{ toStage: 'NOVO', createdAt: created }];
      if (o.stage === 'CANCELADO') history.push({ toStage: 'CANCELADO', createdAt: at(o.day, o.hour, 5) });
      else if (o.stage !== 'NOVO') history.push({ toStage: 'CONFIRMADO', createdAt: at(o.day, o.hour, 10) });
      if (o.stage === 'ENTREGUE') history.push({ toStage: 'ENTREGUE', createdAt: at(o.day, o.hour, o.deliveredAfter ?? 60) });
      await tx.insert(orderStageHistory).values(history.map((h) => ({ ...h, tenantId: tenant.id, orderId: row!.id })));
    },
    db,
  );
}

beforeAll(async () => {
  await withContext(
    { platformAdmin: true },
    async (tx) => {
      [A] = (await tx.insert(tenants).values({ name: 'Unidade A', slug: `ra-${randomUUID()}`, kind: 'MATRIZ' }).returning()) as [Tenant];
      [B] = (await tx.insert(tenants).values({ name: 'Unidade B', slug: `rb-${randomUUID()}`, royaltyPct: '6' }).returning()) as [Tenant];
      const items = await tx
        .insert(products)
        .values([
          { tenantId: A.id, name: 'Salmão', slug: 's', priceCents: 5000, costCents: 2000 },
          { tenantId: A.id, name: 'Especial', slug: 'e', priceCents: 6000, costCents: 0 },
          { tenantId: A.id, name: 'Hossomaki', slug: 'h', priceCents: 1000, costCents: 300 },
          { tenantId: B.id, name: 'Salmão', slug: 's', priceCents: 5000, costCents: 2000 },
        ])
        .returning();
      [P.salmao, P.especial, P.hosso, P.salmaoB] = items as Product[];
      const cs = await tx
        .insert(customers)
        .values([
          { tenantId: A.id, name: 'Cliente 1', phone: '+5562900000001' },
          { tenantId: A.id, name: 'Cliente 2', phone: '+5562900000002' },
          { tenantId: A.id, name: 'Cliente 3', phone: '+5562900000003' },
          { tenantId: B.id, name: 'Cliente B', phone: '+5562900000004' },
        ])
        .returning();
      [C.c1, C.c2, C.c3, C.cb] = cs.map((c) => c.id);
    },
    db,
  );

  // Setembro/2026 na unidade A
  await order(A, { customer: 'c1', type: 'DELIVERY', day: '2026-09-05', hour: 19, items: [[P.salmao!, 2]], stage: 'ENTREGUE', deliveredAfter: 50 });
  await order(A, { customer: 'c1', type: 'DELIVERY', day: '2026-09-20', hour: 20, items: [[P.especial!, 1], [P.hosso!, 1]], stage: 'ENTREGUE', deliveredAfter: 70 });
  await order(A, { customer: 'c2', type: 'FESTA', day: '2026-09-12', hour: 19, items: [[P.salmao!, 10], [P.especial!, 5]], stage: 'ENTREGUE', guests: 30 });
  await order(A, { customer: 'c3', type: 'DELIVERY', day: '2026-09-10', hour: 21, items: [[P.salmao!, 1]], stage: 'CANCELADO', reason: 'Cliente desistiu' });
  // Período anterior (agosto) e outra unidade
  await order(A, { customer: 'c3', type: 'DELIVERY', day: '2026-08-15', hour: 19, items: [[P.salmao!, 1]], stage: 'ENTREGUE' });
  await order(B, { customer: 'cb', type: 'DELIVERY', day: '2026-09-07', hour: 19, items: [[P.salmaoB!, 2]], stage: 'ENTREGUE' });
  // Encomenda futura (daqui a 3 dias), para a carteira e a previsão de produção
  const future = new Date(Date.parse(`${todayInZone(TZ)}T12:00:00Z`) + 3 * 86_400_000).toISOString().slice(0, 10);
  await order(A, { customer: 'c2', type: 'ENCOMENDA', day: future, hour: 12, items: [[P.salmao!, 4]], stage: 'CONFIRMADO' });
});

const params = (tenantIds: string[], extra: Record<string, string> = {}): ReportParams => ({
  tenantIds,
  timezone: TZ,
  from: '2026-09-01',
  to: '2026-09-30',
  days: 30,
  previous: previousPeriod({ from: '2026-09-01', days: 30 }),
  extra,
});

async function run(slug: string, tenantIds: string[] = [A.id], extra?: Record<string, string>): Promise<ReportResult> {
  const report = findReport(slug)!;
  const ctx = report.network ? { platformAdmin: true } : { tenantId: tenantIds[0] };
  return withContext(ctx, (tx) => report.run(tx, params(tenantIds, extra)), db);
}

const summary = (r: ReportResult, label: string) => r.summary!.find((s) => s.label === label)!;

describe('relatórios', () => {
  it('faturamento: só pedidos entregues, com comparação, ticket e carteira', async () => {
    const r = await run('faturamento');
    expect(summary(r, 'Faturamento')).toMatchObject({ value: 97000, previous: 5000 });
    expect(summary(r, 'Pedidos entregues')).toMatchObject({ value: 3, previous: 1 });
    expect(summary(r, 'Ticket médio').value).toBeCloseTo(97000 / 3);
    expect(summary(r, 'Carteira (festas e eventos futuros)').value).toBe(20000);
    expect(r.rows).toHaveLength(30); // todos os dias do mês, inclusive sem venda
    expect(r.rows.find((x) => x.periodo === '2026-09-12')).toMatchObject({ faturamento: 80000, pedidos: 1 });
  });

  it('vendas por tipo', async () => {
    const r = await run('vendas-por-tipo');
    expect(r.rows.map((x) => [x.nome, x.faturamento])).toEqual([
      ['Festa', 80000],
      ['Delivery', 17000],
    ]);
  });

  it('ranking de sabores com curva ABC', async () => {
    const r = await run('ranking-sabores');
    expect(r.rows.map((x) => [x.sabor, x.tubos, x.faturamento, x.curva])).toEqual([
      ['Salmão', 12, 60000, 'A'],
      ['Especial', 6, 36000, 'A'],
      ['Hossomaki', 1, 1000, 'C'],
    ]);
  });

  it('margem e CMV avisam quando falta custo', async () => {
    const r = await run('margem-cmv');
    expect(r.rows.find((x) => x.sabor === 'Salmão')).toMatchObject({ custo: 24000, margem: 36000, cmv: 40 });
    expect(summary(r, 'Custo dos insumos (CMV)').value).toBe(24300);
    expect(r.note).toContain('Especial');
  });

  it('funil, tempo de entrega e cancelamentos', async () => {
    const f = await run('funil-etapas');
    const byStage = Object.fromEntries(f.rows.map((x) => [x.etapa, x.pedidos]));
    expect(byStage).toMatchObject({ Novo: 4, Confirmado: 3, Entregue: 3, Cancelado: 1 });
    expect(summary(f, 'Tempo médio de entrega (delivery)').value).toBe(60); // (50 + 70) / 2

    const c = await run('cancelamentos');
    expect(summary(c, 'Taxa de cancelamento').value).toBe(25);
    expect(c.rows).toEqual([{ motivo: 'Cliente desistiu', pedidos: 1, valor: 5000 }]);
  });

  it('recompra considera só clientes que compraram no período', async () => {
    const r = await run('recompra');
    expect(summary(r, 'Taxa de recompra').value).toBe(50); // Cliente 1 (2 pedidos) de 2 clientes
  });

  it('festas e previsão de produção', async () => {
    const f = await run('festas');
    expect(f.rows).toMatchObject([{ convidados: 30, tubos: 15, porConvidado: 0.5 }]);

    const p = await run('previsao-producao', [A.id], { dias: '7' });
    expect(summary(p, 'Tubos a produzir')).toMatchObject({ value: 4, hint: '40 peças' });
    expect(p.rows).toMatchObject([{ sabor: 'Salmão', tubos: 4 }]);
  });

  it('royalties e ranking da rede somam todas as unidades', async () => {
    const r = await run('royalties', [A.id, B.id]);
    expect(r.rows).toEqual([
      { unidade: 'Unidade A', tipo: 'Matriz', faturamento: 97000, percentual: 0, royalties: 0 },
      { unidade: 'Unidade B', tipo: 'Franquia', faturamento: 10000, percentual: 6, royalties: 600 },
    ]);
    const ranking = await run('ranking-unidades', [A.id, B.id]);
    expect(summary(ranking, 'Faturamento da rede')).toMatchObject({ value: 107000, previous: 5000 });
  });

  it('a unidade não enxerga dados de outra mesmo pedindo por ela', async () => {
    // Contexto da unidade A pedindo também a B: o RLS devolve só a A.
    const r = await withContext({ tenantId: A.id }, (tx) => findReport('faturamento')!.run(tx, params([A.id, B.id])), db);
    expect(summary(r, 'Faturamento').value).toBe(97000);
  });

  it('todos os relatórios rodam sem erro', async () => {
    for (const report of (await import('../src')).REPORTS) {
      const extra = Object.fromEntries((report.extraParams ?? []).map((e) => [e.name, e.default('2026-09-15')]));
      const r = await run(report.slug, report.network ? [A.id, B.id] : [A.id], extra);
      expect(Array.isArray(r.rows), report.slug).toBe(true);
    }
  });
});
