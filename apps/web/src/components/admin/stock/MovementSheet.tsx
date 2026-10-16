'use client';

import { MANUAL_MOVEMENT_KINDS, STOCK_MOVEMENT_LABEL, formatQty, type ManualMovementKind } from '@zaraki/core';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FormSheet } from '../finance/FinanceSheets';
import { Field, type ActionResult } from '../form';
import type { StockItemOption } from './ui';

const HINT: Record<ManualMovementKind, string> = {
  PERDA: 'Peixe vencido, arroz que passou do ponto, tubo danificado...',
  CONSUMO: 'Uso da equipe, degustação, amostras.',
  ENTRADA: 'Doação, devolução de fornecedor, item que apareceu.',
};

/** Registrar à mão uma perda, consumo interno ou outra entrada. */
export function MovementSheet({ items, today, action, trigger }: { items: StockItemOption[]; today: string; action: (form: FormData) => Promise<ActionResult>; trigger: React.ReactNode }) {
  const [kind, setKind] = useState<ManualMovementKind>('PERDA');
  const [itemId, setItemId] = useState('');
  const item = items.find((i) => i.id === itemId);
  return (
    <FormSheet trigger={trigger} title="Registrar saída ou entrada" description="As saídas pelos pedidos entregues já baixam sozinhas pela ficha técnica." action={action} submitLabel="Registrar">
      {(errors) => (
        <>
          <Field label="Tipo" htmlFor="mv-kind" error={errors.kind} hint={HINT[kind]}>
            <Select name="kind" value={kind} onValueChange={(v) => setKind(v as ManualMovementKind)}>
              <SelectTrigger id="mv-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MANUAL_MOVEMENT_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {STOCK_MOVEMENT_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Item" htmlFor="mv-item" error={errors.itemId} hint={item ? `Saldo atual: ${formatQty(item.balance, item.unit)}` : undefined}>
            <Select name="itemId" value={itemId} onValueChange={setItemId}>
              <SelectTrigger id="mv-item" className="w-full">
                <SelectValue placeholder="Escolha o item" />
              </SelectTrigger>
              <SelectContent>
                {items.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={`Quantidade${item ? ` (${item.unit})` : ''}`} htmlFor="mv-qty" error={errors.qty}>
              <Input id="mv-qty" name="qty" inputMode="decimal" placeholder="Ex.: 0,5" required />
            </Field>
            <Field label="Data" htmlFor="mv-date" error={errors.occurredOn}>
              <Input id="mv-date" name="occurredOn" type="date" defaultValue={today} max={today} required />
            </Field>
          </div>
          <Field label="Observação (opcional)" htmlFor="mv-notes" error={errors.notes}>
            <Textarea id="mv-notes" name="notes" rows={2} placeholder="Ex.: salmão passou da validade" />
          </Field>
        </>
      )}
    </FormSheet>
  );
}
