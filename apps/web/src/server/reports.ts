import 'server-only';
import { can, previousPeriod, resolvePeriod, todayInZone, type Period } from '@zaraki/core';
import { listActiveTenants, withContext, getDb, type DbContext, type ReportDefinition, type ReportParams } from '@zaraki/db';
import type { AdminContext } from './admin';

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export type ReportRequest = {
  params: ReportParams;
  period: Period;
  db: DbContext;
  /** "todas" = consolidado da rede (só a Matriz). */
  unit: 'ativa' | 'todas';
  scopeLabel: string;
  extra: Record<string, string>;
};

export const canSeeReport = (ctx: AdminContext, report: ReportDefinition) =>
  can({ role: ctx.tenant.role, platformAdmin: ctx.platformAdmin }, report.permission) && (!report.network || ctx.platformAdmin);

/**
 * Traduz os filtros da URL em parâmetros do relatório. Unidades:
 * - padrão: a unidade ativa, com o contexto dela (RLS);
 * - relatórios da rede, ou "Todas as unidades" escolhido pela Matriz: todas as unidades ativas,
 *   com contexto da Matriz.
 */
export async function resolveReportRequest(ctx: AdminContext, report: ReportDefinition, sp: SearchParams): Promise<ReportRequest> {
  const tz = ctx.tenant.timezone;
  const period = resolvePeriod({ preset: one(sp.periodo), from: one(sp.de), to: one(sp.ate) }, tz);
  const today = todayInZone(tz);
  const extra = Object.fromEntries(
    (report.extraParams ?? []).map((e) => {
      const value = one(sp[e.name]);
      return [e.name, value && e.options.some((o) => o.value === value) ? value : e.default(today)];
    }),
  );

  const network = report.network || (ctx.platformAdmin && one(sp.unidade) === 'todas');
  const tenantIds = network ? (await listActiveTenants(getDb())).map((t) => t.id) : [ctx.tenant.id];

  return {
    period,
    extra,
    unit: network ? 'todas' : 'ativa',
    scopeLabel: network ? 'Todas as unidades' : ctx.tenant.name,
    db: network ? { ...ctx.db, platformAdmin: true } : ctx.db,
    params: { tenantIds, timezone: tz, from: period.from, to: period.to, days: period.days, previous: previousPeriod(period), extra },
  };
}

export function runReport(report: ReportDefinition, req: ReportRequest) {
  return withContext(req.db, (tx) => report.run(tx, req.params));
}
