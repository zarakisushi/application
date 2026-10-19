'use client';

import {
  BR_STATES,
  centsToInput,
  formatBrPhone,
  formatCep,
  formatDocument,
  SUPPLIER_CATEGORIES,
  SUPPLIER_CATEGORY_LABEL,
  SUPPLIER_PAYMENT_LABEL,
  SUPPLIER_PAYMENT_METHODS,
  WEEKDAY_SHORT,
} from '@zaraki/core';
import { Star } from 'lucide-react';
import { useState } from 'react';
import { Field, FormError, useServerForm, type ActionResult } from '@/components/admin/form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export type SupplierValues = {
  personKind: string;
  name: string;
  legalName: string | null;
  document: string | null;
  stateRegistration: string | null;
  categories: string[];
  contactName: string | null;
  whatsapp: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  cep: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  deliveryDays: number[];
  minOrderCents: number;
  paymentTerms: string | null;
  paymentMethods: string[];
  pixKey: string | null;
  bankDetails: string | null;
  rating: number | null;
  notes: string | null;
  networkShared: boolean;
};

/** Máscara de CNPJ/CPF enquanto digita. */
function maskDocument(value: string, kind: string) {
  const d = value.replace(/\D/g, '').slice(0, kind === 'PF' ? 11 : 14);
  if (kind === 'PF') return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1-$2');
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

/** Seleção múltipla em "chips" (envia "A,B,C" num campo escondido). */
function Chips<T extends string | number>({
  name,
  options,
  value,
  onChange,
  label,
  disabled,
}: {
  name: string;
  options: { value: T; label: string }[];
  value: T[];
  onChange: (v: T[]) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      <input type="hidden" name={name} value={value.join(',')} />
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm transition-colors disabled:opacity-60',
              on ? 'border-brand-ink bg-brand-ink text-[#f4efe6]' : 'bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="grid items-start gap-5 sm:grid-cols-2">{children}</CardContent>
    </Card>
  );
}

export function SupplierForm({
  supplier,
  action,
  readOnly = false,
  canShare = false,
  defaultName,
}: {
  supplier?: SupplierValues;
  /** Nome sugerido para um cadastro novo (ex.: vindo de uma compra). */
  defaultName?: string;
  action: (form: FormData) => Promise<ActionResult>;
  readOnly?: boolean;
  /** Matriz: pode compartilhar o fornecedor com as franquias. */
  canShare?: boolean;
}) {
  const { result, pending, onSubmit, errors } = useServerForm(action);
  const [kind, setKind] = useState(supplier?.personKind ?? 'PJ');
  const [document, setDocument] = useState(supplier?.document ? formatDocument(supplier.document) : '');
  const [categories, setCategories] = useState<string[]>(supplier?.categories ?? []);
  const [days, setDays] = useState<number[]>(supplier?.deliveryDays ?? []);
  const [methods, setMethods] = useState<string[]>(supplier?.paymentMethods ?? []);
  const [rating, setRating] = useState<number | null>(supplier?.rating ?? null);
  const [shared, setShared] = useState(supplier?.networkShared ?? false);
  const [state, setState] = useState(supplier?.state ?? '');
  const off = readOnly || pending;
  const v = supplier;

  return (
    <form onSubmit={onSubmit} className="grid gap-6" aria-label="Cadastro do fornecedor">
      <FormError result={result} />
      <fieldset disabled={off} className="grid gap-6">
        <Section title="Identificação">
          <Field label="Nome do fornecedor" htmlFor="name" error={errors.name} hint="Como a equipe conhece (nome fantasia).">
            <Input id="name" name="name" defaultValue={v?.name ?? defaultName} required maxLength={120} aria-invalid={!!errors.name} />
          </Field>
          <Field label="Razão social (opcional)" htmlFor="legalName" error={errors.legalName}>
            <Input id="legalName" name="legalName" defaultValue={v?.legalName ?? ''} maxLength={160} />
          </Field>
          <Field label="Tipo" htmlFor="personKind">
            <input type="hidden" name="personKind" value={kind} />
            <Select
              value={kind}
              onValueChange={(k) => {
                setKind(k);
                setDocument((d) => maskDocument(d, k));
              }}
              disabled={off}
            >
              <SelectTrigger id="personKind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PJ">Empresa (CNPJ)</SelectItem>
                <SelectItem value="PF">Pessoa física (CPF)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={kind === 'PF' ? 'CPF (opcional)' : 'CNPJ (opcional)'} htmlFor="document" error={errors.document}>
            <Input
              id="document"
              name="document"
              inputMode="numeric"
              value={document}
              onChange={(e) => setDocument(maskDocument(e.target.value, kind))}
              placeholder={kind === 'PF' ? '000.000.000-00' : '00.000.000/0000-00'}
              aria-invalid={!!errors.document}
            />
          </Field>
          <Field label="Inscrição estadual (opcional)" htmlFor="stateRegistration">
            <Input id="stateRegistration" name="stateRegistration" defaultValue={v?.stateRegistration ?? ''} maxLength={30} />
          </Field>
          <Field label="Avaliação" htmlFor="rating">
            <input type="hidden" name="rating" value={rating ?? ''} />
            <div id="rating" role="radiogroup" aria-label="Avaliação" className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={rating === n}
                  aria-label={`${n} ${n === 1 ? 'estrela' : 'estrelas'}`}
                  disabled={off}
                  onClick={() => setRating(rating === n ? null : n)}
                  className="rounded p-0.5"
                >
                  <Star className={cn('size-6', rating && n <= rating ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground/40')} />
                </button>
              ))}
              {rating && <span className="ml-2 text-sm text-muted-foreground">{rating} de 5</span>}
            </div>
          </Field>
          <Field label="Categorias" htmlFor="categories" error={errors.categories} className="sm:col-span-2">
            <Chips
              name="categories"
              label="Categorias"
              value={categories}
              onChange={setCategories}
              disabled={off}
              options={SUPPLIER_CATEGORIES.map((c) => ({ value: c, label: SUPPLIER_CATEGORY_LABEL[c] }))}
            />
          </Field>
        </Section>

        <Section title="Contato" description="Informe ao menos um: WhatsApp, telefone ou e-mail.">
          <Field label="Nome do contato (vendedor)" htmlFor="contactName">
            <Input id="contactName" name="contactName" defaultValue={v?.contactName ?? ''} maxLength={80} />
          </Field>
          <Field label="WhatsApp" htmlFor="whatsapp" error={errors.whatsapp}>
            <Input
              id="whatsapp"
              name="whatsapp"
              inputMode="tel"
              placeholder="(62) 98109-2799"
              defaultValue={v?.whatsapp ? formatBrPhone(v.whatsapp) : ''}
              aria-invalid={!!errors.whatsapp}
            />
          </Field>
          <Field label="Telefone (opcional)" htmlFor="phone" error={errors.phone}>
            <Input id="phone" name="phone" inputMode="tel" placeholder="(62) 3241-0000" defaultValue={v?.phone ? formatBrPhone(v.phone) : ''} aria-invalid={!!errors.phone} />
          </Field>
          <Field label="E-mail (opcional)" htmlFor="email" error={errors.email}>
            <Input id="email" name="email" type="email" defaultValue={v?.email ?? ''} aria-invalid={!!errors.email} />
          </Field>
          <Field label="Site ou Instagram (opcional)" htmlFor="website" className="sm:col-span-2">
            <Input id="website" name="website" defaultValue={v?.website ?? ''} placeholder="@fornecedor ou www.fornecedor.com.br" maxLength={200} />
          </Field>
        </Section>

        <Section title="Endereço">
          <Field label="CEP" htmlFor="cep" error={errors.cep}>
            <Input id="cep" name="cep" inputMode="numeric" defaultValue={formatCep(v?.cep)} placeholder="74000-000" aria-invalid={!!errors.cep} />
          </Field>
          <Field label="Logradouro" htmlFor="street">
            <Input id="street" name="street" defaultValue={v?.street ?? ''} maxLength={160} />
          </Field>
          <div className="grid grid-cols-2 gap-5">
            <Field label="Número" htmlFor="number">
              <Input id="number" name="number" defaultValue={v?.number ?? ''} maxLength={20} />
            </Field>
            <Field label="Complemento" htmlFor="complement">
              <Input id="complement" name="complement" defaultValue={v?.complement ?? ''} maxLength={80} />
            </Field>
          </div>
          <Field label="Bairro" htmlFor="district">
            <Input id="district" name="district" defaultValue={v?.district ?? ''} maxLength={80} />
          </Field>
          <Field label="Cidade" htmlFor="city">
            <Input id="city" name="city" defaultValue={v?.city ?? ''} maxLength={80} />
          </Field>
          <Field label="UF" htmlFor="state" error={errors.state}>
            <input type="hidden" name="state" value={state} />
            <Select value={state || 'none'} onValueChange={(s) => setState(s === 'none' ? '' : s)} disabled={off}>
              <SelectTrigger id="state" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {BR_STATES.map((uf) => (
                  <SelectItem key={uf} value={uf}>
                    {uf}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </Section>

        <Section title="Comercial">
          <Field label="Dias de entrega" htmlFor="deliveryDays" className="sm:col-span-2">
            <Chips
              name="deliveryDays"
              label="Dias de entrega"
              value={days}
              onChange={(d) => setDays([...d].sort())}
              disabled={off}
              options={WEEKDAY_SHORT.map((label, i) => ({ value: i, label }))}
            />
          </Field>
          <Field label="Pedido mínimo (R$)" htmlFor="minOrder" error={errors.minOrder}>
            <MoneyInput id="minOrder" name="minOrder" defaultValue={v?.minOrderCents ? centsToInput(v.minOrderCents) : ''} placeholder="0,00" />
          </Field>
          <Field label="Prazo de pagamento" htmlFor="paymentTerms" hint="Ex.: à vista, 14 dias, 28 dias.">
            <Input id="paymentTerms" name="paymentTerms" defaultValue={v?.paymentTerms ?? ''} maxLength={80} />
          </Field>
          <Field label="Formas de pagamento" htmlFor="paymentMethods" className="sm:col-span-2">
            <Chips
              name="paymentMethods"
              label="Formas de pagamento"
              value={methods}
              onChange={setMethods}
              disabled={off}
              options={SUPPLIER_PAYMENT_METHODS.map((m) => ({ value: m, label: SUPPLIER_PAYMENT_LABEL[m] }))}
            />
          </Field>
          <Field label="Chave Pix (opcional)" htmlFor="pixKey">
            <Input id="pixKey" name="pixKey" defaultValue={v?.pixKey ?? ''} maxLength={120} />
          </Field>
          <Field label="Dados bancários (opcional)" htmlFor="bankDetails" hint="Banco, agência e conta.">
            <Input id="bankDetails" name="bankDetails" defaultValue={v?.bankDetails ?? ''} maxLength={300} />
          </Field>
        </Section>

        <Card>
          <CardContent className="grid gap-5 pt-6">
            <Field label="Observações" htmlFor="notes">
              <Textarea id="notes" name="notes" rows={4} defaultValue={v?.notes ?? ''} maxLength={2000} placeholder="Horário de pedido, produtos que costuma ter, combinados..." />
            </Field>
            {canShare && (
              <label className="flex items-start gap-3">
                <input type="hidden" name="networkShared" value={shared ? 'on' : ''} />
                <Switch checked={shared} onCheckedChange={setShared} disabled={off} aria-label="Compartilhar com as franquias" />
                <span className="text-sm">
                  <span className="font-medium">Compartilhar com as franquias</span>
                  <span className="block text-muted-foreground">
                    Aparece como "fornecedor da rede" para todas as unidades, só para consulta. Elas podem copiar para o próprio cadastro.
                  </span>
                </span>
              </label>
            )}
          </CardContent>
        </Card>
      </fieldset>
      {!readOnly && (
        <div>
          <Button type="submit" disabled={pending} size="lg">
            {pending ? 'Salvando…' : 'Salvar fornecedor'}
          </Button>
        </div>
      )}
    </form>
  );
}
