'use client';

import { formatBrPhone } from '@zaraki/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field, FormError, useServerForm, type ActionResult } from './form';

type Customer = {
  name: string;
  phone: string;
  email: string | null;
  birthday: string | null;
  neighborhood: string | null;
  address: string | null;
  notes: string | null;
};

export function CustomerForm({
  customer,
  action,
  readOnly,
}: {
  customer?: Customer;
  action: (form: FormData) => Promise<ActionResult>;
  readOnly?: boolean;
}) {
  const { result, pending, onSubmit, errors } = useServerForm(action);
  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={onSubmit} className="grid gap-5">
          <FormError result={result} />
          <fieldset disabled={readOnly || pending} className="grid gap-5 sm:grid-cols-2">
            <Field label="Nome" htmlFor="name" error={errors.name}>
              <Input id="name" name="name" defaultValue={customer?.name} required aria-invalid={!!errors.name} />
            </Field>
            <Field label="WhatsApp" htmlFor="phone" error={errors.phone}>
              <Input
                id="phone"
                name="phone"
                type="tel"
                defaultValue={customer ? formatBrPhone(customer.phone) : ''}
                placeholder="(62) 9 0000-0000"
                required
                aria-invalid={!!errors.phone}
              />
            </Field>
            <Field label="E-mail" htmlFor="email" error={errors.email}>
              <Input id="email" name="email" type="email" defaultValue={customer?.email ?? ''} />
            </Field>
            <Field label="Aniversário" htmlFor="birthday" error={errors.birthday} hint="Usado no relatório de aniversariantes.">
              <Input id="birthday" name="birthday" type="date" defaultValue={customer?.birthday ?? ''} />
            </Field>
            <Field label="Bairro" htmlFor="neighborhood" error={errors.neighborhood}>
              <Input id="neighborhood" name="neighborhood" defaultValue={customer?.neighborhood ?? ''} />
            </Field>
            <Field label="Endereço" htmlFor="address" error={errors.address}>
              <Input id="address" name="address" defaultValue={customer?.address ?? ''} />
            </Field>
            <Field label="Observações" htmlFor="notes" error={errors.notes} className="sm:col-span-2">
              <Textarea id="notes" name="notes" defaultValue={customer?.notes ?? ''} rows={3} placeholder="Preferências, alergias, ponto de referência…" />
            </Field>
          </fieldset>
          {!readOnly && (
            <div>
              <Button type="submit" disabled={pending}>
                {pending ? 'Salvando…' : 'Salvar cliente'}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
