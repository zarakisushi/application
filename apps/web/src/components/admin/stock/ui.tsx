import { STOCK_SITUATION_LABEL, type StockSituation } from '@zaraki/core';
import { Badge } from '@/components/ui/badge';

const STYLE: Record<StockSituation, string> = {
  OK: 'border-emerald-600/30 bg-emerald-50 text-emerald-800',
  BAIXO: 'border-amber-500/40 bg-amber-50 text-amber-800',
  ZERADO: 'border-brand-red/40 bg-red-50 text-brand-red',
};

export function StockSituationBadge({ situation }: { situation: StockSituation }) {
  return (
    <Badge variant="outline" className={STYLE[situation]}>
      {STOCK_SITUATION_LABEL[situation]}
    </Badge>
  );
}

export type StockItemOption = { id: string; name: string; unit: string; balance: number; avgCostCents: number | null };
