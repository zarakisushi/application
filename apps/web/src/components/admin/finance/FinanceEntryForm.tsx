'use client';

import {
  centsToInput,
  DRE_GROUP_LABEL,
  DRE_GROUPS,
  formatCents,
  parseMoneyToCents,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  type DreGroup,
  type FinanceDirection,
} from '@zaraki/core';
import { Paperclip, X } from 'lucide-react';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { compressImage } from '@/lib/image-compress';
import { Field, FormError, useServerForm, type ActionResult } from '../form';
import { formatDay } from './ui';

export type CategoryOption = { id: string; name: string; direction: FinanceDirection; dreGroup: DreGroup; active: boolean };
export type AccountChoice = { id: string; name: string; active: boolean };

export type EntryValues = {
  direction: FinanceDirection;
  description: string;
  amountCents: number;
  categoryId: string | null;
  accountId: string | null;
  competenceDate: string;
  dueDate: string;
  paidOn: string | null;
  paymentMethod: string | null;
  counterparty: string | null;
  notes: string | null;
  attachmentId: string | null;
  seriesId: string | null;
};

type Props = {
  entry?: EntryValues;
  direction?: FinanceDirection;
  categories: CategoryOption[];
  accounts: AccountChoice[];
  counterparties: string[];
  today: string;
  action: (form: FormData) => Promise<ActionResult>;
  upload: (form: FormData) => Promise<ActionResult>;
  readOnly?: boolean;
};

const REPEAT_LABEL = { NAO: 'Não repete', MENSAL: 'Repete todo mês', PARCELADO: 'Parcelado' } as const;

export function FinanceEntryForm({ entry, direction: initialDirection = 'SAIDA', categories, accounts, counterparties, today, action, upload, readOnly }: Props) {
  const { result, pending, onSubmit, errors } = useServerForm(action);
  const [direction, setDirection] = useState<FinanceDirection>(entry?.direction ?? initialDirection);
  const [categoryId, setCategoryId] = useState(entry?.categoryId ?? '');
  const [paid, setPaid] = useState(entry ? !!entry.paidOn : false);
  const [repeat, setRepeat] = useState<keyof typeof REPEAT_LABEL>('NAO');
  const [count, setCount] = useState('2');
  const [amount, setAmount] = useState(entry ? centsToInput(entry.amountCents) : '');
  const [dueDate, setDueDate] = useState(entry?.dueDate ?? today);
  const [attachment, setAttachment] = useState(entry?.attachmentId ?? '');
  const [uploading, startUpload] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const income = direction === 'ENTRADA';

  const options = categories.filter((c) => c.direction === direction && (c.active || c.id === entry?.categoryId));
  const selectable = accounts.filter((a) => a.active || a.id === entry?.accountId);

  const sendFile = (file: File | undefined) => {
    if (!file) return;
    startUpload(async () => {
      const form = new FormData();
      form.set('file', await compressImage(file));
      const r = await upload(form);
      if (r?.id) {
        setAttachment(r.id);
        toast.success(r.message);
      } else if (r?.error) toast.error(r.error);
      if (fileInput.current) fileInput.current.value = '';
    });
  };

  const cents = parseMoneyToCents(amount) ?? 0;
  const n = Math.max(2, Number(count) || 2);
  const summary = cents
    ? [
        `${income ? 'Entrada' : 'Saída'} de ${formatCents(cents)}`,
        options.find((c) => c.id === categoryId)?.name,
        paid ? (income ? 'já recebida' : 'já paga') : `vence em ${formatDay(dueDate)}`,
        repeat === 'MENSAL' && `repete por ${n} meses (${formatCents(cents * n)} no total)`,
        repeat === 'PARCELADO' && `em ${n} parcelas de cerca de ${formatCents(Math.floor(cents / n))}`,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <Card>
        <CardContent className="grid gap-6 pt-6">
          <FormError result={result} />
          <fieldset disabled={readOnly || pending} className="grid gap-6">
            <input type="hidden" name="direction" value={direction} />
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de lançamento">
              {(
                [
                  ['ENTRADA', 'Entrada', 'Dinheiro que entra', 'aria-checked:border-emerald-600 aria-checked:bg-emerald-50 aria-checked:text-emerald-900'],
                  ['SAIDA', 'Saída', 'Dinheiro que sai', 'aria-checked:border-brand-red aria-checked:bg-red-50 aria-checked:text-brand-red'],
                ] as const
              ).map(([value, label, hint, cls]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={direction === value}
                  onClick={() => {
                    setDirection(value);
                    setCategoryId('');
                  }}
                  className={`rounded-lg border p-3 text-left transition-colors ${cls}`}
                >
                  <div className="font-semibold">{label}</div>
                  <div className="text-xs opacity-80">{hint}</div>
                </button>
              ))}
            </div>

            <div className="grid gap-5 sm:grid-cols-[1fr_200px]">
              <Field label="Descrição" htmlFor="description" error={errors.description} hint={income ? 'Ex.: Venda de evento corporativo.' : 'Ex.: Salmão — compra da semana.'}>
                <Input id="description" name="description" defaultValue={entry?.description ?? ''} required aria-invalid={!!errors.description} />
              </Field>
              <Field label="Valor (R$)" htmlFor="amount" error={errors.amount}>
                <Input id="amount" name="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" required aria-invalid={!!errors.amount} />
              </Field>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Categoria" htmlFor="categoryId" error={errors.categoryId}>
                <Select name="categoryId" value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger id="categoryId" className="w-full" aria-invalid={!!errors.categoryId}>
                    <SelectValue placeholder="Escolha a categoria" />
                  </SelectTrigger>
                  <SelectContent>
                    {DRE_GROUPS.map((g) => {
                      const items = options.filter((c) => c.dreGroup === g);
                      if (!items.length) return null;
                      return (
                        <SelectGroup key={g}>
                          <SelectLabel>{DRE_GROUP_LABEL[g]}</SelectLabel>
                          {items.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      );
                    })}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={income ? 'Cliente / origem (opcional)' : 'Fornecedor (opcional)'} htmlFor="counterparty" error={errors.counterparty}>
                <Input id="counterparty" name="counterparty" list="counterparties" defaultValue={entry?.counterparty ?? ''} autoComplete="off" />
                <datalist id="counterparties">
                  {counterparties.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </Field>
              <Field label="Vencimento" htmlFor="dueDate" error={errors.dueDate} hint={income ? 'Quando o dinheiro deve entrar.' : 'Quando a conta deve ser paga.'}>
                <Input id="dueDate" name="dueDate" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
              </Field>
              <Field label="Competência" htmlFor="competenceDate" error={errors.competenceDate} hint="Mês a que se refere (usado na DRE). Ex.: a conta de luz de setembro.">
                <Input id="competenceDate" name="competenceDate" type="date" defaultValue={entry?.competenceDate ?? today} required />
              </Field>
            </div>

            <div className="grid gap-4 rounded-lg border p-4">
              <label className="flex items-center gap-3 text-sm font-medium">
                <Switch name="paid" checked={paid} onCheckedChange={setPaid} />
                {income ? 'Já foi recebido' : 'Já foi pago'}
              </label>
              <div className="grid gap-5 sm:grid-cols-3">
                {paid && (
                  <Field label={income ? 'Recebido em' : 'Pago em'} htmlFor="paidOn" error={errors.paidOn}>
                    <Input id="paidOn" name="paidOn" type="date" defaultValue={entry?.paidOn ?? today} required />
                  </Field>
                )}
                <Field label={paid ? 'Conta' : 'Conta prevista (opcional)'} htmlFor="accountId" error={errors.accountId}>
                  <Select name="accountId" defaultValue={entry?.accountId ?? undefined}>
                    <SelectTrigger id="accountId" className="w-full" aria-invalid={!!errors.accountId}>
                      <SelectValue placeholder="Escolha a conta" />
                    </SelectTrigger>
                    <SelectContent>
                      {selectable.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Forma de pagamento (opcional)" htmlFor="paymentMethod">
                  <Select name="paymentMethod" defaultValue={entry?.paymentMethod ?? undefined}>
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
            </div>

            {!entry && (
              <div className="grid gap-5 sm:grid-cols-[1fr_160px]">
                <Field label="Repetir" htmlFor="repeat" hint="Todo mês: o mesmo valor a cada mês (ex.: aluguel). Parcelado: o valor total dividido em parcelas.">
                  <Select name="repeat" value={repeat} onValueChange={(v) => setRepeat(v as typeof repeat)}>
                    <SelectTrigger id="repeat" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(REPEAT_LABEL).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {repeat !== 'NAO' && (
                  <Field label={repeat === 'MENSAL' ? 'Por quantos meses' : 'Quantas parcelas'} htmlFor="repeatCount" error={errors.repeatCount}>
                    <Input id="repeatCount" name="repeatCount" type="number" min={2} max={60} value={count} onChange={(e) => setCount(e.target.value)} required />
                  </Field>
                )}
              </div>
            )}

            {entry?.seriesId && (
              <fieldset className="grid gap-2 rounded-lg border p-4">
                <legend className="px-1 text-sm font-medium">Este lançamento faz parte de uma série</legend>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="scope" value="ESTE" defaultChecked /> Alterar só este
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="scope" value="PROXIMOS" /> Alterar este e os próximos em aberto (valor, categoria, conta, descrição)
                </label>
              </fieldset>
            )}

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Observação (opcional)" htmlFor="notes" error={errors.notes}>
                <Textarea id="notes" name="notes" defaultValue={entry?.notes ?? ''} rows={3} />
              </Field>
              <div className="grid content-start gap-2">
                <span className="text-sm font-medium">Comprovante (opcional)</span>
                <input type="hidden" name="attachmentId" value={attachment} />
                {attachment ? (
                  <div className="flex items-center gap-2 text-sm">
                    <a href={`/api/financeiro/comprovante/${attachment}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-medium underline">
                      <Paperclip className="size-4" /> Ver comprovante
                    </a>
                    {!readOnly && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setAttachment('')} aria-label="Remover comprovante">
                        <X />
                      </Button>
                    )}
                  </div>
                ) : (
                  <Input
                    ref={fileInput}
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    disabled={uploading || readOnly}
                    onChange={(e) => sendFile(e.target.files?.[0])}
                    aria-label="Enviar comprovante"
                  />
                )}
                <p className="text-xs text-muted-foreground">{uploading ? 'Enviando…' : 'Nota fiscal, boleto ou recibo: PDF ou foto, até 4 MB.'}</p>
              </div>
            </div>
          </fieldset>
          {!readOnly && (
            <div>
              <Button type="submit" disabled={pending || uploading}>
                {pending ? 'Salvando…' : entry ? 'Salvar lançamento' : income ? 'Lançar entrada' : 'Lançar saída'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className={`h-fit ${income ? 'border-emerald-600/40 bg-emerald-50/50' : 'border-brand-red/30 bg-red-50/50'}`}>
        <CardContent className="grid gap-2 pt-6">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Resumo</span>
          <p className="text-sm" data-testid="entry-summary">
            {summary ?? 'Preencha o valor para ver o resumo.'}
          </p>
        </CardContent>
      </Card>
    </form>
  );
}
