'use client';

import { formatCents, formatUnitCost, parseQuantity, recipeCostCents } from '@zaraki/core';
import { Plus, Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useServerForm, type ActionResult } from '../form';
import type { StockItemOption } from './ui';

type Line = { key: number; itemId: string; qty: string };
let seq = 0;

/**
 * Ficha técnica do sabor: quanto de cada item vai em 1 tubo. Mostra o custo do tubo pelos preços de compra
 * e permite usar esse custo no cadastro do sabor.
 */
export function RecipeEditor({
  initial,
  items,
  currentCostCents,
  action,
  applyCost,
  readOnly,
}: {
  initial: { itemId: string; qty: number }[];
  items: StockItemOption[];
  currentCostCents: number;
  action: (form: FormData) => Promise<ActionResult>;
  applyCost: () => Promise<ActionResult>;
  readOnly?: boolean;
}) {
  const [lines, setLines] = useState<Line[]>(() =>
    initial.length ? initial.map((l) => ({ key: ++seq, itemId: l.itemId, qty: String(l.qty).replace('.', ',') })) : [{ key: ++seq, itemId: '', qty: '' }],
  );
  const { pending, onSubmit, errors, result } = useServerForm(action);
  const [applying, startApply] = useTransition();
  const set = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const valid = lines.filter((l) => l.itemId && parseQuantity(l.qty));
  const cost = recipeCostCents(valid.map((l) => ({ qty: parseQuantity(l.qty)!, unitCostCents: items.find((i) => i.id === l.itemId)?.avgCostCents ?? null })));
  const payload = lines.filter((l) => l.itemId || l.qty).map((l) => ({ itemId: l.itemId, qty: l.qty }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ficha técnica (1 tubo)</CardTitle>
        <CardDescription>
          Quanto de cada item vai em um tubo. Quando um pedido é entregue, o estoque baixa sozinho por esta ficha; se o pedido for cancelado, volta.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-3">
          <input type="hidden" name="lines" value={JSON.stringify(payload)} />
          {!items.length && <p className="text-sm text-muted-foreground">Cadastre os itens em Estoque para montar a ficha.</p>}
          {lines.map((l, i) => {
            const item = items.find((x) => x.id === l.itemId);
            const qty = parseQuantity(l.qty);
            return (
              <div key={l.key} className="grid items-center gap-2 sm:grid-cols-[1fr_130px_160px_auto]" data-testid="recipe-line">
                <Select value={l.itemId} onValueChange={(v) => set(l.key, { itemId: v })} disabled={readOnly}>
                  <SelectTrigger className="w-full" aria-label={`Item ${i + 1} da ficha`}>
                    <SelectValue placeholder="Escolha o item" />
                  </SelectTrigger>
                  <SelectContent>
                    {items.map((x) => (
                      <SelectItem key={x.id} value={x.id}>
                        {x.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="relative">
                  <Input
                    inputMode="decimal"
                    value={l.qty}
                    onChange={(e) => set(l.key, { qty: e.target.value })}
                    placeholder="0"
                    disabled={readOnly}
                    aria-label={`Quantidade do item ${i + 1} por tubo`}
                    className="pr-12"
                  />
                  {item && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">{item.unit}</span>}
                </div>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {item && qty ? (item.avgCostCents === null ? 'sem custo ainda' : formatCents(Math.round(qty * item.avgCostCents))) : ''}
                  {item && item.avgCostCents !== null && <span className="block text-xs">{formatUnitCost(item.avgCostCents, item.unit)}</span>}
                </span>
                {!readOnly && (
                  <Button type="button" variant="ghost" size="icon" onClick={() => setLines((ls) => (ls.length === 1 ? [{ key: ++seq, itemId: '', qty: '' }] : ls.filter((x) => x.key !== l.key)))} aria-label={`Remover item ${i + 1} da ficha`}>
                    <Trash2 />
                  </Button>
                )}
              </div>
            );
          })}
          {(errors.lines || (result?.error && !result.fieldErrors)) && <p className="text-sm text-destructive">{errors.lines ?? result?.error}</p>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            {!readOnly && (
              <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, { key: ++seq, itemId: '', qty: '' }])}>
                <Plus /> Adicionar item
              </Button>
            )}
            <div className="text-right text-sm">
              <div>
                Custo pela ficha: <strong className="tabular-nums" data-testid="recipe-cost">{formatCents(cost.cents)}</strong> por tubo
              </div>
              <div className="text-xs text-muted-foreground">
                Custo no cadastro do sabor: {formatCents(currentCostCents)}
                {cost.missing > 0 && ` · ${cost.missing} item(ns) sem custo de compra ainda`}
              </div>
            </div>
          </div>
          {!readOnly && (
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={pending}>
                {pending ? 'Salvando…' : 'Salvar ficha técnica'}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={applying || !initial.length || cost.missing > 0}
                onClick={() =>
                  startApply(async () => {
                    const r = await applyCost();
                    if (r?.error) toast.error(r.error);
                    else toast.success(r?.message);
                  })
                }
              >
                Usar o custo da ficha no sabor
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
