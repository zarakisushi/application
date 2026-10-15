import { ROLE_LABEL } from '@zaraki/core';
import { listTenantUsers, withContext } from '@zaraki/db';
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

export const metadata: Metadata = { title: 'Usuários' };

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const ctx = await requireAdmin('users:manage');
  const sp = await searchParams;
  const params = readListParams(sp);
  const page = await withContext(ctx.db, (tx) => listTenantUsers(tx, ctx.tenant.id, params));

  return (
    <>
      <PageHeader
        title="Usuários"
        description={`Quem acessa o painel da ${ctx.tenant.name}. Remover o acesso encerra as sessões abertas.`}
        actions={
          <Button asChild>
            <Link href="/admin/usuarios/novo">
              <Plus /> Novo usuário
            </Link>
          </Button>
        }
      />
      <ListToolbar q={params.q} placeholder="Buscar por nome ou e-mail" filters={[STATUS_FILTER(params.status)]} />
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Usuário</TableHead>
              <TableHead>Papel</TableHead>
              <TableHead>Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.rows.map((u) => (
              <TableRow key={u.userId}>
                <TableCell>
                  <Link href={`/admin/usuarios/${u.userId}`} className="font-medium hover:underline">
                    {u.name}
                  </Link>
                  {u.userId === ctx.user.id && <span className="ml-2 text-xs text-muted-foreground">(você)</span>}
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </TableCell>
                <TableCell>
                  {ROLE_LABEL[u.role]}
                  {u.isPlatformAdmin && (
                    <Badge variant="outline" className="ml-2 border-brand-gold bg-accent">
                      Rede
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="flex flex-wrap gap-2">
                  <StatusBadge active={u.status} />
                  {u.status && u.mustChangePassword && <Badge variant="outline">Aguardando 1º acesso</Badge>}
                </TableCell>
              </TableRow>
            ))}
            {!page.rows.length && <EmptyRow colSpan={3}>Nenhum usuário encontrado.</EmptyRow>}
          </TableBody>
        </Table>
      </Card>
      <Pagination {...page} basePath="/admin/usuarios" searchParams={sp} />
    </>
  );
}
