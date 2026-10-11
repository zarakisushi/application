import {
  ORDER_SOURCE_LABEL,
  PAYMENT_METHOD_LABEL,
  STAGE_LABEL,
  isScheduled,
  whatsappUrl,
  type PaymentMethod,
} from '@zaraki/core';
import { getLatestCalendarJob, getOrderDetail, listActiveMenu, withContext } from '@zaraki/db';
import { MessageCircle, RotateCcw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatBrPhone, formatCents, formatDateTime, toDateTimeInputs } from '@/lib/format';
import { isUuid } from '@/lib/ids';
import { orderSection } from '@/lib/orders';
import type { AdminContext } from '@/server/admin';
import { recordHistory } from '@/server/history';
import { setOrderStatusAction, updateOrderAction } from '@/server/order-actions';
import { ConfirmAction } from './ConfirmAction';
import { CalendarRetryButton } from './CalendarRetryButton';
import { CalendarSyncBadge, StageBadge, StatusBadge, TypeBadge } from './list';
import { OrderEditor } from './OrderEditor';
import { PageHeader } from './PageHeader';
import { RecordTabs } from './RecordTabs';
import { StageControls } from './StageControls';

/** Ficha completa do pedido (usada em Pedidos e em Encomendas). */
export async function OrderDetail({ ctx, id, section }: { ctx: AdminContext; id: string; section: 'pedidos' | 'encomendas' }) {
  if (!isUuid(id)) notFound();
  const data = await withContext(ctx.db, async (tx) => {
    const order = await getOrderDetail(tx, ctx.tenant.id, id);
    return order && { order, menu: await listActiveMenu(tx), calendarJob: await getLatestCalendarJob(tx, id) };
  });
  if (!data) notFound();
  const { order, menu, calendarJob } = data;
  if (orderSection(order.type) !== section) redirect(`/admin/${orderSection(order.type)}/${order.id}`);

  const tz = ctx.tenant.timezone;
  const history = await recordHistory(ctx, 'orders', order.id);
  const canWrite = ctx.can('orders:write') && order.status;
  const tubes = order.items.reduce((s, i) => s + i.qty, 0);
  const { date, time } = toDateTimeInputs(order.scheduledAt, tz);

  return (
    <>
      <PageHeader
        title={`Pedido ${order.code}`}
        description={`Recebido em ${formatDateTime(order.createdAt, tz)} · ${ORDER_SOURCE_LABEL[order.source]}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <TypeBadge type={order.type} />
            <StageBadge stage={order.stage} />
            <StatusBadge active={order.status} />
            {ctx.can('orders:delete') &&
              (order.status ? (
                <ConfirmAction
                  key="excluir"
                  label="Excluir"
                  icon={<Trash2 />}
                  variant="destructive"
                  title={`Excluir o pedido ${order.code}?`}
                  description="O pedido sai das listas e dos relatórios, mas fica guardado e pode ser restaurado. Para desistência do cliente, prefira cancelar."
                  confirmLabel="Excluir pedido"
                  action={setOrderStatusAction.bind(null, order.id, false)}
                />
              ) : (
                <ConfirmAction
                  key="restaurar"
                  label="Restaurar"
                  icon={<RotateCcw />}
                  title={`Restaurar o pedido ${order.code}?`}
                  description="O pedido volta para as listas e relatórios."
                  confirmLabel="Restaurar pedido"
                  action={setOrderStatusAction.bind(null, order.id, true)}
                />
              ))}
          </div>
        }
      />

      <RecordTabs history={history} timezone={tz} mainLabel="Pedido">
        <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
          <div className="grid h-fit gap-6">
            <Card className="py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Sabor</TableHead>
                    <TableHead className="text-right">Qtd.</TableHead>
                    <TableHead className="text-right">Unitário</TableHead>
                    <TableHead className="pr-6 text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.items.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="pl-6">{i.productName}</TableCell>
                      <TableCell className="text-right">{i.qty}</TableCell>
                      <TableCell className="text-right">{formatCents(i.unitPriceCents)}</TableCell>
                      <TableCell className="pr-6 text-right">{formatCents(i.lineTotalCents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="pl-6" colSpan={3}>
                      Subtotal ({tubes} tubos)
                    </TableCell>
                    <TableCell className="pr-6 text-right">{formatCents(order.subtotalCents)}</TableCell>
                  </TableRow>
                  {order.discountCents > 0 && (
                    <TableRow>
                      <TableCell className="pl-6" colSpan={3}>Desconto</TableCell>
                      <TableCell className="pr-6 text-right">− {formatCents(order.discountCents)}</TableCell>
                    </TableRow>
                  )}
                  {order.deliveryFeeCents > 0 && (
                    <TableRow>
                      <TableCell className="pl-6" colSpan={3}>Taxa de entrega</TableCell>
                      <TableCell className="pr-6 text-right">{formatCents(order.deliveryFeeCents)}</TableCell>
                    </TableRow>
                  )}
                  <TableRow className="text-base font-bold">
                    <TableCell className="pl-6" colSpan={3}>Total</TableCell>
                    <TableCell className="pr-6 text-right">{formatCents(order.totalCents)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </Card>

            {canWrite && (
              <Card>
                <CardHeader>
                  <CardTitle>Editar pedido</CardTitle>
                </CardHeader>
                <CardContent>
                  <OrderEditor
                    mode="edit"
                    defaultType={order.type}
                    products={menu}
                    order={{
                      type: order.type,
                      date,
                      time,
                      guests: order.guests,
                      neighborhood: order.neighborhood,
                      address: order.address,
                      notes: order.notes,
                      discountCents: order.discountCents,
                      deliveryFeeCents: order.deliveryFeeCents,
                      paymentMethod: order.paymentMethod,
                      paid: order.paid,
                      items: order.items,
                    }}
                    action={updateOrderAction.bind(null, order.id)}
                  />
                </CardContent>
              </Card>
            )}
          </div>

          <div className="grid h-fit gap-6">
            {canWrite && (
              <Card>
                <CardHeader>
                  <CardTitle>Etapa</CardTitle>
                </CardHeader>
                <CardContent>
                  <StageControls orderId={order.id} stage={order.stage} />
                  {order.cancelReason && (
                    <p className="mt-3 text-sm text-muted-foreground">Motivo do cancelamento: {order.cancelReason}</p>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Cliente</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <Link href={`/admin/clientes/${order.customer.id}`} className="font-medium hover:underline">
                  {order.customer.name}
                </Link>
                <span>{formatBrPhone(order.customer.phone)}</span>
                <Button variant="outline" size="sm" asChild className="mt-1 w-fit">
                  <a href={whatsappUrl(order.customer.phone)} target="_blank" rel="noopener noreferrer">
                    <MessageCircle /> Conversar no WhatsApp
                  </a>
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{isScheduled(order.type) ? 'Agendamento e entrega' : 'Entrega'}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                {isScheduled(order.type) && (
                  <>
                    <div className="font-medium">{formatDateTime(order.scheduledAt, tz)}</div>
                    {order.guests && <div>{order.guests} convidados</div>}
                    <div>
                      <CalendarSyncBadge state={order.calendarSyncState} />
                    </div>
                    {(order.calendarSyncState === 'PENDENTE' || order.calendarSyncState === 'FALHA') && (
                      <>
                        {calendarJob?.lastError && calendarJob.state !== 'DONE' && (
                          <p className="text-xs text-muted-foreground">Último erro da agenda: {calendarJob.lastError}</p>
                        )}
                        {canWrite && <CalendarRetryButton orderId={order.id} />}
                      </>
                    )}
                  </>
                )}
                <div>{[order.neighborhood, order.address].filter(Boolean).join(' · ') || 'Sem endereço informado'}</div>
                <div className="text-muted-foreground">
                  Pagamento: {order.paymentMethod ? PAYMENT_METHOD_LABEL[order.paymentMethod as PaymentMethod] : 'não informado'}
                  {order.paid ? ' · pago' : ' · em aberto'}
                </div>
                {order.notes && <p className="rounded-md bg-muted p-3">{order.notes}</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Histórico de etapas</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="grid gap-3 border-l pl-4 text-sm">
                  {order.history.map((h) => (
                    <li key={h.id}>
                      <div className="font-medium">{STAGE_LABEL[h.toStage]}</div>
                      <div className="text-muted-foreground">
                        {formatDateTime(h.createdAt, tz)} · {h.byName ?? (order.source === 'SITE' ? 'Site' : 'Sistema')}
                      </div>
                      {h.note && <div className="text-muted-foreground">“{h.note}”</div>}
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          </div>
        </div>
      </RecordTabs>
    </>
  );
}
