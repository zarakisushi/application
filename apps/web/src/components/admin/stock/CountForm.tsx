'use client';

import { STOCK_KIND_LABEL, STOCK_KINDS, formatQty, parseQuantity, roundQty, type StockKind } from '@zaraki/core';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Field, FormError, useServerForm, type ActionResult } from '../form';

type Item = { id: string; name: string; unit: string; kind: StockKind; balance: number };

/** Contagem: informe o que foi contado; só os itens preenchidos entram, e só a diferença vira ajuste. */
export function CountForm({ items, today, action }: { items: Item[]; today: string; action: (form: FormData) => Promise<ActionResult> }) {
  const { result, pending, onSubmit, errors } = useServerForm(action);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const filled = Object.entries(counts).filter(([, v]) => v.trim() !== '');
  const payload = filled.map(([itemId, counted]) => ({ itemId, counted }));

  return (
    <form onSubmit={onSubmit} className="grid gap-6">
      <input type="hidden" name="counts" value={JSON.stringify(payload)} />
      <FormError result={result} />
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">No sistema</TableHead>
              <TableHead className="w-44">Contado</TableHead>
              <TableHead className="text-right">Diferença</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {STOCK_KINDS.flatMap((k) => {
              const group = items.filter((i) => i.kind === k);
              if (!group.length) return [];
              return [
                <TableRow key={k} className="bg-muted/40 hover:bg-muted/40">
                  <TableCell colSpan={4} className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {STOCK_KIND_LABEL[k]}
                  </TableCell>
                </TableRow>,
                ...group.map((i) => {
                  const counted = parseQuantity(counts[i.id] ?? '');
                  const diff = counted === null ? null : roundQty(counted - i.balance);
                  return (
                    <TableRow key={i.id}>
                      <TableCell className="font-medium">{i.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatQty(i.balance, i.unit)}</TableCell>
                      <TableCell>
                        <Input
                          inputMode="decimal"
                          value={counts[i.id] ?? ''}
                          onChange={(e) => setCounts((c) => ({ ...c, [i.id]: e.target.value }))}
                          placeholder={i.unit}
                          aria-label={`Contado: ${i.name}`}
                        />
                      </TableCell>
                      <TableCell className={`text-right tabular-nums ${diff ? (diff < 0 ? 'text-brand-red' : 'text-emerald-700') : 'text-muted-foreground'}`}>
                        {diff === null ? '—' : diff === 0 ? 'confere' : `${diff > 0 ? '+' : '−'} ${formatQty(Math.abs(diff), i.unit)}`}
                      </TableCell>
                    </TableRow>
                  );
                }),
              ];
            })}
          </TableBody>
        </Table>
      </Card>
      <Card>
        <CardContent className="grid gap-5 pt-6 sm:grid-cols-[200px_1fr]">
          <Field label="Data da contagem" htmlFor="occurredOn" error={errors.occurredOn}>
            <Input id="occurredOn" name="occurredOn" type="date" defaultValue={today} max={today} required />
          </Field>
          <Field label="Observação (opcional)" htmlFor="notes" error={errors.notes}>
            <Textarea id="notes" name="notes" rows={2} placeholder="Ex.: contagem de fim de mês" />
          </Field>
          {errors.counts && <p className="text-sm text-destructive sm:col-span-2">{errors.counts}</p>}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={pending || !filled.length}>
              {pending ? 'Registrando…' : `Registrar contagem (${filled.length} ${filled.length === 1 ? 'item' : 'itens'})`}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
