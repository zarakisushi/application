import { FINANCE_ACCOUNT_KIND_LABEL, formatCents, todayInZone } from '@zaraki/core';
import { getAccount, listStatements, withContext } from '@zaraki/db';
import { ArrowLeft, FileText, Scale, Trash2, Upload } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/admin/ConfirmAction';
import { StatementSheet } from '@/components/admin/finance/StatementSheet';
import { Money, formatDay } from '@/components/admin/finance/ui';
import { PageHeader } from '@/components/admin/PageHeader';
import { ReportChart } from '@/components/admin/reports/ReportChart';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { isUuid } from '@/lib/ids';
import { requireAdmin } from '@/server/admin';
import { adjustFromStatementAction, saveStatementAction, setStatementStatusAction, uploadAttachmentAction } from '../../actions';

export const metadata: Metadata = { title: 'Extratos da conta' };

export default async function AccountStatementsPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin('finance:read');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await withContext(ctx.db, async (tx) => {
    const account = await getAccount(tx, ctx.tenant.id, id);
    return account && { account, statements: await listStatements(tx, ctx.tenant.id, id) };
  });
  if (!data || !data.account.status) notFound();
  const { account, statements } = data;
  const today = todayInZone(ctx.tenant.timezone);
  const canWrite = ctx.can('finance:write');
  const canManage = ctx.can('finance:manage');
  const chartRows = [...statements].reverse().map((s) => ({ dia: s.statementDate, extrato: s.balanceCents, sistema: s.systemCents }));

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link href="/admin/financeiro/contas">
          <ArrowLeft /> Contas e categorias
        </Link>
      </Button>
      <PageHeader
        title={account.name}
        description={`${FINANCE_ACCOUNT_KIND_LABEL[account.kind]} · saldo no sistema hoje: ${formatCents(account.balanceCents)}`}
        actions={
          canWrite && (
            <StatementSheet
              accountName={account.name}
              today={today}
              action={saveStatementAction.bind(null, account.id)}
              upload={uploadAttachmentAction}
              trigger={
                <Button>
                  <Upload /> Enviar extrato
                </Button>
              }
            />
          )
        }
      />

      {statements.length > 1 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Saldo no extrato × saldo no sistema</CardTitle>
            <CardDescription>Cada ponto é um extrato enviado. Linhas juntas: a conta confere com o banco.</CardDescription>
          </CardHeader>
          <CardContent>
            <ReportChart
              spec={{
                type: 'line',
                x: 'dia',
                xFormat: 'date',
                format: 'money',
                series: [
                  { key: 'extrato', label: 'Saldo no extrato' },
                  { key: 'sistema', label: 'Saldo no sistema' },
                ],
              }}
              rows={chartRows}
            />
          </CardContent>
        </Card>
      )}

      <section className="grid gap-4" aria-label="Extratos enviados">
        {statements.map((s) => {
          const ok = s.diffCents === 0;
          return (
            <Card key={s.id} data-testid={`extrato-${s.statementDate}`}>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                <div className="grid gap-1">
                  <CardTitle>Extrato de {formatDay(s.statementDate)}</CardTitle>
                  <CardDescription>
                    Saldo no extrato <strong className="text-foreground">{formatCents(s.balanceCents)}</strong> · no sistema{' '}
                    {formatCents(s.systemCents)}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className={ok ? 'border-emerald-600/30 bg-emerald-50 text-emerald-800' : 'border-amber-500/40 bg-amber-50 text-amber-800'}
                  >
                    {ok ? 'Confere' : `Diferença de ${formatCents(Math.abs(s.diffCents))} ${s.diffCents > 0 ? 'a mais no banco' : 'a menos no banco'}`}
                  </Badge>
                  {canManage && !ok && (
                    <ConfirmAction
                      label="Lançar ajuste da diferença"
                      size="sm"
                      icon={<Scale />}
                      title="Lançar o ajuste da diferença?"
                      description={`Um lançamento de ajuste de ${formatCents(Math.abs(s.diffCents))} entra na conta na data do extrato (${formatDay(s.statementDate)}), e o saldo do sistema passa a conferir com o banco. Antes, vale procurar se falta lançar alguma entrada ou saída.`}
                      confirmLabel="Lançar ajuste"
                      action={adjustFromStatementAction.bind(null, s.id)}
                    />
                  )}
                  {canManage && (
                    <ConfirmAction
                      label="Excluir"
                      size="sm"
                      icon={<Trash2 />}
                      title={`Excluir o extrato de ${formatDay(s.statementDate)}?`}
                      description="O extrato sai do histórico da conta, mas fica registrado na auditoria."
                      confirmLabel="Excluir extrato"
                      action={setStatementStatusAction.bind(null, s.id, false)}
                    />
                  )}
                </div>
              </CardHeader>
              <CardContent className="grid gap-3">
                <ul className="flex flex-wrap gap-3" aria-label="Arquivos do extrato">
                  {s.files.map((f) => (
                    <li key={f.id}>
                      <a
                        href={`/api/financeiro/comprovante/${f.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="block w-28 overflow-hidden rounded-md border bg-muted transition-colors hover:border-brand-gold"
                        aria-label={`Abrir ${f.fileName}`}
                      >
                        {f.contentType.startsWith('image/') ? (
                          // eslint-disable-next-line @next/next/no-img-element -- arquivo privado servido pela rota protegida
                          <img src={`/api/financeiro/comprovante/${f.id}`} alt={f.fileName} loading="lazy" className="aspect-[3/4] w-full object-cover" />
                        ) : (
                          <span className="flex aspect-[3/4] flex-col items-center justify-center gap-1 p-2 text-center text-xs">
                            <FileText className="size-6" /> PDF
                          </span>
                        )}
                      </a>
                    </li>
                  ))}
                </ul>
                {s.notes && <p className="text-sm text-muted-foreground">{s.notes}</p>}
                {s.adjustmentEntryId && (
                  <Link href={`/admin/financeiro/lancamentos/${s.adjustmentEntryId}`} className="text-sm underline">
                    Ver o ajuste lançado
                  </Link>
                )}
              </CardContent>
            </Card>
          );
        })}
        {!statements.length && (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              Nenhum extrato enviado ainda. Envie a foto ou o PDF do extrato do banco para começar o histórico da conta.
            </CardContent>
          </Card>
        )}
      </section>
      <p className="mt-4 text-sm text-muted-foreground">
        Saldo atual da conta: <Money cents={account.balanceCents} className="font-medium" />. O saldo do sistema numa data considera o
        saldo inicial e tudo o que foi pago até aquele dia.
      </p>
    </>
  );
}
