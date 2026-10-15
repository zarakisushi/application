import { AUDIT_ACTION_LABEL, AUDIT_ENTITY_LABEL, auditActor, auditFieldLabel, isAuditFieldVisible } from '@zaraki/core';
import { listAuditActors, listAuditLogs, withContext, type AuditScope } from '@zaraki/db';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AuditActionBadge, AuditRecord } from '@/components/admin/audit';
import type { ToolbarFilter } from '@/components/admin/filters';
import { IntegrityCheck } from '@/components/admin/IntegrityCheck';
import { EmptyRow, param } from '@/components/admin/list';
import { ListToolbar } from '@/components/admin/ListToolbar';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';
import { isUuid } from '@/lib/ids';
import { cn } from '@/lib/utils';
import { requireAdmin } from '@/server/admin';

export const metadata: Metadata = { title: 'Auditoria' };

const PERIODS = { hoje: 1, '7d': 7, '30d': 30, '90d': 90, tudo: null } as const;
type Period = keyof typeof PERIODS;

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const ctx = await requireAdmin('audit:read');
  const sp = await searchParams;

  const network = ctx.platformAdmin && param(sp.escopo) === 'rede';
  const scope: AuditScope = network ? 'global' : { tenantId: ctx.tenant.id };
  const dbCtx = network ? { ...ctx.db, platformAdmin: true } : ctx.db;

  const periodParam = param(sp.periodo) as Period | undefined;
  const period: Period = periodParam && periodParam in PERIODS ? periodParam : '30d';
  const days = PERIODS[period];
  const action = param(sp.acao);
  const entity = param(sp.registro);
  const actorParam = param(sp.pessoa);
  const actorUserId = actorParam && isUuid(actorParam) ? actorParam : undefined;
  const q = param(sp.q)?.trim() || undefined;
  const page = Number(param(sp.page)) || 1;

  // Em sequência: a transação usa uma única conexão, que executa uma consulta por vez.
  const [result, actors] = await withContext(dbCtx, async (tx) => [
    await listAuditLogs(tx, {
      scope,
      action: action && action in AUDIT_ACTION_LABEL ? action : undefined,
      entity: entity && entity in AUDIT_ENTITY_LABEL ? entity : undefined,
      actorUserId,
      q,
      from: days ? new Date(Date.now() - days * 86_400_000) : undefined,
      page,
    }),
    await listAuditActors(tx, scope),
  ] as const);

  const filters: ToolbarFilter[] = [
    {
      name: 'periodo',
      label: 'Período',
      value: period,
      options: [
        { value: 'hoje', label: 'Últimas 24 horas' },
        { value: '7d', label: 'Últimos 7 dias' },
        { value: '30d', label: 'Últimos 30 dias' },
        { value: '90d', label: 'Últimos 90 dias' },
        { value: 'tudo', label: 'Todo o período' },
      ],
    },
    {
      name: 'acao',
      label: 'Ação',
      value: action ?? 'todas',
      options: [{ value: 'todas', label: 'Todas as ações' }, ...Object.entries(AUDIT_ACTION_LABEL).map(([value, label]) => ({ value, label }))],
    },
    {
      name: 'registro',
      label: 'Tipo de registro',
      value: entity ?? 'todos',
      options: [{ value: 'todos', label: 'Todos os registros' }, ...Object.entries(AUDIT_ENTITY_LABEL).map(([value, label]) => ({ value, label }))],
    },
    {
      name: 'pessoa',
      label: 'Pessoa',
      value: actorUserId ?? 'todas',
      options: [{ value: 'todas', label: 'Todas as pessoas' }, ...actors.map((a) => ({ value: a.id, label: a.name }))],
    },
  ];
  if (ctx.platformAdmin) {
    filters.unshift({
      name: 'escopo',
      label: 'Escopo',
      value: network ? 'rede' : 'unidade',
      options: [
        { value: 'unidade', label: ctx.tenant.name },
        { value: 'rede', label: 'Rede: logins e acessos' },
      ],
    });
  }

  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      const value = param(v);
      if (value && k !== 'page') params.set(k, value);
    }
    if (p > 1) params.set('page', String(p));
    return `/admin/auditoria${params.size ? `?${params}` : ''}`;
  };

  return (
    <>
      <PageHeader
        title="Auditoria"
        description="Tudo o que foi criado, alterado, excluído e restaurado — por quem, quando e de onde. Somente leitura."
      />
      <IntegrityCheck scope={network ? 'rede' : 'unidade'} />
      <ListToolbar q={q} placeholder="Buscar por id do registro, e-mail de login ou IP" filters={filters} />
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">Quando</TableHead>
              <TableHead>Quem</TableHead>
              <TableHead>Ação</TableHead>
              <TableHead>Registro</TableHead>
              <TableHead>Campos</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap">{formatDateTime(row.createdAt, ctx.tenant.timezone)}</TableCell>
                <TableCell>
                  {auditActor(row.actorName, row.actorLabel)}
                  {row.ip && <div className="text-xs text-muted-foreground">{row.ip}</div>}
                </TableCell>
                <TableCell>
                  <AuditActionBadge action={row.action} />
                </TableCell>
                <TableCell className="whitespace-normal">
                  <AuditRecord row={row} />
                </TableCell>
                <TableCell className="max-w-64 truncate text-xs text-muted-foreground">
                  {row.changedFields
                    ?.filter(isAuditFieldVisible)
                    .map(auditFieldLabel)
                    .join(', ')}
                </TableCell>
                <TableCell>
                  <Link href={`/admin/auditoria/${row.id}`} className="text-sm underline">
                    Detalhes
                  </Link>
                </TableCell>
              </TableRow>
            ))}
            {!result.rows.length && <EmptyRow colSpan={6}>Nenhum registro neste filtro.</EmptyRow>}
          </TableBody>
        </Table>
      </Card>
      <div className="mt-4 flex items-center justify-end gap-2 text-sm text-muted-foreground">
        <Button variant="outline" size="sm" asChild className={cn(page <= 1 && 'pointer-events-none opacity-50')}>
          <Link href={pageHref(page - 1)} aria-label="Página anterior">
            <ChevronLeft />
          </Link>
        </Button>
        <span>Página {page}</span>
        <Button variant="outline" size="sm" asChild className={cn(!result.hasNext && 'pointer-events-none opacity-50')}>
          <Link href={pageHref(page + 1)} aria-label="Próxima página">
            <ChevronRight />
          </Link>
        </Button>
      </div>
    </>
  );
}
