import { AUDIT_ENTITY_LABEL, auditActor } from '@zaraki/core';
import { getAuditLog, withContext } from '@zaraki/db';
import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuditActionBadge, AuditChangesTable, AuditRecord } from '@/components/admin/audit';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/format';
import { requireAdmin } from '@/server/admin';

export const metadata: Metadata = { title: 'Registro de auditoria' };

export default async function AuditEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin('audit:read');
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) notFound();
  // Sem a Matriz, o RLS só devolve registros da unidade ativa.
  const db = ctx.platformAdmin ? { ...ctx.db, platformAdmin: true } : ctx.db;
  const row = await withContext(db, (tx) => getAuditLog(tx, id));
  if (!row) notFound();
  const tz = ctx.tenant.timezone;

  const meta: [string, React.ReactNode][] = [
    ['Quando', formatDateTime(row.createdAt, tz)],
    ['Quem', auditActor(row.actorName, row.actorLabel)],
    ['Ação', <AuditActionBadge key="a" action={row.action} />],
    ['Registro', <AuditRecord key="r" row={row} />],
    ['Tipo', AUDIT_ENTITY_LABEL[row.entity] ?? row.entity],
    ['IP', row.ip ?? '—'],
    ['Navegador', row.userAgent ?? '—'],
    ['Requisição', row.requestId ?? '—'],
  ];

  return (
    <>
      <PageHeader
        title={`Registro #${row.id}`}
        actions={
          <Button variant="outline" asChild>
            <Link href="/admin/auditoria">
              <ArrowLeft /> Voltar à auditoria
            </Link>
          </Button>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>O que mudou</CardTitle>
          </CardHeader>
          <CardContent>
            <AuditChangesTable row={row} timezone={tz} />
          </CardContent>
        </Card>
        <div className="grid h-fit gap-6">
          <Card>
            <CardContent>
              <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-sm">
                {meta.map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="min-w-0 break-words">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <details className="text-xs">
                <summary className="cursor-pointer text-sm font-medium">Dados técnicos (assinatura e conteúdo bruto)</summary>
                <div className="mt-3 grid gap-2 font-mono break-all">
                  <div>
                    <span className="text-muted-foreground">hash:</span> {row.hash}
                  </div>
                  <div>
                    <span className="text-muted-foreground">anterior:</span> {row.prevHash ?? '— (primeiro da cadeia)'}
                  </div>
                  <pre className="overflow-x-auto rounded bg-muted p-2 whitespace-pre-wrap">{JSON.stringify({ antes: row.before, depois: row.after }, null, 2)}</pre>
                </div>
              </details>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
