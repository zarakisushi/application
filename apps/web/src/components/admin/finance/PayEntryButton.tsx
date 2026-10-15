'use client';

import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type FinanceDirection } from '@zaraki/core';
import { Check } from 'lucide-react';
import { useState, useTransition, type FormEvent } from 'react';
import { toast } from 'sonner';
import { payEntryAction } from '@/app/(admin)/admin/(panel)/financeiro/actions';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Field } from '../form';

export type AccountOption = { id: string; name: string };

/** "Pagar"/"Receber": registra data, conta e forma de um lançamento em aberto. */
export function PayEntryButton({
  entry,
  accounts,
  today,
  size = 'sm',
}: {
  entry: { id: string; description: string; direction: FinanceDirection; accountId: string | null; paymentMethod: string | null };
  accounts: AccountOption[];
  today: string;
  size?: 'sm' | 'default';
}) {
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const income = entry.direction === 'ENTRADA';
  const verb = income ? 'Receber' : 'Pagar';

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const r = await payEntryAction(entry.id, form);
      setErrors(r?.fieldErrors ?? {});
      if (r?.ok) {
        toast.success(r.message);
        setOpen(false);
      } else if (r?.error && !r.fieldErrors) toast.error(r.error);
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button size={size} variant="outline" aria-label={`${verb}: ${entry.description}`}>
          <Check /> {verb}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <AlertDialogHeader>
            <AlertDialogTitle>{income ? 'Registrar recebimento' : 'Registrar pagamento'}</AlertDialogTitle>
            <AlertDialogDescription>{entry.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <Field label={income ? 'Recebido em' : 'Pago em'} htmlFor="pay-paidOn" error={errors.paidOn}>
            <Input id="pay-paidOn" name="paidOn" type="date" defaultValue={today} required />
          </Field>
          <Field label="Conta" htmlFor="pay-accountId" error={errors.accountId}>
            <Select name="accountId" defaultValue={entry.accountId ?? accounts[0]?.id}>
              <SelectTrigger id="pay-accountId" className="w-full">
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
          <Field label="Forma de pagamento (opcional)" htmlFor="pay-paymentMethod">
            <Select name="paymentMethod" defaultValue={entry.paymentMethod ?? undefined}>
              <SelectTrigger id="pay-paymentMethod" className="w-full">
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
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={pending}>
              Voltar
            </AlertDialogCancel>
            <Button type="submit" disabled={pending}>
              {pending ? 'Salvando…' : income ? 'Confirmar recebimento' : 'Confirmar pagamento'}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
