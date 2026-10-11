import { formatReportValue } from '@zaraki/core';
import { CalendarDays, ClipboardList, Hourglass } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarSyncBadge, TypeBadge } from '@/components/admin/list';
import { ALL_NAV_ITEMS } from '@/components/admin/nav';
import { ReportChart } from '@/components/admin/reports/ReportChart';
import { SummaryTiles } from '@/components/admin/reports/ReportView';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCents, formatDateTime } from '@/lib/format';
import { orderHref } from '@/lib/orders';
import { requireAdmin } from '@/server/admin';
import { loadDashboard } from '@/server/dashboard';

export const metadata: Metadata = { title: 'Início' };

function greeting(timezone: string) {
  const hour = Number(new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  return hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const ctx = await requireAdmin();
  const sp = await searchParams;
  const timezone = ctx.tenant.timezone;
  const firstName = ctx.user.name.split(' ')[0];
  const fullDate = new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, dateStyle: 'full' }).format(new Date());
  const today = fullDate.charAt(0).toUpperCase() + fullDate.slice(1); // "Domingo, 11 de outubro de 2026"
  const { operational, sales } = await loadDashboard(ctx, typeof sp.unidade === 'string' ? sp.unidade : undefined);

  const stats = operational && [
    { label: 'Pedidos hoje', value: operational.snapshot.ordersToday, icon: ClipboardList, href: '/admin/pedidos' },
    { label: 'Aguardando confirmação', value: operational.snapshot.awaitingConfirmation, icon: Hourglass, href: '/admin/pedidos?etapa=NOVO' },
    { label: 'Encomendas e festas (7 dias)', value: operational.snapshot.upcomingScheduled, icon: CalendarDays, href: '/admin/encomendas' },
  ];
  const shortcuts = ALL_NAV_ITEMS.filter((i) => i.href !== '/admin' && (!i.permission || ctx.can(i.permission)));

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-xl bg-brand-ink px-6 py-8 text-[#f4efe6] md:px-10">
        <p className="text-sm text-brand-gold-light">{today}</p>
        <h1 className="mt-2 font-display text-3xl font-bold md:text-4xl">
          {greeting(timezone)}, {firstName}!
        </h1>
        <p className="mt-2 text-[#cfc5b4]">
          Bem-vindo ao painel da <strong className="text-[#f4efe6]">{ctx.tenant.name}</strong>.
        </p>
      </section>

      {stats && (
        <section className="grid gap-4 sm:grid-cols-3" aria-label="Resumo da operação">
          {stats.map((s) => (
            <Link key={s.label} href={s.href} className="group">
              <Card className="transition-colors group-hover:border-brand-gold">
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <CardDescription>{s.label}</CardDescription>
                  <s.icon className="size-5 text-brand-gold" />
                </CardHeader>
                <CardContent>
                  <div className="font-display text-4xl font-bold">{s.value}</div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </section>
      )}

      {sales && (
        <section className="grid gap-4" aria-labelledby="indicadores">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="indicadores" className="font-display text-lg font-bold">
                Indicadores do mês
              </h2>
              <p className="text-sm text-muted-foreground">
                {sales.scopeLabel} · mês até hoje, comparado ao mesmo período do mês passado · faturamento = pedidos entregues
              </p>
            </div>
            {ctx.platformAdmin && (
              <Button variant="outline" size="sm" asChild>
                <Link href={sales.unit === 'todas' ? '/admin' : '/admin?unidade=todas'}>
                  {sales.unit === 'todas' ? `Ver só ${ctx.tenant.name}` : 'Ver toda a rede'}
                </Link>
              </Button>
            )}
          </div>
          <SummaryTiles
            timezone={timezone}
            items={[
              { label: 'Faturamento', value: sales.month.now.faturamento, previous: sales.month.before.faturamento, format: 'money' },
              { label: 'Pedidos entregues', value: sales.month.now.pedidos, previous: sales.month.before.pedidos, format: 'int' },
              {
                label: 'Ticket médio',
                value: sales.month.now.pedidos ? sales.month.now.faturamento / sales.month.now.pedidos : null,
                previous: sales.month.before.pedidos ? sales.month.before.faturamento / sales.month.before.pedidos : null,
                format: 'money',
              },
              { label: 'Clientes novos', value: sales.month.newCustomers, format: 'int', hint: 'primeira compra neste mês' },
            ]}
          />
          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="min-w-0 xl:col-span-2">
              <CardHeader>
                <CardTitle>Faturamento dos últimos 30 dias</CardTitle>
              </CardHeader>
              <CardContent>
                <ReportChart spec={sales.revenue.chart!} rows={sales.revenue.rows} />
              </CardContent>
            </Card>
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Vendas por tipo (30 dias)</CardTitle>
              </CardHeader>
              <CardContent>
                <ReportChart spec={sales.byType.chart!} rows={sales.byType.rows} />
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Sabores mais vendidos (30 dias)</CardTitle>
              <Link href="/admin/relatorios/ranking-sabores" className="text-sm underline">
                Ver ranking completo
              </Link>
            </CardHeader>
            <CardContent>
              <ReportChart spec={sales.flavors.chart!} rows={sales.flavors.rows.slice(0, 5)} />
            </CardContent>
          </Card>
        </section>
      )}

      {operational && (
        <section className="grid gap-4 xl:grid-cols-2">
          <Card className="py-0">
            <CardHeader className="flex flex-row items-center justify-between pt-6">
              <CardTitle>Próximas encomendas e festas</CardTitle>
              <Link href="/admin/encomendas" className="text-sm underline">
                Ver todas
              </Link>
            </CardHeader>
            <CardContent className="grid gap-0 px-0 pb-2">
              {operational.upcoming.map((o) => (
                <Link key={o.id} href={`/admin/encomendas/${o.id}`} className="flex items-center justify-between gap-3 border-t px-6 py-3 text-sm hover:bg-muted/50">
                  <span>
                    <span className="font-medium">{formatDateTime(o.scheduledAt, timezone)}</span> · {o.customerName}
                    {o.guests ? ` · ${o.guests} convidados` : ''}
                  </span>
                  <span className="flex items-center gap-2">
                    <TypeBadge type={o.type} />
                    <CalendarSyncBadge state={o.calendarSyncState} />
                  </span>
                </Link>
              ))}
              {!operational.upcoming.length && <p className="border-t px-6 py-6 text-sm text-muted-foreground">Nenhuma encomenda agendada.</p>}
            </CardContent>
          </Card>
          <Card className="py-0">
            <CardHeader className="flex flex-row items-center justify-between pt-6">
              <CardTitle>Na fila de confirmação</CardTitle>
              <span className="flex gap-3 text-sm">
                <Link href="/admin/pedidos?etapa=NOVO" className="underline">
                  Pedidos
                </Link>
                <Link href="/admin/encomendas?etapa=NOVO&periodo=todas" className="underline">
                  Encomendas
                </Link>
              </span>
            </CardHeader>
            <CardContent className="grid gap-0 px-0 pb-2">
              {operational.awaiting.map((o) => (
                <Link key={o.id} href={orderHref(o)} className="flex items-center justify-between gap-3 border-t px-6 py-3 text-sm hover:bg-muted/50">
                  <span>
                    <span className="font-medium">{o.code}</span> · {o.customerName} · {formatReportValue(o.createdAt, 'datetime', timezone)}
                  </span>
                  <span className="flex items-center gap-2">
                    <TypeBadge type={o.type} />
                    <span className="whitespace-nowrap tabular-nums">{formatCents(o.totalCents)}</span>
                  </span>
                </Link>
              ))}
              {!operational.awaiting.length && <p className="border-t px-6 py-6 text-sm text-muted-foreground">Nenhum pedido aguardando.</p>}
            </CardContent>
          </Card>
        </section>
      )}

      <section aria-labelledby="atalhos">
        <h2 id="atalhos" className="mb-3 font-display text-lg font-bold">
          Acesso rápido
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {shortcuts.map((item) => (
            <Link key={item.href} href={item.href} className="group">
              <Card className="h-full transition-colors group-hover:border-brand-gold">
                <CardHeader className="flex flex-row items-center gap-3">
                  <item.icon className="size-5 text-brand-gold" />
                  <CardTitle className="text-base">{item.label}</CardTitle>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
