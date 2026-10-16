'use client';

import {
  centsToInput,
  DRE_GROUP_LABEL,
  DRE_GROUPS,
  FINANCE_ACCOUNT_KIND_LABEL,
  FINANCE_ACCOUNT_KINDS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  type DreGroup,
  type FinanceAccountKind,
  type FinanceDirection,
} from '@zaraki/core';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Field, FormError, useServerForm, type ActionResult } from '../form';
import { MoneyInput } from '@/components/ui/money-input';

type Action = (form: FormData) => Promise<ActionResult>;

/** Painel lateral com um formulário; fecha sozinho quando a ação dá certo. */
export function FormSheet({
  trigger,
  title,
  description,
  action,
  submitLabel,
  children,
}: {
  trigger: React.ReactNode;
  title: string;
  description?: string;
  action: Action;
  submitLabel: string;
  children: (errors: Record<string, string>) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { result, pending, onSubmit, errors } = useServerForm(action, { onSuccess: () => setOpen(false) });
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        <form onSubmit={onSubmit} className="grid gap-5 px-4 pb-6">
          <FormError result={result} />
          <fieldset disabled={pending} className="grid gap-5">
            {children(errors)}
          </fieldset>
          <Button type="submit" disabled={pending}>
            {pending ? 'Salvando…' : submitLabel}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export type AccountValues = {
  name: string;
  kind: FinanceAccountKind;
  openingBalanceCents: number;
  openingDate: string;
  receivesMethods: string[];
  active: boolean;
};

export function AccountSheet({ account, action, trigger, today }: { account?: AccountValues; action: Action; trigger: React.ReactNode; today: string }) {
  return (
    <FormSheet
      trigger={trigger}
      title={account ? `Editar ${account.name}` : 'Nova conta'}
      description="Onde o dinheiro da unidade fica: caixa da loja, conta no banco, carteira digital."
      action={action}
      submitLabel={account ? 'Salvar conta' : 'Criar conta'}
    >
      {(errors) => (
        <>
          <Field label="Nome" htmlFor="acc-name" error={errors.name}>
            <Input id="acc-name" name="name" defaultValue={account?.name ?? ''} placeholder="Ex.: Banco do Brasil" required />
          </Field>
          <Field label="Tipo" htmlFor="acc-kind" error={errors.kind}>
            <Select name="kind" defaultValue={account?.kind ?? 'BANCO'}>
              <SelectTrigger id="acc-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FINANCE_ACCOUNT_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {FINANCE_ACCOUNT_KIND_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Saldo inicial (R$)" htmlFor="acc-opening" error={errors.openingBalance} hint="Negativo com “-”.">
              <MoneyInput id="acc-opening" name="openingBalance" allowNegative defaultValue={account ? `${account.openingBalanceCents < 0 ? '-' : ''}${centsToInput(Math.abs(account.openingBalanceCents))}` : ''} placeholder="0,00" />
            </Field>
            <Field label="Na data" htmlFor="acc-openingDate" error={errors.openingDate}>
              <Input id="acc-openingDate" name="openingDate" type="date" defaultValue={account?.openingDate ?? today} required />
            </Field>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Recebe as vendas pagas em</legend>
            {PAYMENT_METHODS.map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm">
                <Checkbox name="receivesMethods" value={m} defaultChecked={account?.receivesMethods.includes(m)} />
                {PAYMENT_METHOD_LABEL[m]}
              </label>
            ))}
            <p className="text-xs text-muted-foreground">Cada forma cai numa conta só: marcar aqui tira das outras contas.</p>
          </fieldset>
          <label className="flex items-center gap-3 text-sm font-medium">
            <Switch name="active" defaultChecked={account?.active ?? true} />
            Conta ativa
          </label>
        </>
      )}
    </FormSheet>
  );
}

export type CategoryValues = { name: string; direction: FinanceDirection; dreGroup: DreGroup; active: boolean; cmv: boolean; systemKey: string | null };

export function CategorySheet({ category, action, trigger }: { category?: CategoryValues; action: Action; trigger: React.ReactNode }) {
  const system = !!category?.systemKey;
  return (
    <FormSheet
      trigger={trigger}
      title={category ? `Editar ${category.name}` : 'Nova categoria'}
      description="O grupo define em que linha da DRE a categoria aparece."
      action={action}
      submitLabel={category ? 'Salvar categoria' : 'Criar categoria'}
    >
      {(errors) => (
        <>
          <Field label="Nome" htmlFor="cat-name" error={errors.name}>
            <Input id="cat-name" name="name" defaultValue={category?.name ?? ''} required />
          </Field>
          <Field label="Tipo" htmlFor="cat-direction" error={errors.direction} hint={system ? 'Categoria usada pelo sistema: o tipo não muda.' : undefined}>
            {system && <input type="hidden" name="direction" value={category!.direction} />}
            <Select name={system ? undefined : 'direction'} defaultValue={category?.direction ?? 'SAIDA'} disabled={system}>
              <SelectTrigger id="cat-direction" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ENTRADA">Entrada</SelectItem>
                <SelectItem value="SAIDA">Saída</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Grupo" htmlFor="cat-group" error={errors.dreGroup}>
            <Select name="dreGroup" defaultValue={category?.dreGroup ?? 'DESPESA_FIXA'}>
              <SelectTrigger id="cat-group" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DRE_GROUPS.map((g) => (
                  <SelectItem key={g} value={g}>
                    {DRE_GROUP_LABEL[g]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <label className="flex items-start gap-3 text-sm">
            <Switch name="cmv" defaultChecked={category?.cmv ?? false} className="mt-0.5" />
            <span>
              <span className="font-medium">Compra de mercadoria (CMV)</span>
              <span className="block text-xs text-muted-foreground">Insumos, bebidas, embalagens: entra no CMV real da Visão geral. Só vale para saídas.</span>
            </span>
          </label>
          {system ? (
            <input type="hidden" name="active" value="on" />
          ) : (
            <label className="flex items-center gap-3 text-sm font-medium">
              <Switch name="active" defaultChecked={category?.active ?? true} />
              Categoria ativa (aparece nos lançamentos)
            </label>
          )}
        </>
      )}
    </FormSheet>
  );
}

export function TransferSheet({ accounts, action, trigger, today }: { accounts: { id: string; name: string }[]; action: Action; trigger: React.ReactNode; today: string }) {
  return (
    <FormSheet
      trigger={trigger}
      title="Transferir entre contas"
      description="Ex.: depósito do dinheiro do caixa no banco. Não conta como entrada nem saída da empresa."
      action={action}
      submitLabel="Registrar transferência"
    >
      {(errors) => (
        <>
          {(
            [
              ['fromAccountId', 'De', accounts[0]?.id],
              ['toAccountId', 'Para', accounts[1]?.id],
            ] as const
          ).map(([name, label, value]) => (
            <Field key={name} label={label} htmlFor={`tr-${name}`} error={errors[name]}>
              <Select name={name} defaultValue={value}>
                <SelectTrigger id={`tr-${name}`} className="w-full">
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
          ))}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Valor (R$)" htmlFor="tr-amount" error={errors.amount}>
              <MoneyInput id="tr-amount" name="amount" placeholder="0,00" required />
            </Field>
            <Field label="Data" htmlFor="tr-date" error={errors.date}>
              <Input id="tr-date" name="date" type="date" defaultValue={today} required />
            </Field>
          </div>
          <Field label="Observação (opcional)" htmlFor="tr-notes" error={errors.notes}>
            <Textarea id="tr-notes" name="notes" rows={2} />
          </Field>
        </>
      )}
    </FormSheet>
  );
}

/** Conferência de saldo: informa o saldo real (extrato ou dinheiro contado) e o sistema lança a diferença. */
export function ReconcileSheet({ account, action, trigger }: { account: { name: string; balanceLabel: string }; action: Action; trigger: React.ReactNode }) {
  return (
    <FormSheet
      trigger={trigger}
      title={`Conferir saldo · ${account.name}`}
      description={`O sistema calcula ${account.balanceLabel}. Informe quanto há de fato (extrato do banco ou dinheiro contado no caixa): a diferença vira um lançamento de ajuste, registrado na auditoria.`}
      action={action}
      submitLabel="Conferir"
    >
      {(errors) => (
        <Field label="Saldo real hoje (R$)" htmlFor="realBalance" error={errors.realBalance} hint="Negativo com “-”.">
          <MoneyInput id="realBalance" name="realBalance" allowNegative placeholder="0,00" required autoFocus />
        </Field>
      )}
    </FormSheet>
  );
}
