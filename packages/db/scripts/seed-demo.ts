// Dados de demonstração para o ambiente LOCAL: ~6 meses de pedidos realistas na Matriz
// (clientes, delivery/encomendas/festas, etapas, cancelamentos, horários de pico).
// Recusa rodar fora do localhost. Para "zerar", apague a pasta .data/pg e rode db:migrate + db:seed.
import { requireEnv } from './env';
import { todayInZone, zonedTimeToUtc, type OrderStage, type OrderType } from '@zaraki/core';
import { and, eq, sql } from 'drizzle-orm';
import { createDb } from '../src/client';
import { withContext } from '../src/context';
import { addDays, addMonths } from '@zaraki/core';
import type { Tx } from '../src/client';
import { backfillOrderFinance, ensureFinanceDefaults } from '../src/finance';
import { calendarSyncJobs, customers, financeAccounts, financeCategories, financeEntries, orderCounters, orderItems, orders, orderStageHistory, products, tenants } from '../src/schema';

const url = requireEnv('DATABASE_URL');
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error('seed-demo só roda no banco local (DATABASE_URL precisa apontar para localhost).');
  process.exit(1);
}

const db = createDb(url, 1);
const slug = process.env.DEFAULT_TENANT_SLUG ?? 'matriz';
const DAYS = Number(process.env.DEMO_DAYS ?? 180);

// Gerador pseudoaleatório determinístico (mesmos dados a cada execução num banco novo).
let seed = 20261011;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
const weighted = <T>(xs: readonly [T, number][]) => {
  let r = rand() * xs.reduce((s, [, w]) => s + w, 0);
  for (const [x, w] of xs) if ((r -= w) <= 0) return x;
  return xs[0]![0];
};

const FIRST = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Felipe', 'Gabriela', 'Henrique', 'Isabela', 'João', 'Larissa', 'Marcos', 'Natália', 'Otávio', 'Paula', 'Rafael', 'Sofia', 'Thiago', 'Vanessa', 'William'];
const LAST = ['Almeida', 'Barbosa', 'Cardoso', 'Dias', 'Ferreira', 'Gomes', 'Lima', 'Martins', 'Oliveira', 'Pereira', 'Ribeiro', 'Santos', 'Souza', 'Teixeira', 'Vieira'];
const BAIRROS = ['Setor Bueno', 'Setor Marista', 'Jardim Goiás', 'Setor Oeste', 'Setor Sul', 'Alphaville Flamboyant', 'Jardim América', 'Setor Pedro Ludovico', 'Parque Amazônia', 'Setor Nova Suíça'];
const REASONS = ['Cliente desistiu', 'Endereço fora da área de entrega', 'Cliente não respondeu', 'Data indisponível', 'Pedido duplicado'];

await withContext({ platformAdmin: true, actorLabel: 'demo', allowBackdate: true }, async (tx) => {
  const [tenant] = await tx.select().from(tenants).where(and(eq(tenants.slug, slug), eq(tenants.status, true)));
  if (!tenant) throw new Error(`Unidade "${slug}" não encontrada: rode pnpm db:seed antes.`);
  const tz = tenant.timezone;

  // Custos realistas (~32% do preço) para os relatórios de margem, se ainda não cadastrados.
  await tx.update(products).set({ costCents: sql`round(${products.priceCents} * 0.32)` }).where(and(eq(products.tenantId, tenant.id), eq(products.costCents, 0)));
  const menu = await tx.select().from(products).where(and(eq(products.tenantId, tenant.id), eq(products.status, true)));
  if (!menu.length) throw new Error('Cardápio vazio: rode pnpm db:seed antes.');

  const people = await tx
    .insert(customers)
    .values(
      Array.from({ length: 140 }, (_, i) => ({
        tenantId: tenant.id,
        name: `${pick(FIRST)} ${pick(LAST)}`,
        phone: `+55629${String(80000000 + i * 7919).padStart(8, '0')}`,
        neighborhood: pick(BAIRROS),
        birthday: rand() < 0.6 ? `19${70 + Math.floor(rand() * 30)}-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}` : null,
        notes: 'demo',
      })),
    )
    .onConflictDoNothing()
    .returning();
  // Uma parte dos clientes compra com frequência (fiéis), o resto de vez em quando.
  const loyal = people.slice(0, 25);

  const [counter] = await tx.select().from(orderCounters).where(eq(orderCounters.tenantId, tenant.id));
  let code = counter?.lastValue ?? 0;
  const today = todayInZone(tz);
  const nowMs = Date.now();
  let created = 0;

  for (let d = -DAYS; d <= 30; d++) {
    const day = new Date(Date.parse(`${today}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    const growth = 0.6 + 0.4 * ((d + DAYS) / DAYS); // a operação cresce ao longo do semestre
    const base = (weekday === 5 || weekday === 6 ? 9 : weekday === 0 ? 7 : 4) * growth;
    const count = d > 0 ? Math.round(rand() * 1.5) : Math.round(base * (0.6 + rand() * 0.8));

    for (let n = 0; n < count; n++) {
      const type: OrderType = d > 0 ? weighted([['ENCOMENDA', 3], ['FESTA', 1]]) : weighted([['DELIVERY', 72], ['ENCOMENDA', 19], ['FESTA', 9]]);
      const hour = type === 'FESTA' ? pick([18, 19, 20]) : weighted([[11, 1], [12, 2], [13, 1], [18, 3], [19, 6], [20, 6], [21, 4], [22, 2]]);
      const when = zonedTimeToUtc(day, `${String(hour).padStart(2, '0')}:${pick(['00', '15', '30', '45'])}`, tz);
      if (d <= 0 && when.getTime() > nowMs) continue;

      const guests = type === 'FESTA' ? 15 + Math.floor(rand() * 60) : null;
      const tubes = type === 'FESTA' ? Math.max(4, Math.round((guests ?? 20) * (0.35 + rand() * 0.3))) : type === 'ENCOMENDA' ? 3 + Math.floor(rand() * 6) : 1 + Math.floor(rand() * 3);
      const qty = new Map<string, number>();
      for (let t = 0; t < tubes; t++) {
        const p = weighted(menu.map((m, i) => [m, [5, 3, 2, 2][i] ?? 1] as [typeof m, number]));
        qty.set(p.id, (qty.get(p.id) ?? 0) + 1);
      }
      const lines = [...qty].map(([id, q]) => {
        const p = menu.find((m) => m.id === id)!;
        return { p, q, total: p.priceCents * q };
      });
      const subtotal = lines.reduce((s, l) => s + l.total, 0);
      const fee = type === 'DELIVERY' ? pick([0, 500, 800, 1000]) : 0;
      const customer = rand() < 0.45 ? pick(loyal) : pick(people);

      const past = d < 0 || (d === 0 && hour < new Date().getUTCHours() - 4);
      const stage: OrderStage = d > 0 ? weighted([['CONFIRMADO', 4], ['NOVO', 1]]) : past ? weighted([['ENTREGUE', 92], ['CANCELADO', 6], ['CONFIRMADO', 2]]) : weighted([['NOVO', 2], ['CONFIRMADO', 2], ['EM_PREPARO', 1]]);
      const receivedAt = type === 'DELIVERY' ? when : new Date(when.getTime() - (2 + Math.floor(rand() * 10)) * 86_400_000);
      if (receivedAt.getTime() > nowMs) continue;

      const [row] = await tx
        .insert(orders)
        .values({
          tenantId: tenant.id,
          code: `${tenant.orderCodePrefix}-${String(++code).padStart(6, '0')}`,
          type,
          stage,
          customerId: customer.id,
          scheduledAt: type === 'DELIVERY' ? null : when,
          guests,
          neighborhood: customer.neighborhood,
          address: type === 'DELIVERY' ? `Rua ${1 + Math.floor(rand() * 90)}, ${10 + Math.floor(rand() * 900)}` : null,
          subtotalCents: subtotal,
          deliveryFeeCents: fee,
          totalCents: subtotal + fee,
          source: weighted([['SITE', 55], ['WHATSAPP', 35], ['BALCAO', 10]]),
          paymentMethod: pick(['PIX', 'PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'DINHEIRO'] as const),
          paid: stage === 'ENTREGUE',
          paidAt: stage === 'ENTREGUE' ? when : null,
          cancelReason: stage === 'CANCELADO' ? pick(REASONS) : null,
          calendarSyncState: type === 'DELIVERY' ? 'NAO_APLICA' : 'PENDENTE',
          createdAt: receivedAt,
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
          qty: l.q,
          lineTotalCents: l.total,
          createdAt: receivedAt,
        })),
      );

      // Histórico de etapas com tempos plausíveis (delivery leva ~40–90 min até a entrega).
      const flow: OrderStage[] = ['NOVO', 'CONFIRMADO', 'EM_PREPARO', 'PRONTO', 'SAIU_PARA_ENTREGA', 'ENTREGUE'];
      const steps = stage === 'CANCELADO' ? (['NOVO', 'CANCELADO'] as OrderStage[]) : flow.slice(0, flow.indexOf(stage) + 1);
      let t = receivedAt.getTime();
      const deliveryStart = type === 'DELIVERY' ? t : when.getTime() - 90 * 60_000;
      let prev: OrderStage | null = null;
      for (const [i, s] of steps.entries()) {
        if (i === 1) t += (5 + rand() * 20) * 60_000;
        if (s === 'EM_PREPARO') t = Math.max(t, deliveryStart) + (5 + rand() * 10) * 60_000;
        if (i > 2) t += (8 + rand() * 20) * 60_000;
        await tx.insert(orderStageHistory).values({
          tenantId: tenant.id,
          orderId: row!.id,
          fromStage: prev,
          toStage: s,
          note: s === 'CANCELADO' ? row!.cancelReason : null,
          createdAt: new Date(t),
        });
        prev = s;
      }
      if (type !== 'DELIVERY' && d > 0) await tx.insert(calendarSyncJobs).values({ tenantId: tenant.id, orderId: row!.id, op: 'UPSERT' });
      created++;
    }
  }

  await tx
    .insert(orderCounters)
    .values({ tenantId: tenant.id, lastValue: code })
    .onConflictDoUpdate({ target: orderCounters.tenantId, set: { lastValue: code } });
  // Pedidos pagos entram no caixa (Financeiro).
  const entries = await backfillOrderFinance(tx);
  console.log(`Financeiro: ${entries} vendas lançadas no caixa.`);
  console.log(`Financeiro: ${await seedDemoExpenses(tx, tenant.id, tz)} despesas de demonstração.`);
  console.log(`Demonstração criada: ${people.length} clientes e ${created} pedidos em ${tenant.name}.`);
}, db);

await db.$client.end();

/**
 * Despesas típicas de um restaurante japonês, proporcionais às vendas da demonstração:
 * fixas mensais (aluguel, salários, energia...), compras semanais de insumos, impostos e um investimento
 * parcelado. O que vence até hoje sai pago; o resto fica "a pagar". Uma conta fica vencida de propósito.
 */
async function seedDemoExpenses(tx: Tx, tenantId: string, tz: string) {
  const [existing] = await tx.select({ id: financeEntries.id }).from(financeEntries).where(and(eq(financeEntries.tenantId, tenantId), eq(financeEntries.notes, 'demo')));
  if (existing) return 0;
  await ensureFinanceDefaults(tx, tenantId);
  const today = todayInZone(tz);
  const cats = await tx.select().from(financeCategories).where(and(eq(financeCategories.tenantId, tenantId), eq(financeCategories.status, true)));
  const accs = await tx.select().from(financeAccounts).where(and(eq(financeAccounts.tenantId, tenantId), eq(financeAccounts.status, true)));
  const cat = (name: string) => cats.find((c) => c.name === name)!.id;
  const bank = accs.find((a) => a.kind === 'BANCO')!.id;
  const cash = accs.find((a) => a.kind === 'CAIXA')!.id;

  // Vendas entregues por semana (segunda-feira) e entregas de delivery, no fuso da unidade.
  const weeks = (
    await tx.execute<{ week: string; revenue: number; deliveries: number }>(sql`
      select to_char(date_trunc('week', (coalesce(scheduled_at, created_at) at time zone ${tz})::date), 'YYYY-MM-DD') as week,
             sum(total_cents)::float8 as revenue, count(*) filter (where type = 'DELIVERY')::int as deliveries
        from orders where tenant_id = ${tenantId} and status and stage = 'ENTREGUE' group by 1 order by 1`)
  ).rows;
  if (!weeks.length) return 0;
  const monthly = weeks.reduce((s, w) => s + w.revenue, 0) / Math.max(1, weeks.length / 4.33);

  type Row = typeof financeEntries.$inferInsert;
  const rows: Row[] = [];
  const add = (r: { name: string; description: string; cents: number; competence: string; due: string; who?: string; account?: string }) => {
    const paid = r.due <= today;
    rows.push({
      tenantId,
      direction: 'SAIDA',
      description: r.description,
      amountCents: Math.max(100, Math.round(r.cents)),
      categoryId: cat(r.name),
      accountId: r.account ?? bank,
      competenceDate: r.competence,
      dueDate: r.due,
      paidOn: paid ? r.due : null,
      paymentMethod: paid ? (r.account === cash ? 'DINHEIRO' : 'PIX') : null,
      counterparty: r.who ?? null,
      notes: 'demo',
    });
  };

  // Compras semanais, proporcionais às vendas da semana (pagas na segunda seguinte).
  for (const w of weeks) {
    const due = addDays(w.week, 7);
    add({ name: 'Insumos: peixes e frutos do mar', description: 'Salmão, atum e camarão da semana', cents: w.revenue * (0.2 + rand() * 0.03), competence: w.week, due, who: 'Peixaria Goiás' });
    add({ name: 'Insumos: arroz, nori e mercearia', description: 'Arroz japonês, nori, shoyu e mercearia', cents: w.revenue * 0.06, competence: w.week, due, who: 'Distribuidora Oriental' });
    add({ name: 'Hortifrúti', description: 'Hortifrúti da semana', cents: w.revenue * 0.02, competence: w.week, due: w.week, who: 'Ceasa Goiânia', account: cash });
    add({ name: 'Embalagens', description: 'Embalagens para delivery', cents: w.revenue * 0.03, competence: w.week, due, who: 'Embalagens Centro-Oeste' });
    add({ name: 'Bebidas', description: 'Bebidas', cents: w.revenue * 0.02, competence: w.week, due, who: 'Distribuidora de Bebidas GO' });
    if (w.deliveries) add({ name: 'Entregas e motoboys', description: `Entregas da semana (${w.deliveries})`, cents: w.deliveries * 700, competence: w.week, due, who: 'Motoboys', account: cash });
  }

  // Contas fixas mensais (do primeiro mês com vendas até o mês que vem).
  const fixed: [string, string, number, number, string?][] = [
    ['Aluguel', 'Aluguel do ponto', 0.1, 10, 'Imobiliária Goiânia'],
    ['Salários e encargos', 'Folha de pagamento', 0.22, 5],
    ['Pró-labore', 'Pró-labore dos sócios', 0.06, 5],
    ['Energia', 'Conta de energia', 0.03, 15, 'Equatorial Goiás'],
    ['Água', 'Conta de água', 0.006, 15, 'Saneago'],
    ['Gás', 'Gás (cilindros)', 0.01, 20, 'Gás Goiano'],
    ['Internet e telefone', 'Internet e telefone', 0.003, 12],
    ['Contabilidade', 'Honorários contábeis', 0.012, 10, 'Contabilidade Silva'],
    ['Sistemas e assinaturas', 'Sistemas e assinaturas', 0.004, 8],
    ['Marketing', 'Anúncios e redes sociais', 0.02, 25],
    ['Tarifas bancárias', 'Tarifa da conta', 0.001, 1],
  ];
  const first = `${weeks[0]!.week.slice(0, 7)}-01`;
  // A loja já existia antes do período da demonstração: começa com reserva de ~2 meses de despesas fixas.
  await tx
    .update(financeAccounts)
    .set({ openingBalanceCents: Math.round(monthly * 0.9), openingDate: addDays(first, -1) })
    .where(eq(financeAccounts.id, bank));
  for (let m = first; m <= addMonths(`${today.slice(0, 7)}-01`, 1); m = addMonths(m, 1)) {
    for (const [name, description, share, day, who] of fixed) {
      add({ name, description, cents: monthly * share * (0.95 + rand() * 0.1), competence: m, due: addDays(m, day - 1), who });
    }
    // Simples Nacional: ~6% das vendas do mês anterior, vence dia 20 (a partir do segundo mês).
    if (m > first) add({ name: 'Simples Nacional (DAS)', description: 'DAS do mês anterior', cents: monthly * 0.06, competence: addMonths(m, -1), due: addDays(m, 19) });
  }

  // Investimento: freezer novo em 3 parcelas, a primeira há dois meses.
  const freezer = addMonths(`${today.slice(0, 7)}-05`, -2);
  for (let i = 0; i < 3; i++) {
    add({ name: 'Equipamentos', description: `Freezer horizontal (${i + 1}/3)`, cents: 160000, competence: freezer, due: addMonths(freezer, i), who: 'Refrigeração Goiás' });
  }
  // Uma conta vencida e não paga, para o painel mostrar o alerta.
  const late = addDays(today, -3);
  rows.push({ tenantId, direction: 'SAIDA', description: 'Manutenção do ar-condicionado', amountCents: 45000, categoryId: cat('Manutenção e limpeza'), competenceDate: late, dueDate: late, counterparty: 'Clima Frio', notes: 'demo' });

  for (let i = 0; i < rows.length; i += 200) await tx.insert(financeEntries).values(rows.slice(i, i + 200));
  return rows.length;
}
