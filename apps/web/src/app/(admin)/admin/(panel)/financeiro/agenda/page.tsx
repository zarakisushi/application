import { addDays, formatCents, todayInZone, type FinanceDirection } from '@zaraki/core';
import { listOpenEntries, listUnpaidDeliveredOrders, withContext } from '@zaraki/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { OrderPaymentButton } from '@/components/admin/finance/OrderPaymentButton';
import { PayEntryButton } from '@/components/admin/finance/PayEntryButton';
import { Money, formatDay } from '@/components/admin/finance/ui';
import { PageHeader } from '@/components/admin/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { orderHref } from '@/lib/orders';
import { requireAdmin } from '@/server/admin';
import { loadFinanceOptions } from '@/server/finance';

export const metadata: Metadata = { title: 'A pagar e receber' };

type Open = Awaited<ReturnType<typeof listOpenEntries>>[number];
type Unpaid = Awaited<ReturnType<typeof listUnpaidDeliveredOrders>>[number];

const BUCKETS = [
  { key: 'vencidos', label: 'Vencidos', cls: 'text-brand-red' },
  { key: 'hoje', label: 'Vencem hoje', cls: 'text-amber-700' },
  { key: 'semana', label: 'Próximos 7 dias', cls: '' },
  { key: 'mes', label: 'Até 30 dias', cls: '' },
] as const;
type Bucket = (typeof BUCKETS)[number]['key'];

function bucketOf(due: string, today: string): Bucket {
  if (due < today) return 'vencidos';
  if (due === today) return 'hoje';
  if (due <= addDays(today, 7)) return 'semana';
  return 'mes';
}

export default async function AgendaPage() {
  const ctx = await requireAdmin('finance:read');
  const today = todayInZone(ctx.tenant.timezone);
  const until = addDays(today, 30);
  const [{ open, unpaid }, { accounts }] = await Promise.all([
    withContext(ctx.db, async (tx) => ({
      open: await listOpenEntries(tx, ctx.tenant.id, until),
      unpaid: await listUnpaidDeliveredOrders(tx, ctx.tenant.id),
    })),
    loadFinanceOptions(ctx),
  ]);
  const activeAccounts = accounts.filter((a) => a.active).map((a) => ({ id: a.id, name: a.name }));
  const canPay = ctx.can('finance:write');
  const canPayOrders = ctx.can('orders:write');

  const side = (direction: FinanceDirection) => open.filter((e) => e.direction === direction && e.origin !== 'TRANSFERENCIA');
  const total = (rows: { amountCents?: number; totalCents?: number }[]) => rows.reduce((s, r) => s + (r.amountCents ?? r.totalCents ?? 0), 0);

  function Panel({ direction }: { direction: FinanceDirection }) {
    const rows = side(direction);
    const groups = BUCKETS.map((b) => ({ ...b, rows: rows.filter((r) => bucketOf(r.dueDate, today) === b.key) }));
    const income = direction === 'ENTRADA';
    return (
      <div className="grid gap-6">
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label={income ? 'Resumo a receber' : 'Resumo a pagar'}>
          {groups.map((g) => (
            <Card key={g.key} className="gap-2 py-4">
              <CardHeader className="px-4">
                <CardDescription>
                  {g.label} · {g.rows.length}
                </CardDescription>
                <CardTitle className={`font-display text-xl tabular-nums ${g.cls}`}>{formatCents(total(g.rows))}</CardTitle>
              </CardHeader>
            </Card>
          ))}
        </section>
        {groups
          .filter((g) => g.rows.length)
          .map((g) => (
            <Card key={g.key}>
              <CardHeader>
                <CardTitle className={g.cls}>{g.label}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-1">
                {g.rows.map((e: Open) => (
                  <div key={e.id} className="flex flex-wrap items-center gap-3 border-b py-2 last:border-0">
                    <span className="w-24 text-sm text-muted-foreground">{formatDay(e.dueDate)}</span>
                    <div className="min-w-48 flex-1">
                      <Link href={`/admin/financeiro/lancamentos/${e.id}`} className="font-medium hover:underline">
                        {e.description}
                      </Link>
                      <div className="text-xs text-muted-foreground">{[e.categoryName, e.counterparty].filter(Boolean).join(' · ')}</div>
                    </div>
                    <Money cents={e.amountCents} direction={e.direction} className="font-medium" />
                    {canPay && e.origin !== 'PEDIDO' && <PayEntryButton entry={e} accounts={activeAccounts} today={today} />}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        {income && unpaid.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Pedidos entregues sem pagamento registrado · {formatCents(total(unpaid))}</CardTitle>
              <CardDescription>Ao registrar o pagamento, a venda entra no caixa.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-1">
              {unpaid.map((o: Unpaid) => (
                <div key={o.id} className="flex flex-wrap items-center gap-3 border-b py-2 last:border-0">
                  <span className="w-24 text-sm text-muted-foreground">{formatDay(o.date)}</span>
                  <div className="min-w-48 flex-1">
                    <Link href={orderHref(o)} className="font-medium hover:underline">
                      Pedido {o.code}
                    </Link>
                    <div className="text-xs text-muted-foreground">{o.customerName}</div>
                  </div>
                  <Money cents={o.totalCents} direction="ENTRADA" className="font-medium" />
                  {canPayOrders && <OrderPaymentButton orderId={o.id} code={o.code} totalLabel={formatCents(o.totalCents)} method={o.paymentMethod} size="sm" />}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
        {!rows.length && !(income && unpaid.length) && (
          <p className="py-10 text-center text-muted-foreground">Nada {income ? 'a receber' : 'a pagar'} nos próximos 30 dias.</p>
        )}
      </div>
    );
  }

  return (
    <>
      <PageHeader title="A pagar e receber" description="Contas em aberto até os próximos 30 dias, com os vencidos no topo." />
      <Tabs defaultValue="pagar" className="gap-4">
        <TabsList>
          <TabsTrigger value="pagar">A pagar · {formatCents(total(side('SAIDA')))}</TabsTrigger>
          <TabsTrigger value="receber">A receber · {formatCents(total(side('ENTRADA')) + total(unpaid))}</TabsTrigger>
        </TabsList>
        <TabsContent value="pagar">
          <Panel direction="SAIDA" />
        </TabsContent>
        <TabsContent value="receber">
          <Panel direction="ENTRADA" />
        </TabsContent>
      </Tabs>
    </>
  );
}
