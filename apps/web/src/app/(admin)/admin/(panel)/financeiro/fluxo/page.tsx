import { buildDre, DRE_LINES, todayInZone } from '@zaraki/core';
import { cashFlowByMonth, dreRows, withContext } from '@zaraki/db';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Money } from '@/components/admin/finance/ui';
import { param } from '@/components/admin/list';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { requireAdmin } from '@/server/admin';

export const metadata: Metadata = { title: 'Fluxo de caixa e DRE' };

const MONTH_LABEL = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export default async function CashFlowPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const ctx = await requireAdmin('finance:read');
  const sp = await searchParams;
  const today = todayInZone(ctx.tenant.timezone);
  const thisYear = Number(today.slice(0, 4));
  const asked = Number(param(sp.ano));
  const year = asked >= 2000 && asked <= thisYear + 1 ? asked : thisYear;
  const tab = param(sp.aba) === 'dre' ? 'dre' : 'fluxo';
  const months = MONTH_LABEL.map((_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);

  const { flow, dre } = await withContext(ctx.db, async (tx) => ({
    flow: await cashFlowByMonth(tx, ctx.tenant.id, months, today),
    dre: buildDre(await dreRows(tx, ctx.tenant.id, `${year}-01-01`, `${year}-12-31`), months),
  }));
  const total = Object.fromEntries(DRE_LINES.map((l) => [l.key, dre.reduce((s, m) => s + m.values[l.key], 0)]));
  const currentMonth = today.slice(0, 7);
  const exportHref = (slug: string) => `/admin/relatorios/${slug}?periodo=personalizado&de=${year}-01-01&ate=${year}-12-31`;

  const flowLines: { key: keyof (typeof flow)[number]; label: string; strong?: boolean }[] = [
    { key: 'openingCents', label: 'Saldo inicial' },
    { key: 'incomeCents', label: '(+) Entradas recebidas' },
    { key: 'plannedIncomeCents', label: '(+) A receber (previsto)' },
    { key: 'expenseCents', label: '(−) Saídas pagas' },
    { key: 'plannedExpenseCents', label: '(−) A pagar (previsto)' },
    { key: 'closingCents', label: 'Saldo final', strong: true },
  ];

  return (
    <>
      <PageHeader
        title="Fluxo de caixa e DRE"
        description="O ano mês a mês: quanto entrou e saiu das contas (caixa) e quanto a operação lucrou (DRE)."
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`?ano=${year - 1}&aba=${tab}`} aria-label="Ano anterior">
                <ChevronLeft />
              </Link>
            </Button>
            <span className="w-14 text-center font-medium">{year}</span>
            <Button asChild variant="outline" size="sm" className={year >= thisYear + 1 ? 'pointer-events-none opacity-40' : ''}>
              <Link href={`?ano=${year + 1}&aba=${tab}`} aria-label="Próximo ano">
                <ChevronRight />
              </Link>
            </Button>
          </div>
        }
      />
      <Tabs defaultValue={tab} className="gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="fluxo">Fluxo de caixa</TabsTrigger>
            <TabsTrigger value="dre">DRE gerencial</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="fluxo" className="grid gap-3">
          <p className="text-sm text-muted-foreground">
            Regime de caixa: conta quando o dinheiro entra ou sai. Do mês atual em diante, soma também o que está a pagar e a receber (contas
            vencidas entram no mês atual).
          </p>
          <Card className="overflow-x-auto py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 bg-card">Mês</TableHead>
                  {months.map((m, i) => (
                    <TableHead key={m} className={cn('text-right', m === currentMonth && 'bg-accent')}>
                      {MONTH_LABEL[i]}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {flowLines.map((line) => (
                  <TableRow key={line.key} className={line.strong ? 'font-semibold' : ''}>
                    <TableCell className="sticky left-0 bg-card">{line.label}</TableCell>
                    {flow.map((m) => (
                      <TableCell key={m.month} className={cn('text-right text-sm', m.month === currentMonth && 'bg-accent/50')}>
                        <Money cents={Number(m[line.key])} zeroDash={!line.strong} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <div>
            <Button asChild variant="outline" size="sm">
              <Link href={exportHref('fluxo-caixa')}>
                <Download /> Abrir no relatório (CSV)
              </Link>
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="dre" className="grid gap-3">
          <p className="text-sm text-muted-foreground">
            Regime de competência: cada conta entra no mês a que se refere, paga ou não. É o lucro da operação, independente de quando o
            dinheiro mudou de conta.
          </p>
          <Card className="overflow-x-auto py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 bg-card">Linha</TableHead>
                  {months.map((m, i) => (
                    <TableHead key={m} className={cn('text-right', m === currentMonth && 'bg-accent')}>
                      {MONTH_LABEL[i]}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Ano</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {DRE_LINES.map((line) => (
                  <TableRow key={line.key} className={line.total ? 'bg-muted/40 font-semibold' : ''}>
                    <TableCell className="sticky left-0 bg-card" title={line.hint}>
                      {line.label}
                    </TableCell>
                    {dre.map((m) => (
                      <TableCell key={m.month} className={cn('text-right text-sm', m.month === currentMonth && 'bg-accent/50')}>
                        <Money cents={m.values[line.key]} zeroDash />
                      </TableCell>
                    ))}
                    <TableCell className="text-right text-sm">
                      <Money cents={total[line.key]!} zeroDash />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <div>
            <Button asChild variant="outline" size="sm">
              <Link href={exportHref('dre')}>
                <Download /> Abrir no relatório (CSV)
              </Link>
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}
