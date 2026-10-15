import { getCoupon, listCouponOrders, withContext } from '@zaraki/db';
import { RotateCcw, Trash2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/admin/ConfirmAction';
import { CouponActiveSwitch } from '@/components/admin/CouponActiveSwitch';
import { CouponForm } from '@/components/admin/CouponForm';
import { EmptyRow, StageBadge, StatusBadge, TypeBadge } from '@/components/admin/list';
import { PageHeader } from '@/components/admin/PageHeader';
import { RecordTabs } from '@/components/admin/RecordTabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCents, formatDateTime } from '@/lib/format';
import { isUuid } from '@/lib/ids';
import { orderHref } from '@/lib/orders';
import { requireAdmin } from '@/server/admin';
import { recordHistory } from '@/server/history';
import { saveCoupon, setCouponStatusAction } from '../actions';

export const metadata: Metadata = { title: 'Cupom' };

export default async function CouponPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin('coupons:read');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await withContext(ctx.db, async (tx) => {
    const coupon = await getCoupon(tx, ctx.tenant.id, id);
    return coupon && { coupon, orders: await listCouponOrders(tx, ctx.tenant.id, id) };
  });
  if (!data) notFound();
  const { coupon, orders } = data;
  const history = await recordHistory(ctx, 'coupons', coupon.id);
  const tz = ctx.tenant.timezone;
  const canWrite = ctx.can('coupons:write') && coupon.status;

  return (
    <>
      <PageHeader
        title={coupon.code}
        description={coupon.description ?? 'Cupom de desconto'}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <CouponActiveSwitch id={coupon.id} code={coupon.code} active={coupon.active} disabled={!canWrite} />
              {coupon.active ? 'Ativo' : 'Desativado'}
            </label>
            <StatusBadge active={coupon.status} />
            {ctx.can('coupons:delete') &&
              (coupon.status ? (
                <ConfirmAction
                  key="excluir"
                  label="Excluir"
                  icon={<Trash2 />}
                  variant="destructive"
                  title={`Excluir o cupom ${coupon.code}?`}
                  description="O cupom deixa de existir para uso. Os pedidos que já o usaram continuam com o desconto e o histórico fica guardado. Para só pausar, use a chave Ativo."
                  confirmLabel="Excluir cupom"
                  action={setCouponStatusAction.bind(null, coupon.id, false)}
                />
              ) : (
                <ConfirmAction
                  key="restaurar"
                  label="Restaurar"
                  icon={<RotateCcw />}
                  title={`Restaurar o cupom ${coupon.code}?`}
                  description="O cupom volta à lista, com a mesma configuração de antes."
                  confirmLabel="Restaurar cupom"
                  action={setCouponStatusAction.bind(null, coupon.id, true)}
                />
              ))}
          </div>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {[
          ['Usos', `${coupon.stats.uses}${coupon.maxUses !== null ? ` de ${coupon.maxUses}` : ''}`],
          ['Desconto concedido', formatCents(coupon.stats.discountCents)],
          ['Valor dos pedidos', formatCents(coupon.stats.revenueCents)],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardHeader>
              <CardDescription>{label}</CardDescription>
              <CardTitle className="font-display text-2xl tabular-nums">{value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <RecordTabs history={history} timezone={tz}>
        <div className="grid gap-6">
          <CouponForm coupon={coupon} action={saveCoupon.bind(null, coupon.id)} readOnly={!canWrite} />
          <Card className="py-0">
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Pedido</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Etapa</TableHead>
                    <TableHead className="text-right">Desconto</TableHead>
                    <TableHead className="pr-6 text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((o) => (
                    <TableRow key={o.id} className={o.status && o.stage !== 'CANCELADO' ? '' : 'opacity-50'}>
                      <TableCell className="pl-6">
                        <Link href={orderHref(o)} className="font-medium hover:underline">
                          {o.code}
                        </Link>
                      </TableCell>
                      <TableCell>{o.customerName}</TableCell>
                      <TableCell>
                        <TypeBadge type={o.type} />
                      </TableCell>
                      <TableCell>{formatDateTime(o.createdAt, tz)}</TableCell>
                      <TableCell>
                        <StageBadge stage={o.stage} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">− {formatCents(o.discountCents)}</TableCell>
                      <TableCell className="pr-6 text-right tabular-nums">{formatCents(o.totalCents)}</TableCell>
                    </TableRow>
                  ))}
                  {!orders.length && <EmptyRow colSpan={7}>Este cupom ainda não foi usado.</EmptyRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </RecordTabs>
    </>
  );
}
