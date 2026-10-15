import { findReport } from '@zaraki/db';
import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { ReportFilters } from '@/components/admin/reports/ReportFilters';
import { ReportView } from '@/components/admin/reports/ReportView';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/format';
import { requireAdmin } from '@/server/admin';
import { canSeeReport, resolveReportRequest, runReport } from '@/server/reports';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[]>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: findReport((await params).slug)?.title ?? 'Relatório' };
}

export default async function ReportPage({ params, searchParams }: Props) {
  const report = findReport((await params).slug);
  if (!report) notFound();
  const ctx = await requireAdmin(report.permission);
  if (!canSeeReport(ctx, report)) redirect('/admin/sem-permissao');

  const sp = await searchParams;
  const req = await resolveReportRequest(ctx, report, sp);
  const result = await runReport(report, req);
  const tz = ctx.tenant.timezone;
  const usesPeriod = report.usesPeriod !== false;

  const filters = (report.extraParams ?? []).map((e) => ({ name: e.name, label: e.label, value: req.extra[e.name]!, options: e.options }));
  if (ctx.platformAdmin && !report.network) {
    filters.unshift({
      name: 'unidade',
      label: 'Unidade',
      value: req.unit,
      options: [
        { value: 'ativa', label: ctx.tenant.name },
        { value: 'todas', label: 'Todas as unidades' },
      ],
    });
  }

  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === 'string') query.set(k, v);
  const period = usesPeriod ? `${formatDate(`${req.period.from}T12:00:00Z`, 'UTC')} a ${formatDate(`${req.period.to}T12:00:00Z`, 'UTC')}` : null;

  return (
    <>
      <PageHeader
        title={report.title}
        description={`${report.description}${period ? ` · ${period}` : ''} · ${req.scopeLabel}`}
        actions={
          <Button variant="outline" asChild>
            <Link href="/admin/relatorios">
              <ArrowLeft /> Relatórios
            </Link>
          </Button>
        }
      />
      <ReportFilters
        period={usesPeriod ? { preset: req.period.preset, from: req.period.from, to: req.period.to } : null}
        filters={filters}
        exportHref={`/api/reports/${report.slug}${query.size ? `?${query}` : ''}`}
      />
      <ReportView result={result} timezone={tz} />
    </>
  );
}
