import { FINANCE_ORIGIN_LABEL, FINANCE_ORIGINS, todayInZone, type FinanceDirection, type FinanceOrigin } from '@zaraki/core';
import { listEntries, withContext, type EntrySituationFilter } from '@zaraki/db';
import { Minus, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { STATUS_FILTER, type ToolbarFilter } from '@/components/admin/filters';
import { Money, OriginBadge, SituationBadge, formatDay } from '@/components/admin/finance/ui';
import { PayEntryButton } from '@/components/admin/finance/PayEntryButton';
import { ListToolbar } from '@/components/admin/ListToolbar';
import { EmptyRow, Pagination, param, readListParams } from '@/components/admin/list';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { orderHref } from '@/lib/orders';
import { requireAdmin } from '@/server/admin';
import { loadFinanceOptions, PERIODS, periodRange, type Period } from '@/server/finance';

export const metadata: Metadata = { title: 'Lançamentos' };

const SITUATIONS: Record<EntrySituationFilter, string> = { todos: 'Pagos e em aberto', pagos: 'Pagos/recebidos', abertos: 'Em aberto', vencidos: 'Vencidos' };
const pick = <T extends string>(value: string | undefined, allowed: readonly T[], fallback: T) => (value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback);

export default async function EntriesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const ctx = await requireAdmin('finance:read');
  const sp = await searchParams;
  const params = readListParams(sp);
  const today = todayInZone(ctx.tenant.timezone);

  const period = pick(param(sp.periodo), Object.keys(PERIODS) as Period[], 'mes');
  const direction = pick(param(sp.tipo), ['todos', 'ENTRADA', 'SAIDA'] as const, 'todos');
  const situation = pick(param(sp.situacao), Object.keys(SITUATIONS) as EntrySituationFilter[], 'todos');
  const origin = pick(param(sp.origem), ['todas', ...FINANCE_ORIGINS] as const, 'todas');
  const { categories, accounts } = await loadFinanceOptions(ctx);
  const categoryId = pick(param(sp.categoria), ['todas', ...categories.map((c) => c.id)], 'todas');
  const accountId = pick(param(sp.conta), ['todas', ...accounts.map((a) => a.id)], 'todas');

  const page = await withContext(ctx.db, (tx) =>
    listEntries(tx, ctx.tenant.id, {
      ...params,
      ...periodRange(period, today),
      direction: direction === 'todos' ? undefined : (direction as FinanceDirection),
      situation,
      origin: origin === 'todas' ? undefined : (origin as FinanceOrigin),
      categoryId: categoryId === 'todas' ? undefined : categoryId,
      accountId: accountId === 'todas' ? undefined : accountId,
      today,
    }),
  );
  const canWrite = ctx.can('finance:write');
  const activeAccounts = accounts.filter((a) => a.active).map((a) => ({ id: a.id, name: a.name }));

  const filters: ToolbarFilter[] = [
    { name: 'periodo', label: 'Período', value: period, options: Object.entries(PERIODS).map(([value, label]) => ({ value, label })) },
    { name: 'tipo', label: 'Tipo', value: direction, options: [{ value: 'todos', label: 'Entradas e saídas' }, { value: 'ENTRADA', label: 'Só entradas' }, { value: 'SAIDA', label: 'Só saídas' }] },
    { name: 'situacao', label: 'Situação do pagamento', value: situation, options: Object.entries(SITUATIONS).map(([value, label]) => ({ value, label })) },
    { name: 'categoria', label: 'Categoria', value: categoryId, options: [{ value: 'todas', label: 'Todas as categorias' }, ...categories.map((c) => ({ value: c.id, label: c.name }))] },
    { name: 'conta', label: 'Conta', value: accountId, options: [{ value: 'todas', label: 'Todas as contas' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))] },
    { name: 'origem', label: 'Origem', value: origin, options: [{ value: 'todas', label: 'Todas as origens' }, ...FINANCE_ORIGINS.map((o) => ({ value: o, label: FINANCE_ORIGIN_LABEL[o] }))] },
    STATUS_FILTER(params.status),
  ];

  const result = page.incomeCents - page.expenseCents;

  return (
    <>
      <PageHeader
        title="Lançamentos"
        description="Tudo o que entra e sai da unidade. As vendas entram sozinhas quando o pedido é marcado como pago."
        actions={
          canWrite && (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" className="border-emerald-600/40 text-emerald-800">
                <Link href="/admin/financeiro/lancamentos/novo?tipo=ENTRADA">
                  <Plus /> Nova entrada
                </Link>
              </Button>
              <Button asChild variant="outline" className="border-brand-red/40 text-brand-red">
                <Link href="/admin/financeiro/lancamentos/novo?tipo=SAIDA">
                  <Minus /> Nova saída
                </Link>
              </Button>
            </div>
          )
        }
      />
      <ListToolbar q={params.q} placeholder="Buscar por descrição, fornecedor ou observação" filters={filters} />

      <section className="mb-4 grid gap-4 sm:grid-cols-3" aria-label="Totais do filtro">
        {[
          ['Entradas', <Money key="e" cents={page.incomeCents} direction="ENTRADA" />],
          ['Saídas', <Money key="s" cents={page.expenseCents} direction="SAIDA" />],
          ['Resultado', <Money key="r" cents={result} className={result >= 0 ? 'text-emerald-700' : ''} />],
        ].map(([label, value]) => (
          <Card key={String(label)} className="gap-2 py-4">
            <CardHeader className="px-4">
              <CardDescription>{label}</CardDescription>
              <CardTitle className="font-display text-xl" data-testid={`total-${String(label).toLowerCase()}`}>
                {value}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </section>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Conta</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              {canWrite && <TableHead className="w-28" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.rows.map((e) => (
              <TableRow key={e.id} className={e.status ? '' : 'opacity-50'}>
                <TableCell className="whitespace-nowrap text-sm">
                  {e.paidOn ? formatDay(e.paidOn) : <span className="text-muted-foreground">vence {formatDay(e.dueDate)}</span>}
                </TableCell>
                <TableCell>
                  <Link href={`/admin/financeiro/lancamentos/${e.id}`} className="font-medium hover:underline">
                    {e.description}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {e.counterparty && e.origin !== 'PEDIDO' && <span>{e.counterparty}</span>}
                    {e.installments && e.origin === 'MANUAL' && !/\(\d+\/\d+\)$/.test(e.description) && (
                      <span>
                        mês {e.installment} de {e.installments}
                      </span>
                    )}
                    <OriginBadge origin={e.origin} />
                    {e.orderId && e.orderType && (
                      <Link href={orderHref({ id: e.orderId, type: e.orderType })} className="underline" prefetch={false}>
                        ver pedido
                      </Link>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-sm">{e.categoryName ?? '—'}</TableCell>
                <TableCell className="text-sm">{e.accountName ?? '—'}</TableCell>
                <TableCell>
                  <SituationBadge entry={e} today={today} />
                </TableCell>
                <TableCell className="text-right font-medium">
                  <Money cents={e.amountCents} direction={e.direction} />
                </TableCell>
                {canWrite && (
                  <TableCell className="text-right">
                    {!e.paidOn && e.status && e.origin !== 'PEDIDO' && e.origin !== 'TRANSFERENCIA' && (
                      <PayEntryButton entry={e} accounts={activeAccounts} today={today} />
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
            {!page.rows.length && <EmptyRow colSpan={canWrite ? 7 : 6}>Nenhum lançamento neste filtro.</EmptyRow>}
          </TableBody>
        </Table>
      </Card>
      <Pagination {...page} basePath="/admin/financeiro/lancamentos" searchParams={sp} />
    </>
  );
}
