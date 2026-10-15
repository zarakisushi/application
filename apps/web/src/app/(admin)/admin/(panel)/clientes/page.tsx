import { listCustomers, withContext } from '@zaraki/db';
import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { STATUS_FILTER } from '@/components/admin/filters';
import { ListToolbar } from '@/components/admin/ListToolbar';
import { EmptyRow, Pagination, readListParams, StatusBadge } from '@/components/admin/list';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatBrPhone, formatCents, formatDate } from '@/lib/format';
import { requireAdmin } from '@/server/admin';

export const metadata: Metadata = { title: 'Clientes' };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const ctx = await requireAdmin('customers:read');
  const sp = await searchParams;
  const params = readListParams(sp);
  const page = await withContext(ctx.db, (tx) => listCustomers(tx, ctx.tenant.id, params));

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Clientes do site são cadastrados automaticamente pelo telefone."
        actions={
          ctx.can('customers:write') && (
            <Button asChild>
              <Link href="/admin/clientes/novo">
                <Plus /> Novo cliente
              </Link>
            </Button>
          )
        }
      />
      <ListToolbar q={params.q} placeholder="Buscar por nome ou telefone" filters={[STATUS_FILTER(params.status)]} />
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>WhatsApp</TableHead>
              <TableHead>Bairro</TableHead>
              <TableHead className="text-right">Pedidos</TableHead>
              <TableHead className="text-right">Total gasto</TableHead>
              <TableHead>Último pedido</TableHead>
              <TableHead>Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <Link href={`/admin/clientes/${c.id}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                </TableCell>
                <TableCell>{formatBrPhone(c.phone)}</TableCell>
                <TableCell className="text-muted-foreground">{c.neighborhood ?? '—'}</TableCell>
                <TableCell className="text-right">{c.orders}</TableCell>
                <TableCell className="text-right">{formatCents(c.spentCents)}</TableCell>
                <TableCell>{formatDate(c.lastOrderAt, ctx.tenant.timezone)}</TableCell>
                <TableCell>
                  <StatusBadge active={c.status} />
                </TableCell>
              </TableRow>
            ))}
            {!page.rows.length && <EmptyRow colSpan={7}>Nenhum cliente encontrado.</EmptyRow>}
          </TableBody>
        </Table>
      </Card>
      <Pagination {...page} basePath="/admin/clientes" searchParams={sp} />
    </>
  );
}
