import {
  DRE_GROUP_LABEL,
  DRE_GROUPS,
  FINANCE_ACCOUNT_KIND_LABEL,
  formatCents,
  PAYMENT_METHOD_LABEL,
  todayInZone,
  type FinanceDirection,
  type PaymentMethod,
} from '@zaraki/core';
import { addMonths } from '@zaraki/core';
import { listClosings, statementSummary, withContext } from '@zaraki/db';
import { ArrowLeftRight, FileImage, Lock, LockOpen, Pencil, Plus, Scale, Trash2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ConfirmAction } from '@/components/admin/ConfirmAction';
import { AccountSheet, CategorySheet, ReconcileSheet, TransferSheet } from '@/components/admin/finance/FinanceSheets';
import { Money } from '@/components/admin/finance/ui';
import { PageHeader } from '@/components/admin/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { requireAdmin } from '@/server/admin';
import { loadFinanceOptions } from '@/server/finance';
import {
  closeMonthAction,
  reconcileAccountAction,
  reopenMonthAction,
  saveAccount,
  saveCategory,
  setAccountStatusAction,
  setCategoryStatusAction,
  transferAction,
} from '../actions';

export const metadata: Metadata = { title: 'Contas e categorias' };

export default async function AccountsPage() {
  const ctx = await requireAdmin('finance:read');
  const { accounts, categories } = await loadFinanceOptions(ctx);
  const today = todayInZone(ctx.tenant.timezone);
  const canManage = ctx.can('finance:manage');
  const canWrite = ctx.can('finance:write');
  const active = accounts.filter((a) => a.active);
  const total = accounts.reduce((s, a) => s + a.balanceCents, 0);
  const { closings, statements } = await withContext(ctx.db, async (tx) => ({
    closings: await listClosings(tx, ctx.tenant.id),
    statements: await statementSummary(tx, ctx.tenant.id),
  }));
  const daysSince = (d: string) => Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${d}T12:00:00Z`)) / 86_400_000);
  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const pastMonths = Array.from({ length: 12 }, (_, i) => addMonths(`${today.slice(0, 7)}-01`, -(i + 1)));

  const categoryTable = (direction: FinanceDirection) => (
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Categoria</TableHead>
            <TableHead>Grupo (DRE)</TableHead>
            <TableHead className="text-right">Lançamentos</TableHead>
            <TableHead>Situação</TableHead>
            {canManage && <TableHead className="w-32" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {DRE_GROUPS.flatMap((g) => categories.filter((c) => c.direction === direction && c.dreGroup === g)).map((c) => (
            <TableRow key={c.id} className={c.active ? '' : 'opacity-60'}>
              <TableCell className="font-medium">
                {c.name}
                {c.systemKey && (
                  <Badge variant="outline" className="ml-2 text-xs text-muted-foreground">
                    do sistema
                  </Badge>
                )}
                {c.cmv && (
                  <Badge variant="outline" className="ml-2 border-brand-gold text-xs">
                    CMV
                  </Badge>
                )}
              </TableCell>
              <TableCell className="text-sm">{DRE_GROUP_LABEL[c.dreGroup]}</TableCell>
              <TableCell className="text-right tabular-nums">{c.uses}</TableCell>
              <TableCell className="text-sm">{c.active ? 'Ativa' : 'Desativada'}</TableCell>
              {canManage && (
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <CategorySheet
                      category={c}
                      action={saveCategory.bind(null, c.id)}
                      trigger={
                        <Button variant="ghost" size="sm" aria-label={`Editar categoria ${c.name}`}>
                          <Pencil />
                        </Button>
                      }
                    />
                    {!c.systemKey && (
                      <ConfirmAction
                        label="Excluir"
                        size="sm"
                        icon={<Trash2 />}
                        variant="outline"
                        title={`Excluir a categoria ${c.name}?`}
                        description="Os lançamentos antigos continuam com ela no histórico. Para só tirar das opções, desative a categoria."
                        confirmLabel="Excluir categoria"
                        action={setCategoryStatusAction.bind(null, c.id, false)}
                      />
                    )}
                  </div>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );

  return (
    <>
      <PageHeader title="Contas e categorias" description={`Saldos e plano de contas da ${ctx.tenant.name}.`} />
      <Tabs defaultValue="contas" className="gap-4">
        <TabsList>
          <TabsTrigger value="contas">Contas</TabsTrigger>
          <TabsTrigger value="saidas">Categorias de saída</TabsTrigger>
          <TabsTrigger value="entradas">Categorias de entrada</TabsTrigger>
          <TabsTrigger value="fechamento">Fechamento do mês</TabsTrigger>
        </TabsList>

        <TabsContent value="contas" className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm text-muted-foreground">Saldo total das contas</div>
              <Money cents={total} className="font-display text-3xl font-bold" />
            </div>
            <div className="flex flex-wrap gap-2">
              {canWrite && active.length > 1 && (
                <TransferSheet
                  accounts={active}
                  action={transferAction}
                  today={today}
                  trigger={
                    <Button variant="outline">
                      <ArrowLeftRight /> Transferir entre contas
                    </Button>
                  }
                />
              )}
              {canManage && (
                <AccountSheet
                  action={saveAccount.bind(null, null)}
                  today={today}
                  trigger={
                    <Button>
                      <Plus /> Nova conta
                    </Button>
                  }
                />
              )}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {accounts.map((a) => (
              <Card key={a.id} className={a.active ? '' : 'opacity-60'} data-testid={`conta-${a.name}`}>
                <CardHeader>
                  <CardDescription>
                    {FINANCE_ACCOUNT_KIND_LABEL[a.kind]}
                    {!a.active && ' · desativada'}
                  </CardDescription>
                  <CardTitle>{a.name}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <Money cents={a.balanceCents} className="font-display text-2xl font-bold" />
                  <p className="text-xs text-muted-foreground">
                    {a.receivesMethods.length
                      ? `Recebe vendas em: ${a.receivesMethods.map((m) => PAYMENT_METHOD_LABEL[m as PaymentMethod]).join(', ')}`
                      : 'Não recebe vendas automaticamente'}
                    {' · '}saldo inicial de {formatCents(a.openingBalanceCents)}
                  </p>
                  {(() => {
                    const st = statements.find((x) => x.accountId === a.id);
                    if (!st?.lastDate) return a.kind === 'BANCO' ? <p className="text-xs text-amber-800">Nenhum extrato enviado ainda.</p> : null;
                    const days = daysSince(st.lastDate);
                    return (
                      <p className={`text-xs ${days > 31 || st.lastDiffCents ? 'text-amber-800' : 'text-muted-foreground'}`}>
                        Último extrato: {days === 0 ? 'hoje' : `há ${days} ${days === 1 ? 'dia' : 'dias'}`}
                        {st.lastDiffCents ? ` · diferença de ${formatCents(Math.abs(st.lastDiffCents))}` : ' · confere'}
                      </p>
                    );
                  })()}
                  <div className="flex flex-wrap gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/admin/financeiro/contas/${a.id}`}>
                        <FileImage /> Extratos ({statements.find((x) => x.accountId === a.id)?.count ?? 0})
                      </Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/admin/financeiro/lancamentos?conta=${a.id}&periodo=tudo`}>Ver lançamentos</Link>
                    </Button>
                    {canManage && (
                      <>
                        <AccountSheet
                          account={a}
                          action={saveAccount.bind(null, a.id)}
                          today={today}
                          trigger={
                            <Button variant="outline" size="sm">
                              <Pencil /> Editar
                            </Button>
                          }
                        />
                        <ReconcileSheet
                          account={{ name: a.name, balanceLabel: formatCents(a.balanceCents) }}
                          action={reconcileAccountAction.bind(null, a.id)}
                          trigger={
                            <Button variant="outline" size="sm">
                              <Scale /> Conferir saldo
                            </Button>
                          }
                        />
                        <ConfirmAction
                          label="Excluir"
                          size="sm"
                          icon={<Trash2 />}
                          title={`Excluir a conta ${a.name}?`}
                          description="Só dá para excluir conta com saldo zero. Os lançamentos antigos continuam no histórico."
                          confirmLabel="Excluir conta"
                          action={setAccountStatusAction.bind(null, a.id, false)}
                        />
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="fechamento" className="grid gap-3">
          <p className="text-sm text-muted-foreground">
            Fechar um mês congela os números dele: lançamentos com competência ou pagamento no mês não podem mais ser criados, alterados ou
            excluídos (nem por edição de pedido). Contas daquele mês ainda em aberto podem ser pagas normalmente. Reabrir fica registrado na
            auditoria.
          </p>
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mês</TableHead>
                  <TableHead>Situação</TableHead>
                  {canManage && <TableHead className="w-40" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pastMonths.map((m) => {
                  const closed = closings.find((c) => c.month === m);
                  const label = `${MONTHS[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;
                  return (
                    <TableRow key={m} data-testid={`fechamento-${m.slice(0, 7)}`}>
                      <TableCell className="capitalize">{label}</TableCell>
                      <TableCell>
                        {closed ? (
                          <Badge variant="outline" className="border-border bg-muted">
                            <Lock className="size-3" /> Fechado
                          </Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">Aberto</span>
                        )}
                      </TableCell>
                      {canManage && (
                        <TableCell className="text-right">
                          {closed ? (
                            <ConfirmAction
                              label="Reabrir"
                              size="sm"
                              icon={<LockOpen />}
                              title={`Reabrir ${label}?`}
                              description="Os lançamentos do mês voltam a poder ser alterados. A reabertura fica registrada na auditoria."
                              confirmLabel="Reabrir mês"
                              action={reopenMonthAction.bind(null, m.slice(0, 7))}
                            />
                          ) : (
                            <ConfirmAction
                              label="Fechar mês"
                              size="sm"
                              icon={<Lock />}
                              title={`Fechar ${label}?`}
                              description="Confira antes os lançamentos e o saldo das contas. Depois de fechado, nada daquele mês muda sem reabrir."
                              confirmLabel="Fechar mês"
                              action={closeMonthAction.bind(null, m.slice(0, 7))}
                            />
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {(['saidas', 'entradas'] as const).map((tab) => (
          <TabsContent key={tab} value={tab} className="grid gap-4">
            {canManage && (
              <div>
                <CategorySheet
                  action={saveCategory.bind(null, null)}
                  trigger={
                    <Button>
                      <Plus /> Nova categoria
                    </Button>
                  }
                />
              </div>
            )}
            {categoryTable(tab === 'saidas' ? 'SAIDA' : 'ENTRADA')}
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}
