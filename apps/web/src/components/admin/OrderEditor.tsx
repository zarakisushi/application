'use client';

import {
  ADMIN_ORDER_SOURCES,
  ORDER_SOURCE_LABEL,
  ORDER_TYPES,
  ORDER_TYPE_LABEL,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  centsToInput,
  formatCents,
  isScheduled,
  parseMoneyToCents,
  type OrderType,
} from '@zaraki/core';
import { Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Field, FormError, useServerForm, type ActionResult } from './form';

export type EditorProduct = { id: string; name: string; priceCents: number };

export type EditorOrder = {
  type: OrderType;
  date: string;
  time: string;
  guests: number | null;
  neighborhood: string | null;
  address: string | null;
  notes: string | null;
  discountCents: number;
  deliveryFeeCents: number;
  paymentMethod: string | null;
  paid: boolean;
  items: { productId: string; productName: string; unitPriceCents: number; qty: number }[];
};

type Props = {
  mode: 'create' | 'edit';
  defaultType: OrderType;
  /** Cardápio ativo. Itens que já estão no pedido mantêm o preço da época. */
  products: EditorProduct[];
  order?: EditorOrder;
  action: (form: FormData) => Promise<ActionResult>;
};

export function OrderEditor({ mode, defaultType, products, order, action }: Props) {
  const { result, pending, onSubmit, errors } = useServerForm(action);
  const [type, setType] = useState<OrderType>(order?.type ?? defaultType);
  const [qty, setQty] = useState<Record<string, number>>(
    Object.fromEntries((order?.items ?? []).map((i) => [i.productId, i.qty])),
  );
  const [discount, setDiscount] = useState(order?.discountCents ? centsToInput(order.discountCents) : '');
  const [fee, setFee] = useState(order?.deliveryFeeCents ? centsToInput(order.deliveryFeeCents) : '');

  // Produtos do pedido (preço da época) + cardápio ativo (preço atual) para itens novos.
  const lines = new Map<string, EditorProduct>();
  for (const i of order?.items ?? []) lines.set(i.productId, { id: i.productId, name: i.productName, priceCents: i.unitPriceCents });
  for (const p of products) if (!lines.has(p.id)) lines.set(p.id, p);
  const catalog = [...lines.values()];

  const items = catalog.filter((p) => qty[p.id]).map((p) => ({ productId: p.id, qty: qty[p.id]! }));
  const subtotal = catalog.reduce((s, p) => s + p.priceCents * (qty[p.id] ?? 0), 0);
  const total = Math.max(0, subtotal - (parseMoneyToCents(discount) ?? 0) + (parseMoneyToCents(fee) ?? 0));
  const scheduled = isScheduled(type);
  const delivery = type === 'DELIVERY';
  const add = (id: string, d: number) => setQty((s) => ({ ...s, [id]: Math.max(0, (s[id] ?? 0) + d) }));

  return (
    <form onSubmit={onSubmit} className="grid gap-6">
      <FormError result={result} />
      <input type="hidden" name="items" value={JSON.stringify(items)} />
      <input type="hidden" name="type" value={type} />

      {mode === 'create' && (
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Nome do cliente" htmlFor="name" error={errors.name}>
            <Input id="name" name="name" required aria-invalid={!!errors.name} />
          </Field>
          <Field label="WhatsApp do cliente" htmlFor="phone" error={errors.phone} hint="Se já for cliente, o cadastro é reaproveitado.">
            <Input id="phone" name="phone" type="tel" placeholder="(62) 9 0000-0000" required aria-invalid={!!errors.phone} />
          </Field>
          <Field label="Origem" htmlFor="source" error={errors.source}>
            <Select name="source" defaultValue="WHATSAPP">
              <SelectTrigger id="source" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ADMIN_ORDER_SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {ORDER_SOURCE_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Tipo" htmlFor="order-type">
          <Select value={type} onValueChange={(v) => setType(v as OrderType)}>
            <SelectTrigger id="order-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ORDER_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {ORDER_TYPE_LABEL[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {scheduled && (
          <>
            <Field label="Data" htmlFor="date" error={errors.date}>
              <Input id="date" name="date" type="date" defaultValue={order?.date} required aria-invalid={!!errors.date} />
            </Field>
            <Field label="Horário" htmlFor="time" error={errors.time}>
              <Input id="time" name="time" type="time" defaultValue={order?.time} required aria-invalid={!!errors.time} />
            </Field>
          </>
        )}
        {type === 'FESTA' && (
          <Field label="Convidados" htmlFor="guests" error={errors.guests}>
            <Input id="guests" name="guests" type="number" min={1} defaultValue={order?.guests ?? ''} required aria-invalid={!!errors.guests} />
          </Field>
        )}
        <Field label={delivery ? 'Bairro' : 'Bairro (opcional)'} htmlFor="neighborhood" error={errors.neighborhood}>
          <Input id="neighborhood" name="neighborhood" defaultValue={order?.neighborhood ?? ''} required={delivery} aria-invalid={!!errors.neighborhood} />
        </Field>
        <Field label={delivery ? 'Endereço' : 'Endereço (opcional)'} htmlFor="address" error={errors.address} className="sm:col-span-2">
          <Input id="address" name="address" defaultValue={order?.address ?? ''} required={delivery} aria-invalid={!!errors.address} />
        </Field>
      </div>

      <div>
        <div className="mb-2 text-sm font-medium">Sabores (tubos de 10 peças)</div>
        <div className="divide-y rounded-lg border bg-card">
          {catalog.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-2">
              <span className="text-sm">
                {p.name} <span className="text-muted-foreground">· {formatCents(p.priceCents)}</span>
              </span>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="icon" onClick={() => add(p.id, -1)} aria-label={`Remover ${p.name}`}>
                  <Minus />
                </Button>
                <output className="w-6 text-center font-bold">{qty[p.id] ?? 0}</output>
                <Button type="button" size="icon" onClick={() => add(p.id, 1)} aria-label={`Adicionar ${p.name}`}>
                  <Plus />
                </Button>
              </div>
            </div>
          ))}
        </div>
        {errors.items && <p className="mt-2 text-sm text-destructive">{errors.items}</p>}
      </div>

      <div className="grid gap-5 sm:grid-cols-4">
        <Field label="Desconto (R$)" htmlFor="discount" error={errors.discount}>
          <Input id="discount" name="discount" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0,00" />
        </Field>
        <Field label="Taxa de entrega (R$)" htmlFor="deliveryFee" error={errors.deliveryFee}>
          <Input id="deliveryFee" name="deliveryFee" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0,00" />
        </Field>
        <Field label="Pagamento" htmlFor="paymentMethod">
          <Select name="paymentMethod" defaultValue={order?.paymentMethod ?? undefined}>
            <SelectTrigger id="paymentMethod" className="w-full">
              <SelectValue placeholder="Não informado" />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_METHODS.map((m) => (
                <SelectItem key={m} value={m}>
                  {PAYMENT_METHOD_LABEL[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <label className="flex items-center gap-3 self-end pb-2 text-sm font-medium">
          <Switch name="paid" defaultChecked={order?.paid} />
          Pago
        </label>
      </div>

      <Field label="Observações" htmlFor="notes" error={errors.notes}>
        <Textarea id="notes" name="notes" defaultValue={order?.notes ?? ''} rows={3} />
      </Field>

      <Separator />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="text-sm text-muted-foreground">
          {items.reduce((s, i) => s + i.qty, 0)} tubos · subtotal {formatCents(subtotal)}
          <div className="font-display text-xl font-bold text-foreground">Total {formatCents(total)}</div>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Salvando…' : mode === 'create' ? 'Lançar pedido' : 'Salvar alterações'}
        </Button>
      </div>
    </form>
  );
}
