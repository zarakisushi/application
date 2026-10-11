import 'server-only';
import { previousPeriod, resolvePeriod, todayInZone } from '@zaraki/core';
import {
  findReport,
  getOperationalSnapshot,
  listOrders,
  salesTotals,
  withContext,
  type ReportParams,
} from '@zaraki/db';
import type { AdminContext } from './admin';
import { resolveReportRequest } from './reports';

/** Mesmo intervalo de dias do mês anterior (1º até o mesmo dia), para comparar o "mês até hoje". */
function sameDaysLastMonth(today: string) {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 2, 1));
  const last = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  const iso = (dt: Date) => dt.toISOString().slice(0, 10);
  return { from: iso(first), to: iso(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last)))) };
}

export async function loadDashboard(ctx: AdminContext, unitParam: string | undefined) {
  const tz = ctx.tenant.timezone;
  const operational = ctx.can('orders:read')
    ? await withContext(ctx.db, async (tx) => ({
        snapshot: await getOperationalSnapshot(tx, tz),
        upcoming: (await listOrders(tx, ctx.tenant.id, { kind: 'encomendas', period: 'proximas', timezone: tz, pageSize: 6 })).rows,
        // Mesma contagem do card "Aguardando confirmação": delivery, encomendas e festas.
        awaiting: (await listOrders(tx, ctx.tenant.id, { kind: 'todos', stage: 'NOVO', timezone: tz, pageSize: 6 })).rows,
      }))
    : null;

  if (!ctx.can('reports:read')) return { operational, sales: null };

  // Indicadores: mesma regra dos relatórios (faturamento = pedidos entregues).
  const base = await resolveReportRequest(ctx, findReport('faturamento')!, { periodo: '30d', unidade: unitParam });
  const today = todayInZone(tz);
  const month = resolvePeriod({ preset: 'mes' }, tz);
  const monthParams: ReportParams = { ...base.params, from: month.from, to: month.to, days: month.days, previous: sameDaysLastMonth(today) };

  const sales = await withContext(base.db, async (tx) => {
    const [now, before] = [await salesTotals(tx, monthParams), await salesTotals(tx, monthParams, monthParams.previous)];
    const newCustomers = await findReport('clientes-novos-recorrentes')!.run(tx, monthParams);
    const last30 = base.params;
    return {
      month: { now, before, newCustomers: Number(newCustomers.summary?.find((s) => s.label === 'Clientes novos')?.value ?? 0) },
      revenue: await findReport('faturamento')!.run(tx, last30),
      byType: await findReport('vendas-por-tipo')!.run(tx, last30),
      flavors: await findReport('ranking-sabores')!.run(tx, { ...last30, previous: previousPeriod(base.period) }),
    };
  });
  return { operational, sales: { ...sales, scopeLabel: base.scopeLabel, unit: base.unit } };
}
