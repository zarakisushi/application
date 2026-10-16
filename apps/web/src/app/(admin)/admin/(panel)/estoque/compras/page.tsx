import { formatCents } from '@zaraki/core';
import { listStockPurchases, withContext } from '@zaraki/db';
import { ShoppingCart } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { STATUS_FILTER } from '@/components/admin/filters';
import { formatDay } from '@/components/admin/finance/ui';
import { ListToolbar } from '@/components/admin/ListToolbar';
import { EmptyRow, Pagination, readListParams } from '@/components/admin/list';
import { PageHeader } from '@/components/admin/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireAdmin } from '@/server/admin';

export const metadata: Metadata = { title: 'Compras de estoque' };

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const ctx = await requireAdmin('stock:read');
  const sp = await searchParams;
  const params = readListParams(sp);
  const page = await withContext(ctx.db, (tx) => listStockPurchases(tx, ctx.tenant.id, params));
  return (
    <>
      <PageHeader
        title="Compras de estoque"
        description="Cada compra entra no estoque e vira conta a pagar no Financeiro."
        actions={
          ctx.can('stock:manage') && (
            <Button asChild>
              <Link href="/admin/estoque/compras/nova">
                <ShoppingCart /> Registrar compra
              </Link>
            </Button>
          )
        }
      />
      <ListToolbar q={params.q} placeholder="Buscar fornecedor" filters={[STATUS_FILTER(params.status)]} />
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Fornecedor</TableHead>
              <TableHead className="text-right">Itens</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead>Pagamento</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.rows.map((p) => (
              <TableRow key={p.id} className={p.status ? '' : 'opacity-50'}>
                <TableCell className="text-sm">{formatDay(p.purchasedOn)}</TableCell>
                <TableCell>
                  <Link href={`/admin/estoque/compras/${p.id}`} className="font-medium hover:underline">
                    {p.supplier}
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums">{p.items}</TableCell>
                <TableCell className="text-sm">{formatDay(p.dueDate)}</TableCell>
                <TableCell>
                  {!p.status ? (
                    <Badge variant="outline">Cancelada</Badge>
                  ) : p.paid ? (
                    <Badge variant="outline" className="border-emerald-600/30 bg-emerald-50 text-emerald-800">
                      Paga
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-sky-500/40 bg-sky-50 text-sky-800">
                      A pagar
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatCents(p.totalCents)}</TableCell>
              </TableRow>
            ))}
            {!page.rows.length && <EmptyRow colSpan={6}>Nenhuma compra registrada.</EmptyRow>}
          </TableBody>
        </Table>
      </Card>
      <Pagination {...page} basePath="/admin/estoque/compras" searchParams={sp} />
    </>
  );
}
