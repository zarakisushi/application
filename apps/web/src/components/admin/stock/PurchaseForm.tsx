'use client';

import { formatCents, formatQty, parseMoneyToCents, parseQuantity, PAYMENT_METHODS, PAYMENT_METHOD_LABEL } from '@zaraki/core';
import { Paperclip, Plus, Trash2, X } from 'lucide-react';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { compressImage } from '@/lib/image-compress';
import { Field, FormError, useServerForm, type ActionResult } from '../form';
import type { StockItemOption } from './ui';

type Line = { key: number; itemId: string; qty: string; total: string };
let seq = 0;
const emptyLine = (): Line => ({ key: ++seq, itemId: '', qty: '', total: '' });

/** Compra: fornecedor, itens (quantidade e valor de cada linha), vencimento/pagamento e nota fiscal. */
export function PurchaseForm({
  items,
  accounts,
  suppliers,
  today,
  action,
  upload,
}: {
  items: StockItemOption[];
  accounts: { id: string; name: string }[];
  suppliers: string[];
  today: string;
  action: (form: FormData) => Promise<ActionResult>;
  upload: (form: FormData) => Promise<ActionResult>;
}) {
  const { result, pending, onSubmit, errors } = useServerForm(action);
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [paid, setPaid] = useState(false);
  const [attachment, setAttachment] = useState('');
  const [uploading, startUpload] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const set = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + (parseMoneyToCents(l.total) ?? 0), 0);
  const payload = lines.filter((l) => l.itemId || l.qty || l.total).map((l) => ({ itemId: l.itemId, qty: l.qty, total: l.total }));

  const sendFile = (file: File | undefined) => {
    if (!file) return;
    startUpload(async () => {
      const form = new FormData();
      form.set('file', await compressImage(file));
      const r = await upload(form);
      if (r?.id) setAttachment(r.id);
      else if (r?.error) toast.error(r.error);
      if (fileInput.current) fileInput.current.value = '';
    });
  };

  return (
    <form onSubmit={onSubmit} className="grid gap-6">
      <input type="hidden" name="lines" value={JSON.stringify(payload)} />
      <input type="hidden" name="attachmentId" value={attachment} />
      <Card>
        <CardContent className="grid gap-5 pt-6">
          <FormError result={result} />
          <fieldset disabled={pending} className="grid gap-5 sm:grid-cols-3">
            <Field label="Fornecedor" htmlFor="supplier" error={errors.supplier}>
              <Input id="supplier" name="supplier" list="purchase-suppliers" autoComplete="off" required placeholder="Ex.: Peixaria Goiás" />
              <datalist id="purchase-suppliers">
                {suppliers.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </Field>
            <Field label="Data da compra" htmlFor="purchasedOn" error={errors.purchasedOn}>
              <Input id="purchasedOn" name="purchasedOn" type="date" defaultValue={today} required />
            </Field>
            <Field label="Vencimento" htmlFor="dueDate" error={errors.dueDate} hint="Quando a conta deve ser paga.">
              <Input id="dueDate" name="dueDate" type="date" defaultValue={today} required />
            </Field>
          </fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-3 pt-6">
          <span className="text-sm font-medium">Itens da compra</span>
          {lines.map((l, i) => {
            const item = items.find((x) => x.id === l.itemId);
            const qty = parseQuantity(l.qty);
            const cents = parseMoneyToCents(l.total);
            return (
              <div key={l.key} className="grid items-end gap-3 rounded-md border p-3 sm:grid-cols-[1fr_140px_160px_auto]" data-testid="purchase-line">
                <Field label={`Item ${i + 1}`} htmlFor={`line-item-${l.key}`}>
                  <Select value={l.itemId} onValueChange={(v) => set(l.key, { itemId: v })}>
                    <SelectTrigger id={`line-item-${l.key}`} className="w-full">
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
                </Field>
                <Field label={`Quantidade${item ? ` (${item.unit})` : ''}`} htmlFor={`line-qty-${l.key}`}>
                  <Input id={`line-qty-${l.key}`} inputMode="decimal" value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} placeholder="0" />
                </Field>
                <Field label="Valor da linha" htmlFor={`line-total-${l.key}`}>
                  <MoneyInput id={`line-total-${l.key}`} value={l.total} onValueChange={(v) => set(l.key, { total: v })} placeholder="0,00" />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={lines.length === 1}
                  onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                  aria-label={`Remover item ${i + 1}`}
                >
                  <Trash2 />
                </Button>
                {item && qty && cents ? (
                  <p className="text-xs text-muted-foreground sm:col-span-4">
                    {formatQty(qty, item.unit)} a {formatCents(Math.round(cents / qty))} por {item.unit}
                  </p>
                ) : null}
              </div>
            );
          })}
          {errors.lines && <p className="text-sm text-destructive">{errors.lines}</p>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button type="button" variant="outline" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
              <Plus /> Adicionar item
            </Button>
            <div className="text-right">
              <div className="text-sm text-muted-foreground">Total da compra</div>
              <div className="font-display text-2xl font-bold tabular-nums" data-testid="purchase-total">
                {formatCents(total)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-5 pt-6">
          <label className="flex items-center gap-3 text-sm font-medium">
            <Switch name="paid" checked={paid} onCheckedChange={setPaid} />
            Já foi paga
          </label>
          {paid && (
            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Pago em" htmlFor="paidOn" error={errors.paidOn}>
                <Input id="paidOn" name="paidOn" type="date" defaultValue={today} required />
              </Field>
              <Field label="Conta" htmlFor="accountId" error={errors.accountId}>
                <Select name="accountId">
                  <SelectTrigger id="accountId" className="w-full">
                    <SelectValue placeholder="Escolha a conta" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Forma de pagamento (opcional)" htmlFor="paymentMethod">
                <Select name="paymentMethod">
                  <SelectTrigger id="paymentMethod" className="w-full">
                    <SelectValue placeholder="Não informada" />
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
            </div>
          )}
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Observação (opcional)" htmlFor="notes" error={errors.notes}>
              <Textarea id="notes" name="notes" rows={2} />
            </Field>
            <div className="grid content-start gap-2">
              <span className="text-sm font-medium">Nota fiscal (opcional)</span>
              {attachment ? (
                <div className="flex items-center gap-2 text-sm">
                  <a href={`/api/financeiro/comprovante/${attachment}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-medium underline">
                    <Paperclip className="size-4" /> Ver nota fiscal
                  </a>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setAttachment('')} aria-label="Remover nota fiscal">
                    <X />
                  </Button>
                </div>
              ) : (
                <Input ref={fileInput} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={uploading} onChange={(e) => sendFile(e.target.files?.[0])} aria-label="Enviar nota fiscal" />
              )}
              <p className="text-xs text-muted-foreground">{uploading ? 'Enviando…' : 'PDF ou foto, guardada junto da conta no Financeiro.'}</p>
            </div>
          </div>
          <div>
            <Button type="submit" disabled={pending || uploading}>
              {pending ? 'Registrando…' : 'Registrar compra'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Ao registrar: os itens entram no estoque (e atualizam o custo médio) e a conta a pagar entra no Financeiro, separada pela categoria de cada item.
          </p>
        </CardContent>
      </Card>
    </form>
  );
}
