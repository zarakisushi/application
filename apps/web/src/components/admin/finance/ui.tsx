import { entrySituation, entrySituationLabel, FINANCE_ORIGIN_LABEL, formatCents, type FinanceDirection, type FinanceOrigin } from '@zaraki/core';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** Valor com sinal e cor: entrada em verde (+), saída em vermelho (−). `zeroDash` mostra "—" no zero (tabelas). */
export function Money({ cents, direction, className, zeroDash }: { cents: number; direction?: FinanceDirection; className?: string; zeroDash?: boolean }) {
  if (zeroDash && !cents) return <span className="text-muted-foreground/60">—</span>;
  const negative = direction ? direction === 'SAIDA' : cents < 0;
  const abs = Math.abs(cents);
  return (
    <span className={cn('tabular-nums', negative ? 'text-brand-red' : direction ? 'text-emerald-700' : '', className)}>
      {direction ? (negative ? '− ' : '+ ') : cents < 0 ? '− ' : ''}
      {formatCents(abs)}
    </span>
  );
}

const SITUATION_STYLE = {
  PAGO: 'border-emerald-600/30 bg-emerald-50 text-emerald-800',
  VENCIDO: 'border-brand-red/40 bg-red-50 text-brand-red',
  HOJE: 'border-amber-500/40 bg-amber-50 text-amber-800',
  ABERTO: 'border-sky-500/40 bg-sky-50 text-sky-800',
} as const;

export function SituationBadge({ entry, today }: { entry: { paidOn: string | null; dueDate: string; direction: FinanceDirection }; today: string }) {
  const s = entrySituation(entry, today);
  return (
    <Badge variant="outline" className={SITUATION_STYLE[s]}>
      {entrySituationLabel(s, entry.direction)}
    </Badge>
  );
}

export function OriginBadge({ origin }: { origin: FinanceOrigin }) {
  if (origin === 'MANUAL') return null;
  return (
    <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
      {FINANCE_ORIGIN_LABEL[origin]}
    </Badge>
  );
}

/** "AAAA-MM-DD" → "14/10/2026". */
export const formatDay = (date: string | null | undefined) => (date ? date.split('-').reverse().join('/') : '—');
