'use client';

import { formatBrPhone, slugify } from '@zaraki/core';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field, FormError, useServerForm, type ActionResult } from './form';

type Tenant = {
  name: string;
  slug: string;
  cnpj: string | null;
  city: string | null;
  whatsappNumber: string | null;
  calendarId: string | null;
  domain: string | null;
  royaltyPct: string;
  orderCodePrefix: string;
};

export function TenantForm({
  tenant,
  action,
  readOnly,
}: {
  tenant?: Tenant;
  action: (form: FormData) => Promise<ActionResult>;
  readOnly?: boolean;
}) {
  const { result, pending, onSubmit, errors } = useServerForm(action);
  const [slug, setSlug] = useState(tenant?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(!!tenant);

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={onSubmit} className="grid gap-5">
          <FormError result={result} />
          <fieldset disabled={readOnly || pending} className="grid gap-5 sm:grid-cols-2">
            <Field label="Nome da unidade" htmlFor="name" error={errors.name}>
              <Input
                id="name"
                name="name"
                defaultValue={tenant?.name}
                onChange={(e) => !slugTouched && setSlug(slugify(e.target.value.replace(/zaraki( sushi)?/i, '')))}
                placeholder="Zaraki Sushi — Setor Bueno"
                required
                aria-invalid={!!errors.name}
              />
            </Field>
            <Field label="Identificador" htmlFor="slug" error={errors.slug} hint="Usado em endereços e integrações (ex.: setor-bueno).">
              <Input
                id="slug"
                name="slug"
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                }}
                required
                aria-invalid={!!errors.slug}
              />
            </Field>
            <Field label="CNPJ" htmlFor="cnpj" error={errors.cnpj}>
              <Input id="cnpj" name="cnpj" defaultValue={tenant?.cnpj ?? ''} placeholder="00.000.000/0000-00" />
            </Field>
            <Field label="Cidade" htmlFor="city" error={errors.city}>
              <Input id="city" name="city" defaultValue={tenant?.city ?? ''} />
            </Field>
            <Field label="WhatsApp de pedidos" htmlFor="whatsappNumber" error={errors.whatsappNumber} hint="Vazio = usa o número padrão configurado no servidor.">
              <Input id="whatsappNumber" name="whatsappNumber" type="tel" defaultValue={tenant?.whatsappNumber ? formatBrPhone(tenant.whatsappNumber) : ''} />
            </Field>
            <Field label="Google Agenda (e-mail)" htmlFor="calendarId" error={errors.calendarId} hint="Vazio = usa a agenda padrão da rede.">
              <Input id="calendarId" name="calendarId" type="email" defaultValue={tenant?.calendarId ?? ''} />
            </Field>
            <Field label="Prefixo dos pedidos" htmlFor="orderCodePrefix" error={errors.orderCodePrefix} hint="Ex.: ZK → ZK-000123">
              <Input id="orderCodePrefix" name="orderCodePrefix" defaultValue={tenant?.orderCodePrefix ?? 'ZK'} maxLength={4} required />
            </Field>
            <Field label="Royalties (%)" htmlFor="royaltyPct" error={errors.royaltyPct} hint="Percentual sobre o faturamento (relatório de franquia).">
              <Input id="royaltyPct" name="royaltyPct" inputMode="decimal" defaultValue={tenant?.royaltyPct?.replace('.', ',') ?? '0'} />
            </Field>
            <Field label="Domínio próprio" htmlFor="domain" error={errors.domain} hint="Opcional, para o site da unidade no futuro." className="sm:col-span-2">
              <Input id="domain" name="domain" defaultValue={tenant?.domain ?? ''} placeholder="bueno.zarakisushi.com.br" />
            </Field>
          </fieldset>
          {!readOnly && (
            <div>
              <Button type="submit" disabled={pending}>
                {pending ? 'Salvando…' : tenant ? 'Salvar unidade' : 'Criar unidade'}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
