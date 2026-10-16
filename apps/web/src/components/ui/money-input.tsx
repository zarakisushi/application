'use client';

import { finishMoneyInput, maskMoneyInput } from '@zaraki/core';
import * as React from 'react';
import { cn } from '@/lib/utils';
import { Input } from './input';

type Props = Omit<React.ComponentProps<'input'>, 'value' | 'defaultValue' | 'onChange' | 'type'> & {
  /** Controlado: valor já mascarado ("1.234,56"). */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Aceita "-" no início (saldo negativo). */
  allowNegative?: boolean;
};

/** Caracteres que contam para reposicionar o cursor depois da máscara (os pontos são inseridos por ela). */
const significant = (s: string) => s.replace(/[^\d,-]/g, '').length;

/**
 * Campo de valor em reais com máscara: "R$" fixo, milhar com ponto inserido sozinho, vírgula para os
 * centavos e as duas casas completadas ao sair do campo. Envia no formulário o texto mascarado, que o
 * servidor converte com `parseMoneyToCents`.
 */
export function MoneyInput({ value, defaultValue = '', onValueChange, allowNegative, className, onBlur, ...props }: Props) {
  const [own, setOwn] = React.useState(() => maskMoneyInput(defaultValue, { allowNegative }));
  const current = value ?? own;
  const ref = React.useRef<HTMLInputElement>(null);
  const caret = React.useRef<number | null>(null);

  const set = (next: string) => {
    if (value === undefined) setOwn(next);
    onValueChange?.(next);
  };

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (el && caret.current !== null && document.activeElement === el) {
      // Mesma quantidade de dígitos antes do cursor que havia no texto digitado.
      let pos = 0;
      for (let seen = 0; pos < current.length && seen < caret.current; pos++) {
        if (/[\d,-]/.test(current[pos]!)) seen++;
      }
      el.setSelectionRange(pos, pos);
    }
    caret.current = null;
  }, [current]);

  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center pb-0.5 text-base text-muted-foreground md:text-sm" aria-hidden="true">
        R$
      </span>
      <Input
        {...props}
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={cn('pl-9 tabular-nums', className)}
        value={current}
        onChange={(e) => {
          const raw = e.target.value;
          caret.current = significant(raw.slice(0, e.target.selectionStart ?? raw.length));
          set(maskMoneyInput(raw, { allowNegative }));
        }}
        onBlur={(e) => {
          set(finishMoneyInput(current));
          onBlur?.(e);
        }}
      />
    </div>
  );
}
