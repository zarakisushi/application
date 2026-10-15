import { listTenants, withContext } from '@zaraki/db';
import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { STATUS_FILTER } from '@/components/admin/filters';
import { ListToolbar } from '@/components/admin/ListToolbar';
import { EmptyRow, Pagination, readListParams, StatusBadge } from '@/components/admin/list';
import { PageHeader } from '@/components/admin/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireAdmin } from '@/server/admin';

export const metadata: Metadata = { title: 'Unidades' };

export default async function TenantsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const ctx = await requireAdmin('tenants:manage');
  const sp = await searchParams;
  const params = readListParams(sp);
  const page = await withContext({ ...ctx.db, platformAdmin: true }, (tx) => listTenants(tx, params));

  return (
    <>
      <PageHeader
        title="Unidades"
        description="Matriz e franqueados da rede Zaraki. Cada unidade tem dados, cardápio e equipe próprios."
        actions={
          <Button asChild>
            <Link href="/admin/unidades/nova">
              <Plus /> Nova unidade
            </Link>
          </Button>
        }
      />
      <ListToolbar q={params.q} placeholder="Buscar por nome ou cidade" filters={[STATUS_FILTER(params.status)]} />
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Unidade</TableHead>
              <TableHead>Cidade</TableHead>
              <TableHead>Prefixo</TableHead>
              <TableHead className="text-right">Royalties</TableHead>
              <TableHead>Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.rows.map((t) => (
              <TableRow key={t.id}>
                <TableCell>
                  <Link href={`/admin/unidades/${t.id}`} className="font-medium hover:underline">
                    {t.name}
                  </Link>
                  {t.kind === 'MATRIZ' && (
                    <Badge variant="outline" className="ml-2 border-brand-gold bg-accent">
                      Matriz
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{t.city ?? '—'}</TableCell>
                <TableCell>{t.orderCodePrefix}</TableCell>
                <TableCell className="text-right">{Number(t.royaltyPct).toLocaleString('pt-BR')}%</TableCell>
                <TableCell>
                  <StatusBadge active={t.status} />
                </TableCell>
              </TableRow>
            ))}
            {!page.rows.length && <EmptyRow colSpan={5}>Nenhuma unidade encontrada.</EmptyRow>}
          </TableBody>
        </Table>
      </Card>
      <Pagination {...page} basePath="/admin/unidades" searchParams={sp} />
    </>
  );
}
