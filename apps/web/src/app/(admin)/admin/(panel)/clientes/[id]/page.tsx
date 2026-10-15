import { whatsappUrl } from '@zaraki/core';
import { getCustomer, listCustomerOrders, withContext } from '@zaraki/db';
import { MessageCircle, RotateCcw, Trash2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/admin/ConfirmAction';
import { CustomerForm } from '@/components/admin/CustomerForm';
import { EmptyRow, StageBadge, StatusBadge, TypeBadge } from '@/components/admin/list';
import { PageHeader } from '@/components/admin/PageHeader';
import { RecordTabs } from '@/components/admin/RecordTabs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatBrPhone, formatCents, formatDate, formatDateTime } from '@/lib/format';
import { isUuid } from '@/lib/ids';
import { orderHref } from '@/lib/orders';
import { requireAdmin } from '@/server/admin';
import { recordHistory } from '@/server/history';
import { saveCustomer, setCustomerStatusAction } from '../actions';

export const metadata: Metadata = { title: 'Cliente' };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin('customers:read');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await withContext(ctx.db, async (tx) => {
    const customer = await getCustomer(tx, ctx.tenant.id, id);
    return customer && { customer, orders: await listCustomerOrders(tx, ctx.tenant.id, id) };
  });
  if (!data) notFound();
  const { customer, orders } = data;
  const history = await recordHistory(ctx, 'customers', customer.id);
  const tz = ctx.tenant.timezone;
  const avgTicket = customer.stats.orders ? Math.round(customer.stats.spentCents / customer.stats.orders) : 0;

  return (
    <>
      <PageHeader
        title={customer.name}
        description={formatBrPhone(customer.phone)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge active={customer.status} />
            <Button variant="outline" asChild>
              <a href={whatsappUrl(customer.phone)} target="_blank" rel="noopener noreferrer">
                <MessageCircle /> Conversar
              </a>
            </Button>
            {ctx.can('customers:delete') &&
              (customer.status ? (
                <ConfirmAction
                  key="excluir"
                  label="Excluir"
                  icon={<Trash2 />}
                  variant="destructive"
                  title="Excluir este cliente?"
                  description="O cadastro fica inativo, mas os pedidos e o histórico continuam guardados. É possível restaurar depois."
                  confirmLabel="Excluir cliente"
                  action={setCustomerStatusAction.bind(null, customer.id, false)}
                />
              ) : (
                <ConfirmAction
                  key="restaurar"
                  label="Restaurar"
                  icon={<RotateCcw />}
                  title="Restaurar este cliente?"
                  description="O cadastro volta a ficar ativo."
                  confirmLabel="Restaurar cliente"
                  action={setCustomerStatusAction.bind(null, customer.id, true)}
                />
              ))}
          </div>
        }
      />

      <RecordTabs history={history} timezone={tz}>
        <div className="mb-6 grid gap-4 sm:grid-cols-4">
          {[
            ['Pedidos', String(customer.stats.orders)],
            ['Total gasto', formatCents(customer.stats.spentCents)],
            ['Ticket médio', formatCents(avgTicket)],
            ['Último pedido', formatDate(customer.stats.lastOrderAt, tz)],
          ].map(([label, value]) => (
            <Card key={label}>
              <CardHeader>
                <CardDescription>{label}</CardDescription>
                <CardTitle className="font-display text-2xl">{value}</CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <CustomerForm
            customer={customer}
            action={saveCustomer.bind(null, customer.id)}
            readOnly={!ctx.can('customers:write') || !customer.status}
          />
          <Card className="h-fit py-0">
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Pedido</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Etapa</TableHead>
                    <TableHead className="pr-6 text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((o) => (
                    <TableRow key={o.id} className={o.status ? '' : 'opacity-50'}>
                      <TableCell className="pl-6">
                        <Link href={orderHref(o)} className="font-medium hover:underline">
                          {o.code}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <TypeBadge type={o.type} />
                      </TableCell>
                      <TableCell>{formatDateTime(o.scheduledAt ?? o.createdAt, tz)}</TableCell>
                      <TableCell>
                        <StageBadge stage={o.stage} />
                      </TableCell>
                      <TableCell className="pr-6 text-right">{formatCents(o.totalCents)}</TableCell>
                    </TableRow>
                  ))}
                  {!orders.length && <EmptyRow colSpan={5}>Este cliente ainda não fez pedidos.</EmptyRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </RecordTabs>
    </>
  );
}
