import { STOCK_KIND_LABEL, STOCK_KINDS, formatCents, formatQty, formatUnitCost, todayInZone, type StockKind } from '@zaraki/core';
import { listStockItems, stockSummary, withContext, type StockFilter } from '@zaraki/db';
import { ClipboardCheck, PackageMinus, Plus, ShoppingCart, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ConfirmAction } from '@/components/admin/ConfirmAction';
import { STATUS_FILTER, type ToolbarFilter } from '@/components/admin/filters';
import { ListToolbar } from '@/components/admin/ListToolbar';
import { EmptyRow, param, readListParams } from '@/components/admin/list';
import { PageHeader } from '@/components/admin/PageHeader';
import { MovementSheet } from '@/components/admin/stock/MovementSheet';
import { StockSituationBadge } from '@/components/admin/stock/ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireAdmin } from '@/server/admin';
import { createSuggestedItemsAction, stockMovementAction } from './actions';

export const metadata: Metadata = { title: 'Estoque' };

const FILTERS: Record<StockFilter, string> = { todos: 'Todos os itens', repor: 'Abaixo do mínimo', zerados: 'Sem estoque' };

export default async function StockPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const ctx = await requireAdmin('stock:read');
  const sp = await searchParams;
  const params = readListParams(sp);
  const today = todayInZone(ctx.tenant.timezone);
  const kindParam = param(sp.categoria);
  const kind = kindParam && (STOCK_KINDS as readonly string[]).includes(kindParam) ? (kindParam as StockKind) : undefined;
  const filterParam = param(sp.situacao);
  const filter: StockFilter = filterParam && filterParam in FILTERS ? (filterParam as StockFilter) : 'todos';

  const { page, summary, options } = await withContext(ctx.db, async (tx) => ({
    page: await listStockItems(tx, ctx.tenant.id, { ...params, kind, filter }),
    summary: await stockSummary(tx, ctx.tenant.id, `${today.slice(0, 7)}-01`),
    options: (await listStockItems(tx, ctx.tenant.id, { pageSize: 100_000 })).rows.filter((i) => i.active),
  }));
  const canWrite = ctx.can('stock:write');
  const canManage = ctx.can('stock:manage');

  const filters: ToolbarFilter[] = [
    { name: 'categoria', label: 'Categoria', value: kind ?? 'todas', options: [{ value: 'todas', label: 'Todas as categorias' }, ...STOCK_KINDS.map((k) => ({ value: k, label: STOCK_KIND_LABEL[k] }))] },
    { name: 'situacao', label: 'Nível do estoque', value: filter, options: Object.entries(FILTERS).map(([value, label]) => ({ value, label })) },
    STATUS_FILTER(params.status),
  ];

  return (
    <>
      <PageHeader
        title="Estoque"
        description="Insumos, tubos e embalagens, materiais de marketing e operacionais. Os pedidos entregues baixam sozinhos pela ficha técnica de cada sabor."
        actions={
          <div className="flex flex-wrap gap-2">
            {canManage && (
              <Button asChild>
                <Link href="/admin/estoque/compras/nova">
                  <ShoppingCart /> Registrar compra
                </Link>
              </Button>
            )}
            {canWrite && (
              <MovementSheet
                items={options.map((i) => ({ id: i.id, name: i.name, unit: i.unit, balance: i.balance, avgCostCents: i.avgCostCents }))}
                today={today}
                action={stockMovementAction}
                trigger={
                  <Button variant="outline">
                    <PackageMinus /> Saída ou perda
                  </Button>
                }
              />
            )}
            {canWrite && (
              <Button asChild variant="outline">
                <Link href="/admin/estoque/contagem">
                  <ClipboardCheck /> Contagem
                </Link>
              </Button>
            )}
            <Button asChild variant="outline">
              <Link href="/admin/estoque/compras">Compras</Link>
            </Button>
            {canManage && (
              <Button asChild variant="outline">
                <Link href="/admin/estoque/itens/novo">
                  <Plus /> Novo item
                </Link>
              </Button>
            )}
          </div>
        }
      />

      <section className="mb-4 grid gap-4 sm:grid-cols-3" aria-label="Resumo do estoque">
        {[
          ['Valor em estoque', formatCents(summary.valueCents), `${summary.items} itens ativos`, ''],
          ['Abaixo do mínimo', String(summary.toRestock), 'itens para repor', summary.toRestock ? 'text-amber-700' : 'text-emerald-700'],
          ['Perdas no mês', formatCents(summary.lossesCents), 'perdas e faltas na contagem', summary.lossesCents ? 'text-brand-red' : ''],
        ].map(([label, value, hint, cls]) => (
          <Card key={label} className="gap-2 py-4">
            <CardHeader className="px-4">
              <CardDescription>{label}</CardDescription>
              <CardTitle className={`font-display text-xl tabular-nums ${cls}`} data-testid={`stock-${label}`}>
                {value}
              </CardTitle>
              <span className="text-xs text-muted-foreground">{hint}</span>
            </CardHeader>
          </Card>
        ))}
      </section>

      {!options.length && canManage && (
        <Card className="mb-4 border-brand-gold/60 bg-accent/40">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
            <div>
              <div className="font-medium">Comece com a lista sugerida do Push Pop</div>
              <p className="text-sm text-muted-foreground">Arroz, nori, salmão, camarão, cream cheese, tubos, tampas, adesivos, sacolas, panfletos e mais. Dá para ajustar tudo depois.</p>
            </div>
            <ConfirmAction
              label="Criar lista sugerida"
              icon={<Sparkles />}
              variant="default"
              title="Criar os itens sugeridos?"
              description="Cria os itens mais comuns do Push Pop Sushi, já ligados às categorias do Financeiro. Os saldos começam em zero: registre as compras ou faça uma contagem."
              confirmLabel="Criar itens"
              action={createSuggestedItemsAction}
            />
          </CardContent>
        </Card>
      )}

      <ListToolbar q={params.q} placeholder="Buscar item" filters={filters} />
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
              <TableHead className="text-right">Mínimo</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead className="text-right">Custo médio</TableHead>
              <TableHead className="text-right">Valor em estoque</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.rows.map((i) => (
              <TableRow key={i.id} className={i.status && i.active ? '' : 'opacity-50'}>
                <TableCell className="whitespace-normal">
                  <Link href={`/admin/estoque/itens/${i.id}`} className="font-medium hover:underline">
                    {i.name}
                  </Link>
                  {i.supplier && <div className="text-xs text-muted-foreground">{i.supplier}</div>}
                </TableCell>
                <TableCell className="text-sm">{STOCK_KIND_LABEL[i.kind]}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatQty(i.balance, i.unit)}</TableCell>
                <TableCell className="text-right text-sm text-muted-foreground tabular-nums">{i.minQty ? formatQty(i.minQty, i.unit) : '—'}</TableCell>
                <TableCell>
                  <StockSituationBadge situation={i.situation} />
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">{formatUnitCost(i.avgCostCents, i.unit)}</TableCell>
                <TableCell className="text-right tabular-nums">{i.valueCents === null ? '—' : formatCents(i.valueCents)}</TableCell>
              </TableRow>
            ))}
            {!page.rows.length && <EmptyRow colSpan={7}>Nenhum item neste filtro.</EmptyRow>}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
