import { STOCK_KIND_LABEL, STOCK_MOVEMENT_LABEL, formatCents, formatQty, formatUnitCost } from '@zaraki/core';
import { getStockItem, listItemMovements, withContext } from '@zaraki/db';
import { RotateCcw, Trash2, Undo2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/admin/ConfirmAction';
import { formatDay } from '@/components/admin/finance/ui';
import { EmptyRow, StatusBadge } from '@/components/admin/list';
import { PageHeader } from '@/components/admin/PageHeader';
import { RecordTabs } from '@/components/admin/RecordTabs';
import { StockItemForm } from '@/components/admin/stock/StockItemForm';
import { StockSituationBadge } from '@/components/admin/stock/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { isUuid } from '@/lib/ids';
import { orderHref } from '@/lib/orders';
import { requireAdmin } from '@/server/admin';
import { recordHistory } from '@/server/history';
import { loadStockOptions } from '@/server/stock';
import { saveStockItem, setStockItemStatusAction, undoStockMovementAction } from '../../actions';

export const metadata: Metadata = { title: 'Item de estoque' };

export default async function StockItemPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin('stock:read');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await withContext(ctx.db, async (tx) => {
    const item = await getStockItem(tx, ctx.tenant.id, id);
    return item && { item, movements: await listItemMovements(tx, ctx.tenant.id, id) };
  });
  if (!data) notFound();
  const { item, movements } = data;
  const [{ categories, suppliers }, history] = await Promise.all([loadStockOptions(ctx), recordHistory(ctx, 'stock_items', item.id)]);
  const canManage = ctx.can('stock:manage') && item.status;

  return (
    <>
      <PageHeader
        title={item.name}
        description={STOCK_KIND_LABEL[item.kind]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StockSituationBadge situation={item.situation} />
            <StatusBadge active={item.status} />
            {ctx.can('stock:delete') &&
              (item.status ? (
                <ConfirmAction
                  key="excluir"
                  label="Excluir"
                  icon={<Trash2 />}
                  variant="destructive"
                  title={`Excluir ${item.name}?`}
                  description="O item sai das listas, compras e fichas técnicas. O histórico de movimentações continua guardado e ele pode ser restaurado."
                  confirmLabel="Excluir item"
                  action={setStockItemStatusAction.bind(null, item.id, false)}
                />
              ) : (
                <ConfirmAction
                  key="restaurar"
                  label="Restaurar"
                  icon={<RotateCcw />}
                  title={`Restaurar ${item.name}?`}
                  description="O item volta às listas com o mesmo saldo."
                  confirmLabel="Restaurar"
                  action={setStockItemStatusAction.bind(null, item.id, true)}
                />
              ))}
          </div>
        }
      />
      <section className="mb-6 grid gap-4 sm:grid-cols-3">
        {[
          ['Saldo atual', formatQty(item.balance, item.unit)],
          ['Custo médio', formatUnitCost(item.avgCostCents, item.unit)],
          ['Valor em estoque', item.avgCostCents === null ? '—' : formatCents(Math.round(Math.max(0, item.balance) * item.avgCostCents))],
        ].map(([label, value]) => (
          <Card key={label} className="gap-2 py-4">
            <CardHeader className="px-4">
              <CardDescription>{label}</CardDescription>
              <CardTitle className="font-display text-xl tabular-nums">{value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </section>
      <RecordTabs history={history} timezone={ctx.tenant.timezone}>
        <div className="grid gap-6">
          <Card className="py-0">
            <CardHeader className="pt-6">
              <CardTitle>Movimentações</CardTitle>
              <CardDescription>Entradas e saídas do item, das mais recentes para as mais antigas.</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Data</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Origem / observação</TableHead>
                    <TableHead className="text-right">Quantidade</TableHead>
                    <TableHead className="pr-6" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.map((m) => (
                    <TableRow key={m.id} className={m.status ? '' : 'opacity-50 line-through'}>
                      <TableCell className="pl-6 text-sm">{formatDay(m.occurredOn)}</TableCell>
                      <TableCell className="text-sm">{STOCK_MOVEMENT_LABEL[m.kind]}</TableCell>
                      <TableCell className="text-sm whitespace-normal">
                        {m.orderId && m.orderType ? (
                          <Link href={orderHref({ id: m.orderId, type: m.orderType })} className="underline">
                            Pedido {m.orderCode}
                          </Link>
                        ) : m.purchaseId ? (
                          <Link href={`/admin/estoque/compras/${m.purchaseId}`} className="underline">
                            Compra · {m.supplier}
                          </Link>
                        ) : (
                          (m.notes ?? '—')
                        )}
                        {m.totalCents ? <span className="text-muted-foreground"> · {formatCents(m.totalCents)}</span> : null}
                      </TableCell>
                      <TableCell className={`text-right font-medium tabular-nums ${m.qty < 0 ? 'text-brand-red' : 'text-emerald-700'}`}>
                        {m.qty > 0 ? '+' : '−'} {formatQty(Math.abs(m.qty), item.unit)}
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        {canManage && m.status && (m.kind === 'PERDA' || m.kind === 'CONSUMO' || m.kind === 'ENTRADA' || m.kind === 'AJUSTE') && (
                          <ConfirmAction
                            label="Desfazer"
                            size="sm"
                            icon={<Undo2 />}
                            title="Desfazer esta movimentação?"
                            description="Ela deixa de contar no saldo, mas continua no histórico."
                            confirmLabel="Desfazer"
                            action={undoStockMovementAction.bind(null, m.id)}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!movements.length && <EmptyRow colSpan={5}>Nenhuma movimentação ainda. Registre uma compra ou faça uma contagem.</EmptyRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <StockItemForm item={item} categories={categories} suppliers={suppliers.map((s) => s.name)} action={saveStockItem.bind(null, item.id)} readOnly={!canManage} />
        </div>
      </RecordTabs>
    </>
  );
}
