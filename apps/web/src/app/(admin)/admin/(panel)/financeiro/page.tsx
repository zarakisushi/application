import { addMonths, computeDre, formatCents, healthIndicators, todayInZone } from '@zaraki/core';
import { financeOverview, withContext } from '@zaraki/db';
import { ChevronLeft, ChevronRight, FileSpreadsheet } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { HealthPanel } from '@/components/admin/finance/HealthPanel';
import { Money } from '@/components/admin/finance/ui';
import { param } from '@/components/admin/list';
import { PageHeader } from '@/components/admin/PageHeader';
import { ReportChart } from '@/components/admin/reports/ReportChart';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireAdmin } from '@/server/admin';

export const metadata: Metadata = { title: 'Visão geral do financeiro' };

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} de ${ym.slice(0, 4)}`;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default async function FinanceOverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const ctx = await requireAdmin('finance:read');
  const today = todayInZone(ctx.tenant.timezone);
  const requested = param((await searchParams).mes);
  const month = requested && /^\d{4}-\d{2}$/.test(requested) && requested <= today.slice(0, 7) ? requested : today.slice(0, 7);
  const isCurrent = month === today.slice(0, 7);
  const data = await withContext(ctx.db, (tx) => financeOverview(tx, ctx.tenant.id, month, today));

  const dre = computeDre(data.dreRows);
  const indicators = healthIndicators({
    balanceCents: data.balanceCents,
    avgMonthlyOutCents: data.avgMonthlyOutCents,
    dre: computeDre(data.health.dreRows),
    cmvCents: data.health.cmvCents,
    theoreticalCmv: data.health.theoretical,
    overduePayables: data.open.payables.overdue,
    overdueReceivables: data.open.receivables.overdue,
    projectedMin: data.projection.min,
    estimatedDailySalesCents: data.projection.dailySalesCents,
    periodLabel: data.health.month !== month ? MONTHS[Number(data.health.month.slice(5, 7)) - 1] : undefined,
    bankStatements: data.bankStatements,
    today,
  });
  const cur = data.current;
  const prevMonth = addMonths(`${month}-01`, -1).slice(0, 7);
  const nextMonth = addMonths(`${month}-01`, 1).slice(0, 7);
  const receivable7 = data.open.receivables.week.cents + data.open.receivables.overdue.cents + data.open.unpaidOrders.cents;
  const payable7 = data.open.payables.week.cents + data.open.payables.overdue.cents;

  const tiles = [
    { label: 'Saldo em caixa hoje', value: <Money cents={data.balanceCents} />, hint: 'Soma de todas as contas.', href: '/admin/financeiro/contas' },
    { label: `Entradas em ${MONTHS[Number(month.slice(5)) - 1]}`, value: <Money cents={cur.incomeCents} direction="ENTRADA" />, hint: 'Recebido no mês.', href: `/admin/financeiro/lancamentos?tipo=ENTRADA&situacao=pagos&periodo=${isCurrent ? 'mes' : 'tudo'}` },
    { label: `Saídas em ${MONTHS[Number(month.slice(5)) - 1]}`, value: <Money cents={cur.expenseCents} direction="SAIDA" />, hint: 'Pago no mês.', href: `/admin/financeiro/lancamentos?tipo=SAIDA&situacao=pagos&periodo=${isCurrent ? 'mes' : 'tudo'}` },
    { label: 'Resultado de caixa do mês', value: <Money cents={cur.incomeCents - cur.expenseCents} />, hint: 'Entradas − saídas pagas.' },
    {
      label: 'A pagar (vencidas + 7 dias)',
      value: <Money cents={payable7} />,
      hint: data.open.payables.overdue.count ? `${data.open.payables.overdue.count} vencida(s): ${formatCents(data.open.payables.overdue.cents)}` : 'Nenhuma vencida.',
      href: '/admin/financeiro/agenda',
      alert: data.open.payables.overdue.count > 0,
    },
    {
      label: 'A receber (vencidas + 7 dias)',
      value: <Money cents={receivable7} />,
      hint: data.open.unpaidOrders.count ? `Inclui ${data.open.unpaidOrders.count} pedido(s) entregue(s) sem pagamento.` : 'Contas a receber em aberto.',
      href: '/admin/financeiro/agenda',
    },
  ];

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Visão geral"
        description={`Saúde financeira da ${ctx.tenant.name}.`}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin/financeiro?mes=${prevMonth}`} aria-label="Mês anterior">
                <ChevronLeft />
              </Link>
            </Button>
            <span className="min-w-40 text-center font-medium" data-testid="overview-month">
              {capitalize(monthName(month))}
            </span>
            <Button asChild variant="outline" size="sm" className={isCurrent ? 'pointer-events-none opacity-40' : ''}>
              <Link href={`/admin/financeiro?mes=${nextMonth}`} aria-label="Próximo mês" aria-disabled={isCurrent}>
                <ChevronRight />
              </Link>
            </Button>
          </div>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Números do mês">
        {tiles.map((t) => {
          const card = (
            <Card className={`h-full gap-2 transition-colors ${t.href ? 'hover:border-brand-gold' : ''} ${t.alert ? 'border-brand-red/40' : ''}`}>
              <CardHeader>
                <CardDescription>{t.label}</CardDescription>
                <CardTitle className="font-display text-2xl">{t.value}</CardTitle>
              </CardHeader>
              <CardContent className={`text-xs ${t.alert ? 'text-brand-red' : 'text-muted-foreground'}`}>{t.hint}</CardContent>
            </Card>
          );
          return t.href ? (
            <Link key={t.label} href={t.href}>
              {card}
            </Link>
          ) : (
            <div key={t.label}>{card}</div>
          );
        })}
      </section>

      <HealthPanel indicators={indicators} />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Entradas × saídas (12 meses)</CardTitle>
            <CardDescription>Dinheiro que entrou e saiu das contas em cada mês.</CardDescription>
          </CardHeader>
          <CardContent>
            <ReportChart
              spec={{
                type: 'bar',
                x: 'mes',
                xFormat: 'month',
                format: 'money',
                series: [
                  { key: 'entradas', label: 'Entradas' },
                  { key: 'saidas', label: 'Saídas' },
                ],
              }}
              rows={data.flow.map((m) => ({ mes: `${m.month}-01`, entradas: m.incomeCents, saidas: m.expenseCents }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Saldo previsto (90 dias)</CardTitle>
            <CardDescription>
              Saldo de hoje mais as contas a pagar e a receber, pelo vencimento.
              {data.projection.dailySalesCents > 0 &&
                ` A outra linha soma as vendas estimadas (${formatCents(data.projection.dailySalesCents)} por dia, média dos últimos 28 dias).`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ReportChart
              spec={{
                type: 'line',
                x: 'dia',
                xFormat: 'date',
                format: 'money',
                series:
                  data.projection.dailySalesCents > 0
                    ? [
                        { key: 'vendas', label: 'Com vendas estimadas' },
                        { key: 'saldo', label: 'Só contas em aberto' },
                      ]
                    : [{ key: 'saldo', label: 'Saldo previsto' }],
              }}
              rows={data.projection.series.map((d) => ({ dia: d.date, saldo: d.cents, vendas: d.withSalesCents }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Para onde foi o dinheiro</CardTitle>
            <CardDescription>Saídas do mês por categoria (competência).</CardDescription>
          </CardHeader>
          <CardContent>
            <ReportChart
              spec={{ type: 'bar', x: 'categoria', format: 'money', horizontal: true, series: [{ key: 'valor', label: 'Saídas' }] }}
              rows={data.expenses.slice(0, 8).map((e) => ({ categoria: e.name, valor: e.cents }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div className="grid gap-1.5">
              <CardTitle>Resultado do mês (DRE)</CardTitle>
              <CardDescription>
                Por competência: cada conta no mês a que se refere.{isCurrent && ' Mês em andamento: as vendas ainda estão entrando.'}
              </CardDescription>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin/financeiro/fluxo?ano=${month.slice(0, 4)}&aba=dre`}>
                <FileSpreadsheet /> DRE completa
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-2 text-sm">
              {(
                [
                  ['Receita', dre.receita, false],
                  ['(−) Custos variáveis', -dre.custosVariaveis, false],
                  ['= Margem de contribuição', dre.margemContribuicao, true],
                  ['(−) Despesas fixas', -dre.despesasFixas, false],
                  ['(−) Impostos', -dre.impostos, false],
                  ['(±) Royalties', dre.royalties, false],
                  ['= Resultado operacional', dre.resultadoOperacional, true],
                ] as const
              ).map(([label, cents, total]) => (
                <div key={label} className={`flex justify-between gap-4 ${total ? 'border-t pt-2 font-semibold' : ''}`}>
                  <dt>{label}</dt>
                  <dd>
                    <Money cents={cents} />
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
