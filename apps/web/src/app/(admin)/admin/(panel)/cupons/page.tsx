import { couponConditions, couponDiscountLabel, todayInZone } from '@zaraki/core';
import { listCoupons, withContext, type CouponState } from '@zaraki/db';
import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { CouponActiveSwitch } from '@/components/admin/CouponActiveSwitch';
import { STATUS_FILTER, type ToolbarFilter } from '@/components/admin/filters';
import { ListToolbar } from '@/components/admin/ListToolbar';
import { EmptyRow, Pagination, param, readListParams } from '@/components/admin/list';
import { PageHeader } from '@/components/admin/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { requireAdmin } from '@/server/admin';

export const metadata: Metadata = { title: 'Cupons' };

type Situation = { label: string; cls: string };

/** Responde "este cupom funciona agora?" numa palavra. */
function situation(c: { status: boolean; active: boolean; startsAt: string | null }, usedUp: boolean, expired: boolean, today: string): Situation {
  if (!c.status) return { label: 'Excluído', cls: 'border-brand-red/30 bg-red-50 text-brand-red' };
  if (!c.active) return { label: 'Desativado', cls: 'border-border bg-muted text-muted-foreground' };
  if (usedUp) return { label: 'Esgotado', cls: 'border-amber-500/40 bg-amber-50 text-amber-800' };
  if (expired) return { label: 'Expirado', cls: 'border-amber-500/40 bg-amber-50 text-amber-800' };
  if (c.startsAt && c.startsAt > today) return { label: 'Agendado', cls: 'border-sky-500/40 bg-sky-50 text-sky-800' };
  return { label: 'Válido', cls: 'border-emerald-600/30 bg-emerald-50 text-emerald-800' };
}

const STATES: Record<CouponState, string> = {
  todos: 'Todos os cupons',
  validos: 'Válidos agora',
  inativos: 'Desativados',
  esgotados: 'Esgotados',
  expirados: 'Expirados',
};

export default async function CouponsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const ctx = await requireAdmin('coupons:read');
  const sp = await searchParams;
  const params = readListParams(sp);
  const stateParam = param(sp.situacao) as CouponState | undefined;
  const state: CouponState = stateParam && stateParam in STATES ? stateParam : 'todos';
  const tz = ctx.tenant.timezone;
  const page = await withContext(ctx.db, (tx) => listCoupons(tx, ctx.tenant.id, { ...params, state, timezone: tz }));
  const today = todayInZone(tz);
  const canWrite = ctx.can('coupons:write');

  const filters: ToolbarFilter[] = [
    { name: 'situacao', label: 'Validade', value: state, options: Object.entries(STATES).map(([value, label]) => ({ value, label })) },
    STATUS_FILTER(params.status),
  ];

  return (
    <>
      <PageHeader
        title="Cupons"
        description="Descontos para o site e para os pedidos lançados no painel. Desligue um cupom pela chave “Ativo” a qualquer momento."
        actions={
          canWrite && (
            <Button asChild>
              <Link href="/admin/cupons/novo">
                <Plus /> Novo cupom
              </Link>
            </Button>
          )
        }
      />
      <ListToolbar q={params.q} placeholder="Buscar por código ou descrição" filters={filters} />
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Desconto</TableHead>
              <TableHead>Condições</TableHead>
              <TableHead className="text-right">Usos</TableHead>
              <TableHead>Validade</TableHead>
              <TableHead>Ativo</TableHead>
              <TableHead>Situação agora</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.rows.map((c) => {
              const usedUp = c.maxUses !== null && c.uses >= c.maxUses;
              const expired = !!c.endsAt && c.endsAt < today;
              const state = situation(c, usedUp, expired, today);
              return (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link href={`/admin/cupons/${c.id}`} className="font-mono font-semibold hover:underline">
                      {c.code}
                    </Link>
                    {c.description && <div className="text-xs text-muted-foreground">{c.description}</div>}
                  </TableCell>
                  <TableCell className="font-medium">{couponDiscountLabel(c)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {couponConditions(c)}
                    {c.phone && (
                      <Badge variant="outline" className="ml-2 border-brand-gold bg-accent">
                        Exclusivo
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.uses}
                    {c.maxUses !== null && ` / ${c.maxUses}`}
                  </TableCell>
                  <TableCell className="text-sm">
                    {c.startsAt || c.endsAt ? (
                      <>
                        {c.startsAt ? formatDate(`${c.startsAt}T12:00:00Z`, 'UTC') : '…'} até {c.endsAt ? formatDate(`${c.endsAt}T12:00:00Z`, 'UTC') : '…'}
                      </>
                    ) : (
                      <span className="text-muted-foreground">sem prazo</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <CouponActiveSwitch id={c.id} code={c.code} active={c.active} disabled={!canWrite || !c.status} />
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={state.cls}>
                      {state.label}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
            {!page.rows.length && <EmptyRow colSpan={7}>Nenhum cupom neste filtro.</EmptyRow>}
          </TableBody>
        </Table>
      </Card>
      <Pagination {...page} basePath="/admin/cupons" searchParams={sp} />
    </>
  );
}
