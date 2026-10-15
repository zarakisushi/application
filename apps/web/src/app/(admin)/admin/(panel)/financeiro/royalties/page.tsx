import { addMonths, formatCents, todayInZone } from '@zaraki/core';
import { listRoyaltyCharges, withContext } from '@zaraki/db';
import { RefreshCw } from 'lucide-react';
import type { Metadata } from 'next';
import { ConfirmAction } from '@/components/admin/ConfirmAction';
import { GenerateRoyalties } from '@/components/admin/finance/GenerateRoyalties';
import { formatDay } from '@/components/admin/finance/ui';
import { EmptyRow } from '@/components/admin/list';
import { PageHeader } from '@/components/admin/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireAdmin } from '@/server/admin';
import { recalculateRoyaltyAction } from '../actions';

export const metadata: Metadata = { title: 'Royalties' };

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const monthLabel = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]}/${d.slice(0, 4)}`;

type Charge = Awaited<ReturnType<typeof listRoyaltyCharges>>[number];

function situation(c: Charge, today: string, matriz: boolean) {
  if (!c.amount_cents) return { label: 'Sem faturamento', cls: 'border-border bg-muted text-muted-foreground' };
  if (c.franchise_paid_on && (c.matriz_paid_on || !matriz)) return { label: matriz ? 'Pago e recebido' : 'Pago', cls: 'border-emerald-600/30 bg-emerald-50 text-emerald-800' };
  if (c.franchise_paid_on) return { label: 'Franquia pagou: registrar o recebimento', cls: 'border-amber-500/40 bg-amber-50 text-amber-800' };
  if (matriz && c.matriz_paid_on) return { label: 'Recebido', cls: 'border-emerald-600/30 bg-emerald-50 text-emerald-800' };
  if (c.due_date < today) return { label: 'Vencido', cls: 'border-brand-red/40 bg-red-50 text-brand-red' };
  return { label: 'Em aberto', cls: 'border-sky-500/40 bg-sky-50 text-sky-800' };
}

export default async function RoyaltiesPage() {
  const ctx = await requireAdmin('finance:read');
  const today = todayInZone(ctx.tenant.timezone);
  const matriz = ctx.tenant.kind === 'MATRIZ';
  // A Matriz (administração da rede) vê as cobranças de todas as franquias e o pagamento dos dois lados.
  const db = matriz && ctx.platformAdmin ? { ...ctx.db, platformAdmin: true } : ctx.db;
  const charges = await withContext(db, (tx) => listRoyaltyCharges(tx, matriz ? {} : { tenantId: ctx.tenant.id }));
  const canManage = matriz && ctx.platformAdmin && ctx.can('finance:manage');
  const open = charges.filter((c) => c.amount_cents && !(matriz ? c.matriz_paid_on : c.franchise_paid_on));
  const lastMonths = Array.from({ length: 6 }, (_, i) => addMonths(`${today.slice(0, 7)}-01`, -(i + 1))).map((d) => ({ value: d.slice(0, 7), label: monthLabel(d) }));

  return (
    <>
      <PageHeader
        title="Royalties"
        description={
          matriz
            ? 'Cobranças de cada franquia: geradas sozinhas todo início de mês sobre o faturamento do mês anterior.'
            : 'O que esta unidade paga à Matriz: percentual sobre o faturamento de cada mês, cobrado no início do mês seguinte.'
        }
        actions={canManage && <GenerateRoyalties months={lastMonths} />}
      />
      <section className="mb-4 grid gap-4 sm:grid-cols-2" aria-label="Resumo dos royalties">
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardDescription>{matriz ? 'A receber das franquias' : 'A pagar à Matriz'}</CardDescription>
            <CardTitle className="font-display text-xl tabular-nums">{formatCents(open.reduce((s, c) => s + c.amount_cents, 0))}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardDescription>Cobranças em aberto</CardDescription>
            <CardTitle className="font-display text-xl tabular-nums">{open.length}</CardTitle>
          </CardHeader>
        </Card>
      </section>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Mês</TableHead>
              {matriz && <TableHead>Franquia</TableHead>}
              <TableHead className="text-right">Faturamento</TableHead>
              <TableHead className="text-right">%</TableHead>
              <TableHead className="text-right">Royalties</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead>Situação</TableHead>
              {canManage && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {charges.map((c) => {
              const s = situation(c, today, matriz);
              return (
                <TableRow key={c.id}>
                  <TableCell className="capitalize">{monthLabel(c.month)}</TableCell>
                  {matriz && <TableCell className="font-medium">{c.unidade}</TableCell>}
                  <TableCell className="text-right tabular-nums">{formatCents(c.revenue_cents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(c.royalty_pct).toLocaleString('pt-BR')}%</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatCents(c.amount_cents)}</TableCell>
                  <TableCell>{formatDay(c.due_date)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={s.cls}>
                      {s.label}
                    </Badge>
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      {!c.franchise_paid_on && !c.matriz_paid_on && (
                        <ConfirmAction
                          label="Recalcular"
                          size="sm"
                          icon={<RefreshCw />}
                          title={`Recalcular os royalties de ${c.unidade}?`}
                          description="O valor é refeito com o faturamento atual do mês (útil quando pedidos foram corrigidos depois). Os lançamentos antigos ficam no histórico."
                          confirmLabel="Recalcular"
                          action={recalculateRoyaltyAction.bind(null, c.id)}
                        />
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
            {!charges.length && (
              <EmptyRow colSpan={matriz ? 8 : 6}>
                {matriz ? 'Nenhuma cobrança ainda. Cadastre o percentual de royalties em Unidades.' : 'Nenhuma cobrança de royalties ainda.'}
              </EmptyRow>
            )}
          </TableBody>
        </Table>
      </Card>
      <p className="mt-3 text-sm text-muted-foreground">
        O pagamento é registrado em “A pagar e receber”: a franquia marca o pagamento e a Matriz marca o recebimento.
      </p>
    </>
  );
}
