import { formatCents, formatQty } from '@zaraki/core';
import { getStockPurchase, withContext } from '@zaraki/db';
import { Ban, Paperclip } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/admin/ConfirmAction';
import { formatDay } from '@/components/admin/finance/ui';
import { PageHeader } from '@/components/admin/PageHeader';
import { RecordTabs } from '@/components/admin/RecordTabs';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { isUuid } from '@/lib/ids';
import { requireAdmin } from '@/server/admin';
import { recordHistory } from '@/server/history';
import { cancelPurchaseAction } from '../../actions';

export const metadata: Metadata = { title: 'Compra de estoque' };

export default async function PurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin('stock:read');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const purchase = await withContext(ctx.db, (tx) => getStockPurchase(tx, ctx.tenant.id, id));
  if (!purchase) notFound();
  const history = await recordHistory(ctx, 'stock_purchases', purchase.id);
  const canSeeFinance = ctx.can('finance:read');

  return (
    <>
      <PageHeader
        title={`Compra · ${purchase.supplier}`}
        description={`Em ${formatDay(purchase.purchasedOn)} · vencimento ${formatDay(purchase.dueDate)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!purchase.status && <Badge variant="outline">Cancelada</Badge>}
            {purchase.attachmentId && canSeeFinance && (
              <a href={`/api/financeiro/comprovante/${purchase.attachmentId}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sm underline">
                <Paperclip className="size-4" /> Nota fiscal
              </a>
            )}
            {ctx.can('stock:delete') && purchase.status && (
              <ConfirmAction
                label="Cancelar compra"
                icon={<Ban />}
                variant="destructive"
                title="Cancelar esta compra?"
                description="Os itens saem do estoque e as contas desta compra no Financeiro são estornadas. Tudo continua no histórico."
                confirmLabel="Cancelar compra"
                action={cancelPurchaseAction.bind(null, purchase.id)}
              />
            )}
          </div>
        }
      />
      <RecordTabs history={history} timezone={ctx.tenant.timezone}>
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Quantidade</TableHead>
                  <TableHead className="text-right">Por unidade</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchase.lines.map((l) => (
                  <TableRow key={l.itemId}>
                    <TableCell>
                      <Link href={`/admin/estoque/itens/${l.itemId}`} className="font-medium hover:underline">
                        {l.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatQty(l.qty, l.unit)}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground tabular-nums">{l.totalCents ? formatCents(Math.round(l.totalCents / l.qty)) : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCents(l.totalCents ?? 0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3}>Total</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatCents(purchase.totalCents)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </Card>
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>No Financeiro</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {purchase.entries.map((e) => (
                <div key={e.id} className={`flex items-center justify-between gap-2 ${e.status ? '' : 'line-through opacity-50'}`}>
                  <span>
                    {canSeeFinance ? (
                      <Link href={`/admin/financeiro/lancamentos/${e.id}`} className="underline">
                        {e.categoryName}
                      </Link>
                    ) : (
                      e.categoryName
                    )}
                    <span className="block text-xs text-muted-foreground">{e.paidOn ? `pago em ${formatDay(e.paidOn)}` : `vence ${formatDay(e.dueDate)}`}</span>
                  </span>
                  <span className="tabular-nums">{formatCents(e.amountCents)}</span>
                </div>
              ))}
              {purchase.notes && <p className="border-t pt-2 text-muted-foreground">{purchase.notes}</p>}
            </CardContent>
          </Card>
        </div>
      </RecordTabs>
    </>
  );
}
