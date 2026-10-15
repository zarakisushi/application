import { addDays, addMonths, monthRange, type DreGroup, type DreRow, type FinanceDirection } from '@zaraki/core';
import { sql } from 'drizzle-orm';
import type { Tx } from '../client';
import { query } from '../reports/types';
import { listUnpaidDeliveredOrders } from './orders';
import { statementSummary } from './statements';

// Consultas do painel financeiro. Todas filtram a unidade explicitamente (além do RLS) e ignoram
// lançamentos excluídos. Transferências entre contas nunca contam como entrada/saída.

/** "AAAA-MM" de uma data "AAAA-MM-DD". */
const ym = (date: string) => date.slice(0, 7);

/** Os `count` meses ("AAAA-MM") que terminam no mês de `date`. */
export function monthsEnding(date: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => ym(addMonths(`${ym(date)}-01`, i - count + 1)));
}

/** Saldo somado das contas (ativas ou não, desde que não excluídas) ao fim do dia `date` (ou hoje, sem data). */
export async function totalBalance(tx: Tx, tenantId: string, date?: string) {
  const [row] = await query<{ cents: number }>(
    tx,
    sql`select (
          coalesce((select sum(opening_balance_cents) from finance_accounts
                     where tenant_id = ${tenantId} and status ${date ? sql`and opening_date <= ${date}::date` : sql``}), 0)
        + coalesce((select sum(case when e.direction = 'ENTRADA' then e.amount_cents else -e.amount_cents end)
                      from finance_entries e join finance_accounts a on a.id = e.account_id and a.status
                     where e.tenant_id = ${tenantId} and e.status and e.paid_on is not null
                       ${date ? sql`and e.paid_on <= ${date}::date` : sql``}), 0)
        )::float8 as cents`,
  );
  return Math.round(row?.cents ?? 0);
}

export type CashMonth = {
  month: string;
  openingCents: number;
  incomeCents: number;
  expenseCents: number;
  /** Em aberto com vencimento no mês (os vencidos entram no mês atual). */
  plannedIncomeCents: number;
  plannedExpenseCents: number;
  closingCents: number;
};

/**
 * Fluxo de caixa mês a mês: realizado (pagamentos) e previsto (contas em aberto pelo vencimento).
 * O saldo de cada mês parte do fechamento do anterior.
 */
export async function cashFlowByMonth(tx: Tx, tenantId: string, months: string[], today: string): Promise<CashMonth[]> {
  if (!months.length) return [];
  const from = `${months[0]}-01`;
  const to = monthRange(`${months.at(-1)}-01`).to;
  const currentMonth = ym(today);

  const realized = await query<{ month: string; direction: FinanceDirection; cents: number }>(
    tx,
    sql`select to_char(paid_on, 'YYYY-MM') as month, direction, sum(amount_cents)::float8 as cents
          from finance_entries
         where tenant_id = ${tenantId} and status and origin <> 'TRANSFERENCIA'
           and paid_on between ${from}::date and ${to}::date
         group by 1, 2`,
  );
  const planned = await query<{ month: string; direction: FinanceDirection; cents: number }>(
    tx,
    sql`select to_char(greatest(due_date, ${today}::date), 'YYYY-MM') as month, direction, sum(amount_cents)::float8 as cents
          from finance_entries
         where tenant_id = ${tenantId} and status and origin <> 'TRANSFERENCIA' and paid_on is null
           and due_date <= ${to}::date
         group by 1, 2`,
  );
  const pick = (rows: typeof realized, month: string, direction: FinanceDirection) =>
    Math.round(rows.find((r) => r.month === month && r.direction === direction)?.cents ?? 0);

  let balance = await totalBalance(tx, tenantId, addDays(from, -1));
  return months.map((month) => {
    const incomeCents = pick(realized, month, 'ENTRADA');
    const expenseCents = pick(realized, month, 'SAIDA');
    // Previsto só vale do mês atual em diante (o que venceu antes aparece como previsto no mês atual).
    const future = month >= currentMonth;
    const plannedIncomeCents = future ? pick(planned, month, 'ENTRADA') : 0;
    const plannedExpenseCents = future ? pick(planned, month, 'SAIDA') : 0;
    const openingCents = balance;
    balance = openingCents + incomeCents - expenseCents + plannedIncomeCents - plannedExpenseCents;
    return { month, openingCents, incomeCents, expenseCents, plannedIncomeCents, plannedExpenseCents, closingCents: balance };
  });
}

/** Lançamentos por competência agrupados para a DRE (pagos e em aberto). */
export async function dreRows(tx: Tx, tenantId: string, from: string, to: string): Promise<DreRow[]> {
  const rows = await query<{ month: string; dre_group: DreGroup; direction: FinanceDirection; cents: number }>(
    tx,
    sql`select to_char(e.competence_date, 'YYYY-MM') as month, c.dre_group, e.direction, sum(e.amount_cents)::float8 as cents
          from finance_entries e join finance_categories c on c.id = e.category_id
         where e.tenant_id = ${tenantId} and e.status and e.competence_date between ${from}::date and ${to}::date
         group by 1, 2, 3`,
  );
  return rows.map((r) => ({ month: r.month, dreGroup: r.dre_group, direction: r.direction, cents: Math.round(r.cents) }));
}

/** Saídas por categoria (competência) no período, da maior para a menor. */
export async function expensesByCategory(tx: Tx, tenantId: string, from: string, to: string) {
  const rows = await query<{ name: string; dre_group: DreGroup; cents: number }>(
    tx,
    sql`select c.name, c.dre_group, sum(e.amount_cents)::float8 as cents
          from finance_entries e join finance_categories c on c.id = e.category_id
         where e.tenant_id = ${tenantId} and e.status and e.direction = 'SAIDA'
           and e.competence_date between ${from}::date and ${to}::date
         group by c.id order by cents desc`,
  );
  return rows.map((r) => ({ name: r.name, dreGroup: r.dre_group, cents: Math.round(r.cents) }));
}

/** Venda média por dia (vendas de pedidos recebidas) nos `days` dias antes de hoje. */
export async function averageDailySales(tx: Tx, tenantId: string, today: string, days = 28) {
  const [row] = await query<{ cents: number }>(
    tx,
    sql`select coalesce(sum(e.amount_cents), 0)::float8 as cents
          from finance_entries e join finance_categories c on c.id = e.category_id and c.system_key = 'VENDAS'
         where e.tenant_id = ${tenantId} and e.status and e.direction = 'ENTRADA' and e.paid_on is not null
           and e.paid_on between ${addDays(today, -days)}::date and ${addDays(today, -1)}::date`,
  );
  return Math.round((row?.cents ?? 0) / days);
}

/**
 * Saldo previsto dia a dia (hoje até `days` dias): o saldo de hoje mais as contas em aberto pelo
 * vencimento (o que já venceu entra hoje). `withSalesCents` soma ainda as vendas estimadas a partir de
 * amanhã (média diária dos últimos 28 dias): é a linha usada no alerta, porque o restaurante continua vendendo.
 */
export async function projectedBalance(tx: Tx, tenantId: string, today: string, days = 90) {
  const until = addDays(today, days);
  const open = await query<{ day: string; cents: number }>(
    tx,
    sql`select to_char(greatest(due_date, ${today}::date), 'YYYY-MM-DD') as day,
               sum(case when direction = 'ENTRADA' then amount_cents else -amount_cents end)::float8 as cents
          from finance_entries
         where tenant_id = ${tenantId} and status and paid_on is null and origin <> 'TRANSFERENCIA' and due_date <= ${until}::date
         group by 1`,
  );
  const byDay = new Map(open.map((r) => [r.day, Math.round(r.cents)]));
  const dailySalesCents = await averageDailySales(tx, tenantId, today);
  let balance = await totalBalance(tx, tenantId);
  const series: { date: string; cents: number; withSalesCents: number }[] = [];
  let min = { date: today, cents: Number.POSITIVE_INFINITY };
  for (let i = 0; i <= days; i++) {
    const date = addDays(today, i);
    balance += byDay.get(date) ?? 0;
    const withSalesCents = balance + dailySalesCents * i;
    series.push({ date, cents: balance, withSalesCents });
    if (withSalesCents < min.cents) min = { date, cents: withSalesCents };
  }
  return { series, min, dailySalesCents };
}

/** Contas em aberto: vencidas, vencendo em 7 e em 30 dias, por tipo. */
export async function openSummary(tx: Tx, tenantId: string, today: string) {
  const rows = await query<{ direction: FinanceDirection; bucket: string; n: number; cents: number }>(
    tx,
    sql`select direction,
               case when due_date < ${today}::date then 'vencidas'
                    when due_date <= ${addDays(today, 7)}::date then 'semana'
                    else 'mes' end as bucket,
               count(*)::int as n, sum(amount_cents)::float8 as cents
          from finance_entries
         where tenant_id = ${tenantId} and status and paid_on is null and origin <> 'TRANSFERENCIA'
           and due_date <= ${addDays(today, 30)}::date
         group by 1, 2`,
  );
  const get = (direction: FinanceDirection, bucket: string) => {
    const r = rows.find((x) => x.direction === direction && x.bucket === bucket);
    return { count: r?.n ?? 0, cents: Math.round(r?.cents ?? 0) };
  };
  const unpaid = await listUnpaidDeliveredOrders(tx, tenantId, 1000);
  return {
    payables: { overdue: get('SAIDA', 'vencidas'), week: get('SAIDA', 'semana'), month: get('SAIDA', 'mes') },
    receivables: { overdue: get('ENTRADA', 'vencidas'), week: get('ENTRADA', 'semana'), month: get('ENTRADA', 'mes') },
    unpaidOrders: { count: unpaid.length, cents: unpaid.reduce((s, o) => s + o.totalCents, 0) },
  };
}

/** Compras de mercadoria (categorias CMV) por competência no período. */
export async function cmvPurchases(tx: Tx, tenantId: string, from: string, to: string) {
  const [row] = await query<{ cents: number }>(
    tx,
    sql`select coalesce(sum(case when e.direction = 'SAIDA' then e.amount_cents else -e.amount_cents end), 0)::float8 as cents
          from finance_entries e join finance_categories c on c.id = e.category_id and c.cmv
         where e.tenant_id = ${tenantId} and e.status and e.competence_date between ${from}::date and ${to}::date`,
  );
  return Math.round(row?.cents ?? 0);
}

/** CMV pelas fichas do cardápio: custo dos itens e valor dos produtos dos pedidos entregues no período. */
export async function theoreticalCmv(tx: Tx, tenantId: string, from: string, to: string) {
  const [row] = await query<{ cost: number; sales: number }>(
    tx,
    sql`select coalesce(sum(i.unit_cost_cents * i.qty), 0)::float8 as cost, coalesce(sum(i.line_total_cents), 0)::float8 as sales
          from orders o
          join tenants t on t.id = o.tenant_id
          join order_items i on i.order_id = o.id and i.status
         where o.tenant_id = ${tenantId} and o.status and o.stage = 'ENTREGUE'
           and (coalesce(o.scheduled_at, o.created_at) at time zone t.timezone)::date between ${from}::date and ${to}::date`,
  );
  return { costCents: Math.round(row?.cost ?? 0), salesCents: Math.round(row?.sales ?? 0) };
}

/** Média mensal das saídas pagas nos `months` meses completos antes de `before` ("AAAA-MM-DD"). */
export async function averageMonthlyOutflow(tx: Tx, tenantId: string, before: string, months = 3) {
  const end = addDays(`${ym(before)}-01`, -1);
  const start = addMonths(`${ym(before)}-01`, -months);
  const [row] = await query<{ cents: number; first: string | null }>(
    tx,
    sql`select coalesce(sum(amount_cents), 0)::float8 as cents,
               (select to_char(min(paid_on), 'YYYY-MM-DD') from finance_entries where tenant_id = ${tenantId} and status and paid_on is not null) as first
          from finance_entries
         where tenant_id = ${tenantId} and status and direction = 'SAIDA' and origin <> 'TRANSFERENCIA'
           and paid_on between ${start}::date and ${end}::date`,
  );
  if (!row?.first) return 0;
  // Unidade nova: divide só pelos meses em que já havia movimento.
  const span = Math.min(months, Math.max(1, monthsBetween(row.first, end)));
  return Math.round(row.cents / span);
}

function monthsBetween(from: string, to: string) {
  const [fy, fm] = from.split('-').map(Number) as [number, number];
  const [ty, tm] = to.split('-').map(Number) as [number, number];
  return (ty - fy) * 12 + (tm - fm) + 1;
}

/**
 * Tudo o que a Visão geral do financeiro precisa para o mês escolhido ("AAAA-MM").
 * Margem, CMV e ponto de equilíbrio usam um mês fechado: no mês corrente, o anterior (no meio do mês as
 * despesas fixas já venceram e as vendas ainda não entraram, o que distorceria os indicadores).
 */
export async function financeOverview(tx: Tx, tenantId: string, month: string, today: string) {
  const { from, to } = monthRange(`${month}-01`);
  const healthMonth = month === ym(today) ? ym(addMonths(`${month}-01`, -1)) : month;
  const health = monthRange(`${healthMonth}-01`);
  const months = monthsEnding(`${month}-01`, 12);
  // Em sequência: a transação usa uma única conexão, que executa uma consulta por vez.
  const balanceCents = await totalBalance(tx, tenantId);
  const flow = await cashFlowByMonth(tx, tenantId, months, today);
  const rows = await dreRows(tx, tenantId, from, to);
  const healthRows = await dreRows(tx, tenantId, health.from, health.to);
  const open = await openSummary(tx, tenantId, today);
  const projection = await projectedBalance(tx, tenantId, today, 90);
  const cmvCents = await cmvPurchases(tx, tenantId, health.from, health.to);
  const theoretical = await theoreticalCmv(tx, tenantId, health.from, health.to);
  const avgMonthlyOutCents = await averageMonthlyOutflow(tx, tenantId, today);
  const expenses = await expensesByCategory(tx, tenantId, from, to);
  const bankStatements = (await statementSummary(tx, tenantId)).filter((a) => a.kind === 'BANCO');
  return {
    from,
    to,
    balanceCents,
    flow,
    current: flow.at(-1)!,
    dreRows: rows,
    health: { month: healthMonth, dreRows: healthRows, cmvCents, theoretical },
    open,
    projection,
    avgMonthlyOutCents,
    expenses,
    bankStatements,
  };
}
