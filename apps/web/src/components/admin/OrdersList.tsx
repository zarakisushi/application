import { ORDER_SOURCE_LABEL, ORDER_STAGES, STAGE_LABEL, type OrderStage } from '@zaraki/core';
import { listOrders, withContext, type OrderKind, type OrderPeriod } from '@zaraki/db';
import { CalendarDays, List, Plus } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatBrPhone, formatCents, formatDateTime } from '@/lib/format';
import type { AdminContext } from '@/server/admin';
import { STATUS_FILTER, type ToolbarFilter } from './filters';
import { CalendarSyncBadge, EmptyRow, Pagination, param, readListParams, StageBadge, StatusBadge, TypeBadge } from './list';
import { ListToolbar } from './ListToolbar';
import { OrdersCalendar } from './OrdersCalendar';
import { PageHeader } from './PageHeader';

type SearchParams = Record<string, string | string[] | undefined>;

const COPY = {
  pedidos: {
    title: 'Pedidos',
    description: 'Pedidos de delivery do site, do WhatsApp e do balcão.',
    newLabel: 'Novo pedido',
  },
  encomendas: {
    title: 'Festas e eventos',
    description: 'Festas e eventos agendados, sincronizados com a Google Agenda.',
    newLabel: 'Nova festa ou evento',
  },
} as const;

export async function OrdersList({ ctx, kind, searchParams }: { ctx: AdminContext; kind: Exclude<OrderKind, 'todos'>; searchParams: SearchParams }) {
  const base = `/admin/${kind}`;
  const params = readListParams(searchParams);
  const stageParam = param(searchParams.etapa);
  const stage = ORDER_STAGES.includes(stageParam as OrderStage) ? (stageParam as OrderStage) : undefined;
  const periodParam = param(searchParams.periodo);
  const period: OrderPeriod = periodParam === 'passadas' || periodParam === 'todas' ? periodParam : 'proximas';
  const calendar = kind === 'encomendas' && param(searchParams.visao) === 'calendario';
  const tz = ctx.tenant.timezone;

  const filters: ToolbarFilter[] = [
    {
      name: 'etapa',
      label: 'Etapa',
      value: stage ?? 'todas',
      options: [{ value: 'todas', label: 'Todas as etapas' }, ...ORDER_STAGES.map((s) => ({ value: s, label: STAGE_LABEL[s] }))],
    },
    STATUS_FILTER(params.status),
  ];
  if (kind === 'encomendas') {
    filters.unshift({
      name: 'periodo',
      label: 'Período',
      value: period,
      options: [
        { value: 'proximas', label: 'Próximas' },
        { value: 'passadas', label: 'Passadas' },
        { value: 'todas', label: 'Todas' },
      ],
    });
  }

  const header = (
    <PageHeader
      title={COPY[kind].title}
      description={COPY[kind].description}
      actions={
        <div className="flex flex-wrap gap-2">
          {kind === 'encomendas' && (
            <div className="flex rounded-md border bg-card p-0.5" role="group" aria-label="Visualização">
              <Button variant={calendar ? 'ghost' : 'secondary'} size="sm" asChild>
                <Link href={base}>
                  <List /> Lista
                </Link>
              </Button>
              <Button variant={calendar ? 'secondary' : 'ghost'} size="sm" asChild>
                <Link href={`${base}?visao=calendario`}>
                  <CalendarDays /> Calendário
                </Link>
              </Button>
            </div>
          )}
          {ctx.can('orders:write') && (
            <Button asChild>
              <Link href={`${base}/novo`}>
                <Plus /> {COPY[kind].newLabel}
              </Link>
            </Button>
          )}
        </div>
      }
    />
  );

  if (calendar) {
    return (
      <>
        {header}
        <OrdersCalendar ctx={ctx} month={param(searchParams.mes)} />
      </>
    );
  }

  const page = await withContext(ctx.db, (tx) =>
    listOrders(tx, ctx.tenant.id, { ...params, kind, stage, period, timezone: tz }),
  );
  const scheduled = kind === 'encomendas';

  return (
    <>
      {header}
      <ListToolbar q={params.q} placeholder="Buscar por código, cliente ou telefone" filters={filters} />
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pedido</TableHead>
              {scheduled && <TableHead>Tipo</TableHead>}
              <TableHead>Cliente</TableHead>
              <TableHead>{scheduled ? 'Data marcada' : 'Recebido em'}</TableHead>
              <TableHead>{scheduled ? 'Convidados' : 'Bairro'}</TableHead>
              <TableHead>Etapa</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>{scheduled ? 'Agenda' : 'Origem'}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.rows.map((o) => (
              <TableRow key={o.id} className={o.status ? '' : 'opacity-60'}>
                <TableCell>
                  <Link href={`${base}/${o.id}`} className="font-medium hover:underline">
                    {o.code}
                  </Link>
                  {!o.status && (
                    <div className="mt-1">
                      <StatusBadge active={false} />
                    </div>
                  )}
                </TableCell>
                {scheduled && (
                  <TableCell>
                    <TypeBadge type={o.type} />
                  </TableCell>
                )}
                <TableCell>
                  <div>{o.customerName}</div>
                  <div className="text-xs text-muted-foreground">{formatBrPhone(o.customerPhone)}</div>
                </TableCell>
                <TableCell>{formatDateTime(scheduled ? o.scheduledAt : o.createdAt, tz)}</TableCell>
                <TableCell className="text-muted-foreground">{scheduled ? (o.guests ?? '—') : (o.neighborhood ?? '—')}</TableCell>
                <TableCell>
                  <StageBadge stage={o.stage} />
                </TableCell>
                <TableCell className="text-right">
                  {formatCents(o.totalCents)}
                  {o.paid && <div className="text-xs text-emerald-700">pago</div>}
                </TableCell>
                <TableCell>
                  {scheduled ? <CalendarSyncBadge state={o.calendarSyncState} /> : ORDER_SOURCE_LABEL[o.source]}
                </TableCell>
              </TableRow>
            ))}
            {!page.rows.length && (
              <EmptyRow colSpan={scheduled ? 8 : 7}>
                {scheduled ? 'Nenhuma festa ou evento neste filtro.' : 'Nenhum pedido neste filtro.'}
              </EmptyRow>
            )}
          </TableBody>
        </Table>
      </Card>
      <Pagination {...page} basePath={base} searchParams={searchParams} />
    </>
  );
}
