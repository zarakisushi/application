'use client';

import { Check, ChevronDown, ExternalLink, History, Network, Truck } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type SupplierOption = {
  name: string;
  /** Categorias e contato (fornecedores cadastrados). */
  detail?: string | null;
  registered: boolean;
  fromNetwork?: boolean;
};

/** Minúsculas e sem acento, para comparar nomes. */
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

/**
 * Campo de fornecedor aberto: aceita qualquer nome, mas ao clicar mostra os fornecedores cadastrados (e os
 * nomes usados em compras anteriores) para escolher. Um nome novo pode ser cadastrado depois.
 */
export function SupplierCombobox({
  id,
  name,
  options,
  canRegister,
  required,
  invalid,
  placeholder = 'Digite ou escolha na lista',
}: {
  id: string;
  name: string;
  options: SupplierOption[];
  canRegister: boolean;
  required?: boolean;
  invalid?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = fold(value);
    return options.filter((o) => !q || fold(o.name).includes(q));
  }, [options, value]);
  const registered = filtered.filter((o) => o.registered);
  const previous = filtered.filter((o) => !o.registered);
  const ordered = [...registered, ...previous];
  const match = options.find((o) => o.registered && fold(o.name) === fold(value));

  const choose = (o: SupplierOption) => {
    setValue(o.name);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, ordered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && open && active >= 0 && ordered[active]) {
      e.preventDefault();
      choose(ordered[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const option = (o: SupplierOption, i: number) => (
    <li
      key={`${o.registered}-${o.name}`}
      id={`${listId}-${i}`}
      role="option"
      aria-selected={i === active}
      // mousedown (e não click) para escolher antes de o campo perder o foco
      onMouseDown={(e) => {
        e.preventDefault();
        choose(o);
      }}
      onMouseEnter={() => setActive(i)}
      className={cn('flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm', i === active && 'bg-muted')}
    >
      {o.registered ? <Truck className="mt-0.5 size-4 shrink-0 text-brand-gold" aria-hidden /> : <History className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 font-medium">
          {o.name}
          {o.fromNetwork && (
            <span className="flex items-center gap-0.5 rounded-full bg-brand-ink px-1.5 text-[0.65rem] text-brand-gold-light">
              <Network className="size-2.5" /> rede
            </span>
          )}
        </span>
        {o.detail && <span className="block truncate text-xs text-muted-foreground">{o.detail}</span>}
      </span>
    </li>
  );

  return (
    <div className="relative">
      <Input
        ref={input}
        id={id}
        name={name}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open && ordered.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        required={required}
        maxLength={120}
        placeholder={placeholder}
        className="pr-8"
      />
      <ChevronDown className="pointer-events-none absolute top-2.5 right-2.5 size-4 text-muted-foreground" aria-hidden />

      {open && ordered.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Fornecedores"
          className="absolute z-30 mt-1 max-h-72 w-full min-w-64 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg"
        >
          {registered.length > 0 && (
            <li role="presentation" className="px-2 pt-1 pb-0.5 text-[0.7rem] font-semibold tracking-wide text-muted-foreground uppercase">
              Fornecedores cadastrados
            </li>
          )}
          {registered.map((o, i) => option(o, i))}
          {previous.length > 0 && (
            <li role="presentation" className="px-2 pt-2 pb-0.5 text-[0.7rem] font-semibold tracking-wide text-muted-foreground uppercase">
              Usados em compras anteriores
            </li>
          )}
          {previous.map((o, i) => option(o, registered.length + i))}
        </ul>
      )}

      {match ? (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-emerald-700">
          <Check className="size-3.5" /> Fornecedor cadastrado{match.detail ? ` · ${match.detail}` : ''}
        </p>
      ) : value.trim().length >= 2 ? (
        <p className="mt-1.5 text-xs text-muted-foreground" data-testid="supplier-not-registered">
          Ainda não cadastrado: a compra fica só com o nome.{' '}
          {canRegister && (
            <a
              href={`/admin/fornecedores/novo?nome=${encodeURIComponent(value.trim())}`}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-0.5 font-medium text-foreground underline"
            >
              Cadastrar depois <ExternalLink className="size-3" />
            </a>
          )}
        </p>
      ) : null}
    </div>
  );
}
