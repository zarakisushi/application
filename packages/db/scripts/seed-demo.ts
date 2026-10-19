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
import { backfillOrderStock, createStockMovement, createStockPurchase, createSuggestedStockItems, listStockItems, saveRecipe } from '../src/stock';
import { calendarSyncJobs, customers, financeAccounts, financeCategories, financeEntries, memberships, orderCounters, orderItems, orders, orderStageHistory, products, suppliers, tasks, tenants, users } from '../src/schema';

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
  console.log(`Estoque: ${await seedDemoStock(tx, tenant.id, tz)} itens com fichas técnicas, compras e baixas.`);
  console.log(`Tarefas: ${await seedDemoTasks(tx, tenant.id, tz)} afazeres da equipe.`);
  console.log(`Fornecedores: ${await seedDemoSuppliers(tx, tenant.id)} cadastros.`);
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

/**
 * Estoque de demonstração: itens sugeridos, fichas técnicas dos sabores, baixa dos pedidos entregues e uma
 * compra que repõe o consumo (alguns itens ficam abaixo do mínimo de propósito), mais algumas perdas.
 */
async function seedDemoStock(tx: Tx, tenantId: string, tz: string) {
  const [already] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from stock_items where tenant_id = ${tenantId}`).then((r) => r.rows);
  if (already!.n) return 0;
  await createSuggestedStockItems(tx, tenantId);
  const items = (await listStockItems(tx, tenantId, { pageSize: 1000 })).rows;
  const id = (name: string) => items.find((i) => i.name === name)!.id;
  const base = [
    { itemId: id('Arroz para sushi'), qty: 0.12 },
    { itemId: id('Alga nori'), qty: 1 },
    { itemId: id('Vinagre de arroz'), qty: 0.01 },
    { itemId: id('Tubo Push Pop'), qty: 1 },
    { itemId: id('Tampa do tubo'), qty: 1 },
    { itemId: id('Adesivo de lacre'), qty: 1 },
    { itemId: id('Shoyu (sachê)'), qty: 1 },
  ];
  const extra: Record<string, { itemId: string; qty: number }[]> = {
    'uramaki-salmao-cream-cheese': [{ itemId: id('Salmão'), qty: 0.06 }, { itemId: id('Cream cheese'), qty: 0.025 }],
    'uramaki-salmao-manga': [{ itemId: id('Salmão'), qty: 0.06 }, { itemId: id('Manga'), qty: 0.03 }],
    'uramaki-camarao-cream-cheese': [{ itemId: id('Camarão'), qty: 0.05 }, { itemId: id('Cream cheese'), qty: 0.025 }],
    'uramaki-especial-salmao-camarao': [{ itemId: id('Salmão'), qty: 0.05 }, { itemId: id('Camarão'), qty: 0.04 }, { itemId: id('Gergelim'), qty: 0.003 }],
  };
  const menu = await tx.select().from(products).where(and(eq(products.tenantId, tenantId), eq(products.status, true)));
  for (const p of menu) await saveRecipe(tx, tenantId, p.id, { lines: [...base, ...(extra[p.slug] ?? [{ itemId: id('Salmão'), qty: 0.06 }])] });
  await backfillOrderStock(tx, tenantId);

  // Compra recente que cobre o consumo; alguns itens ficam abaixo do mínimo para o painel mostrar o alerta.
  const today = todayInZone(tz);
  const PRICE: Record<string, number> = { kg: 0, folha: 45, un: 55, l: 1200, cx: 3500, rolo: 2900 };
  const unitPrice: Record<string, number> = { 'Salmão': 9200, 'Camarão': 7800, 'Arroz para sushi': 1450, 'Cream cheese': 4200, 'Manga': 900, 'Gergelim': 3800, 'Panfleto': 18, 'Adesivo da marca': 25, 'Sacola para delivery': 60 };
  const short = new Set(['Camarão', 'Adesivo de lacre', 'Panfleto']);
  const lines = [];
  for (const i of (await listStockItems(tx, tenantId, { pageSize: 1000 })).rows) {
    const target = i.minQty * (short.has(i.name) ? 0.6 : 1.8);
    const qty = Math.round((Math.max(0, -i.balance) + target) * 100) / 100;
    if (qty <= 0) continue;
    const cents = Math.max(100, Math.round(qty * (unitPrice[i.name] ?? PRICE[i.unit] ?? 100)));
    lines.push({ itemId: i.id, qty, totalCents: cents });
  }
  await createStockPurchase(tx, tenantId, {
    supplier: 'Atacado Oriental (demonstração)',
    purchasedOn: addDays(today, -3),
    dueDate: addDays(today, 7),
    paidOn: null,
    accountId: null,
    paymentMethod: null,
    notes: 'demo',
    attachmentId: null,
    paid: false,
    lines,
  });
  await createStockMovement(tx, tenantId, { itemId: id('Salmão'), kind: 'PERDA', qty: 0.4, occurredOn: addDays(today, -2), notes: 'Peixe passou da validade (demo)' });
  await createStockMovement(tx, tenantId, { itemId: id('Tubo Push Pop'), kind: 'PERDA', qty: 12, occurredOn: addDays(today, -1), notes: 'Tubos danificados no transporte (demo)' });
  return items.length;
}

/** Afazeres típicos da equipe: um atrasado, alguns de hoje (um já feito) e outros da semana. */
async function seedDemoTasks(tx: Tx, tenantId: string, tz: string) {
  const [existing] = await tx.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(tasks).where(eq(tasks.tenantId, tenantId));
  if (existing!.n > 0) return 0;
  const team = await tx
    .select({ id: users.id })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, true), eq(users.status, true)))
    .orderBy(users.name);
  const person = (i: number) => team[i % Math.max(team.length, 1)]?.id ?? null;
  const today = todayInZone(tz);
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const sunday = addDays(today, dow === 0 ? 0 : 7 - dow);
  const demo: { title: string; due: string; important?: boolean; assignee?: string | null; notes?: string; done?: boolean }[] = [
    { title: 'Pedir salmão para sexta', due: addDays(today, -1), important: true, assignee: person(0), notes: 'Peixaria Goiás: 8 kg. Confirmar o horário de entrega.' },
    { title: 'Conferir a validade do cream cheese', due: today, assignee: person(2) },
    { title: 'Postar story do Push Pop da semana', due: today },
    { title: 'Abrir o caixa e conferir o troco', due: today, assignee: person(0), done: true },
    { title: 'Limpar o freezer', due: sunday },
    { title: 'Repor panfletos no balcão', due: sunday, assignee: person(2) },
  ];
  for (const t of demo) {
    const [row] = await tx
      .insert(tasks)
      .values({ tenantId, title: t.title, notes: t.notes ?? null, dueDate: t.due, important: t.important ?? false, assigneeUserId: t.assignee ?? null })
      .returning({ id: tasks.id });
    const doneBy = person(0);
    if (t.done && doneBy) await tx.update(tasks).set({ doneAt: new Date(), doneBy }).where(eq(tasks.id, row!.id));
  }
  return demo.length;
}

/** Fornecedores típicos de um delivery de sushi em Goiânia (a Peixaria fica compartilhada com a rede). */
async function seedDemoSuppliers(tx: Tx, tenantId: string) {
  const [existing] = await tx.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(suppliers).where(eq(suppliers.tenantId, tenantId));
  if (existing!.n > 0) return 0;
  const base = { personKind: 'PJ', state: 'GO', paymentMethods: ['PIX', 'BOLETO'] };
  const demo: (typeof suppliers.$inferInsert)[] = [
    {
      ...base, tenantId, name: 'Peixaria Goiás', legalName: 'Peixaria Goiás Comércio de Pescados Ltda.', document: '12345678000195',
      categories: ['PEIXES'], contactName: 'Marcos', whatsapp: '+5562981234567', phone: '+556232410001', email: 'vendas@peixariagoias.com.br',
      cep: '74230010', street: 'Avenida T-9', number: '1500', district: 'Setor Bueno', city: 'Goiânia',
      deliveryDays: [2, 5], minOrderCents: 50000, paymentTerms: '14 dias', rating: 5, networkShared: true,
      notes: 'Pedido até 16h para entrega no dia seguinte. Salmão chileno toda terça.',
    },
    {
      ...base, tenantId, name: 'Atacado Oriental', legalName: 'Oriental Distribuidora de Alimentos Ltda.', document: '23456789000195',
      categories: ['MERCEARIA', 'EMBALAGENS'], contactName: 'Akemi', whatsapp: '+5562982345678', email: 'pedidos@atacadooriental.com.br',
      street: 'Rua 44', number: '320', district: 'Setor Norte Ferroviário', city: 'Goiânia',
      deliveryDays: [1, 4], minOrderCents: 30000, paymentTerms: '28 dias', rating: 4,
      notes: 'Arroz, nori, shoyu, gergelim e hashi.',
    },
    {
      ...base, tenantId, name: 'Embalagens Cerrado', document: '34567890000130', categories: ['EMBALAGENS', 'LIMPEZA'],
      contactName: 'Rafaela', whatsapp: '+5562983456789', phone: '+556232420002', city: 'Aparecida de Goiânia',
      deliveryDays: [3], minOrderCents: 20000, paymentTerms: 'à vista', rating: 4, paymentMethods: ['PIX'],
      notes: 'Tubos Push Pop, tampas e sacolas. Prazo de produção de 10 dias para tubos personalizados.',
    },
    {
      ...base, tenantId, name: 'Gráfica Rápida', document: '45678901000175', categories: ['GRAFICA'], contactName: 'Diego',
      whatsapp: '+5562984567890', email: 'orcamento@graficarapida.com.br', city: 'Goiânia', paymentTerms: '50% no pedido', rating: 3,
      paymentMethods: ['PIX', 'CARTAO'], notes: 'Panfletos, adesivos de lacre e cardápios.',
    },
    {
      ...base, tenantId, name: 'Hortifruti Central', categories: ['HORTIFRUTI'], contactName: 'Seu Zé', whatsapp: '+5562985678901',
      city: 'Goiânia', district: 'Ceasa', deliveryDays: [1, 3, 5], paymentTerms: 'à vista', paymentMethods: ['PIX', 'DINHEIRO'], rating: 5,
      notes: 'Manga, cebolinha e pepino japonês.',
    },
  ];
  await tx.insert(suppliers).values(demo);
  return demo.length;
}
