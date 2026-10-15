'use client';

import {
  centsToInput,
  couponSchema,
  describeCoupon,
  formatBrPhone,
  generateCouponCode,
  type CouponKind,
} from '@zaraki/core';
import { Shuffle } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Field, FormError, useServerForm, type ActionResult } from './form';

type Coupon = {
  code: string;
  description: string | null;
  kind: CouponKind;
  percentOff: string | null;
  amountOffCents: number | null;
  minTubes: number | null;
  minSubtotalCents: number | null;
  startsAt: string | null;
  endsAt: string | null;
  maxUses: number | null;
  phone: string | null;
  active: boolean;
};

/** Valores atuais do formulário → texto "como este cupom funciona". */
function preview(form: HTMLFormElement | null) {
  if (!form) return null;
  const data = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
  const parsed = couponSchema.safeParse({ ...data, code: data.code || 'PREVIA' });
  return parsed.success ? describeCoupon(parsed.data) : null;
}

export function CouponForm({ coupon, action, readOnly }: { coupon?: Coupon; action: (form: FormData) => Promise<ActionResult>; readOnly?: boolean }) {
  const { result, pending, onSubmit, errors } = useServerForm(action);
  const form = useRef<HTMLFormElement>(null);
  const [kind, setKind] = useState<CouponKind>(coupon?.kind ?? 'PERCENT');
  const [exclusive, setExclusive] = useState(!!coupon?.phone);
  const [code, setCode] = useState(coupon?.code ?? '');
  const [summary, setSummary] = useState<string | null>(coupon ? describeCoupon(coupon) : null);
  const refresh = () => setTimeout(() => setSummary(preview(form.current)));

  return (
    <form ref={form} onSubmit={onSubmit} onChange={refresh} className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardContent className="grid gap-6 pt-6">
          <FormError result={result} />
          <fieldset disabled={readOnly || pending} className="grid gap-6">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Código" htmlFor="code" error={errors.code} hint="O cliente digita este código. Letras, números e hífen.">
                <div className="flex gap-2">
                  <Input
                    id="code"
                    name="code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    className="font-mono uppercase"
                    required
                    aria-invalid={!!errors.code}
                  />
                  <Button type="button" variant="outline" onClick={() => (setCode(generateCouponCode()), refresh())} aria-label="Gerar código aleatório">
                    <Shuffle /> Gerar
                  </Button>
                </div>
              </Field>
              <Field label="Descrição interna (opcional)" htmlFor="description" error={errors.description} hint="Ex.: Campanha Dia dos Pais.">
                <Input id="description" name="description" defaultValue={coupon?.description ?? ''} />
              </Field>
            </div>

            <div className="grid gap-3">
              <span className="text-sm font-medium">Tipo de desconto</span>
              <input type="hidden" name="kind" value={kind} />
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Tipo de desconto">
                {(
                  [
                    ['PERCENT', 'Porcentagem', 'Ex.: 10% de desconto nos produtos'],
                    ['FIXED', 'Valor em reais', 'Ex.: R$ 20,00 de desconto'],
                  ] as const
                ).map(([value, label, hint]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={kind === value}
                    onClick={() => (setKind(value), refresh())}
                    className="rounded-lg border p-3 text-left transition-colors aria-checked:border-brand-gold aria-checked:bg-accent"
                  >
                    <div className="font-medium">{label}</div>
                    <div className="text-xs text-muted-foreground">{hint}</div>
                  </button>
                ))}
              </div>
              {kind === 'PERCENT' ? (
                <Field label="Desconto (%)" htmlFor="percentOff" error={errors.percentOff} className="sm:w-48">
                  <Input id="percentOff" name="percentOff" inputMode="decimal" defaultValue={coupon?.percentOff?.replace('.', ',').replace(/,00$/, '') ?? ''} required aria-invalid={!!errors.percentOff} />
                </Field>
              ) : (
                <Field label="Desconto (R$)" htmlFor="amountOff" error={errors.amountOff} className="sm:w-48">
                  <Input id="amountOff" name="amountOff" inputMode="decimal" defaultValue={coupon?.amountOffCents ? centsToInput(coupon.amountOffCents) : ''} required aria-invalid={!!errors.amountOff} />
                </Field>
              )}
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Pedido mínimo em tubos (opcional)" htmlFor="minTubes" error={errors.minTubes} hint="Vale a partir desta quantidade de tubos.">
                <Input id="minTubes" name="minTubes" type="number" min={1} defaultValue={coupon?.minTubes ?? ''} />
              </Field>
              <Field label="Pedido mínimo em R$ (opcional)" htmlFor="minSubtotal" error={errors.minSubtotal} hint="Vale a partir deste valor em produtos.">
                <Input id="minSubtotal" name="minSubtotal" inputMode="decimal" defaultValue={coupon?.minSubtotalCents ? centsToInput(coupon.minSubtotalCents) : ''} />
              </Field>
              <Field label="Válido a partir de (opcional)" htmlFor="startsAt" error={errors.startsAt}>
                <Input id="startsAt" name="startsAt" type="date" defaultValue={coupon?.startsAt ?? ''} />
              </Field>
              <Field label="Válido até (opcional)" htmlFor="endsAt" error={errors.endsAt}>
                <Input id="endsAt" name="endsAt" type="date" defaultValue={coupon?.endsAt ?? ''} />
              </Field>
            </div>

            <div className="grid gap-4 rounded-lg border p-4">
              <label className="flex items-center gap-3 text-sm font-medium">
                <Switch name="exclusive" checked={exclusive} onCheckedChange={(v) => (setExclusive(v), refresh())} />
                Exclusivo para um cliente (uso único)
              </label>
              {exclusive ? (
                <Field label="WhatsApp do cliente" htmlFor="phone" error={errors.phone} hint="Só este número consegue usar o cupom, uma única vez.">
                  <Input id="phone" name="phone" type="tel" defaultValue={coupon?.phone ? formatBrPhone(coupon.phone) : ''} placeholder="(62) 9 0000-0000" required aria-invalid={!!errors.phone} />
                </Field>
              ) : (
                <Field label="Limite de usos (opcional)" htmlFor="maxUses" error={errors.maxUses} hint="Atingido o limite, o cupom deixa de valer. Pedido cancelado devolve o uso.">
                  <Input id="maxUses" name="maxUses" type="number" min={1} defaultValue={coupon?.maxUses ?? ''} className="sm:w-48" />
                </Field>
              )}
            </div>

            <label className="flex items-center gap-3 text-sm font-medium">
              <Switch name="active" defaultChecked={coupon?.active ?? true} />
              Cupom ativo (pode ser usado agora)
            </label>
          </fieldset>
          {!readOnly && (
            <div>
              <Button type="submit" disabled={pending}>
                {pending ? 'Salvando…' : coupon ? 'Salvar cupom' : 'Criar cupom'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="h-fit border-brand-gold/60 bg-accent/40">
        <CardContent className="grid gap-2 pt-6">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Como este cupom funciona</span>
          <div className="font-mono text-lg font-bold">{code || '—'}</div>
          <p className="text-sm" data-testid="coupon-summary">
            {summary ?? 'Preencha o tipo e o valor do desconto para ver o resumo.'}
          </p>
        </CardContent>
      </Card>
    </form>
  );
}
