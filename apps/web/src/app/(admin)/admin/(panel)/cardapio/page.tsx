import { listProducts, withContext } from '@zaraki/db';
import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { STATUS_FILTER } from '@/components/admin/filters';
import { ListToolbar } from '@/components/admin/ListToolbar';
import { EmptyRow, Pagination, readListParams, StatusBadge } from '@/components/admin/list';
import { PageHeader } from '@/components/admin/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCents } from '@/lib/format';
import { requireAdmin } from '@/server/admin';

export const metadata: Metadata = { title: 'Cardápio' };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const ctx = await requireAdmin('products:read');
  const sp = await searchParams;
  const params = readListParams(sp);
  const page = await withContext(ctx.db, (tx) => listProducts(tx, ctx.tenant.id, params));

  return (
    <>
      <PageHeader
        title="Cardápio"
        description="Sabores vendidos no site e no painel. Excluir tira o sabor do site sem apagar o histórico."
        actions={
          ctx.can('products:write') && (
            <Button asChild>
              <Link href="/admin/cardapio/novo">
                <Plus /> Novo sabor
              </Link>
            </Button>
          )
        }
      />
      <ListToolbar q={params.q} placeholder="Buscar sabor" filters={[STATUS_FILTER(params.status)]} />
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16" />
              <TableHead>Sabor</TableHead>
              <TableHead className="text-right">Preço</TableHead>
              <TableHead className="text-right">Custo</TableHead>
              <TableHead className="text-right">Margem</TableHead>
              <TableHead>Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.rows.map((p) => {
              const margin = p.priceCents ? Math.round(((p.priceCents - p.costCents) / p.priceCents) * 100) : 0;
              return (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="relative size-12 overflow-hidden rounded-md bg-brand-ink">
                      {p.imageUrl && (
                        <Image src={p.imageUrl} alt="" fill sizes="48px" className="object-cover" unoptimized={p.imageUrl.startsWith('http')} />
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Link href={`/admin/cardapio/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                    {p.isSpecial && (
                      <Badge variant="outline" className="ml-2 border-brand-gold bg-accent">
                        Especial
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{formatCents(p.priceCents)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{p.costCents ? formatCents(p.costCents) : '—'}</TableCell>
                  <TableCell className="text-right">{p.costCents ? `${margin}%` : '—'}</TableCell>
                  <TableCell>
                    <StatusBadge active={p.status} />
                  </TableCell>
                </TableRow>
              );
            })}
            {!page.rows.length && <EmptyRow colSpan={6}>Nenhum sabor encontrado.</EmptyRow>}
          </TableBody>
        </Table>
      </Card>
      <Pagination {...page} basePath="/admin/cardapio" searchParams={sp} />
    </>
  );
}
