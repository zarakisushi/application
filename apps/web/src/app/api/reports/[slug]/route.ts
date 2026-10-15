import { toCsv } from '@zaraki/core';
import { findReport, logEvent } from '@zaraki/db';
import { getAdminContext } from '@/server/admin';
import { canSeeReport, resolveReportRequest, runReport } from '@/server/reports';

export const dynamic = 'force-dynamic';

/** Exporta o relatório em CSV (Excel em português). A exportação fica registrada na auditoria. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const report = findReport((await params).slug);
  if (!report) return new Response('Relatório não encontrado', { status: 404 });
  const ctx = await getAdminContext();
  if (!ctx || ctx.user.mustChangePassword) return new Response('Faça login para exportar', { status: 401 });
  if (!canSeeReport(ctx, report)) return new Response('Sem permissão', { status: 403 });

  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const req = await resolveReportRequest(ctx, report, sp);
  const result = await runReport(report, req);

  await logEvent(
    { ...ctx.db, platformAdmin: ctx.platformAdmin },
    {
      action: 'EXPORT',
      entity: 'report',
      entityId: report.slug,
      details: { report: report.title, from: req.params.from, to: req.params.to, scope: req.scopeLabel, rows: result.rows.length, ...req.extra },
    },
  );

  const name = report.usesPeriod === false ? report.slug : `${report.slug}_${req.params.from}_${req.params.to}`;
  return new Response(toCsv(result.columns, result.rows, ctx.tenant.timezone), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="zaraki_${name}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
