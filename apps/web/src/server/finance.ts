import 'server-only';
import { addMonths, monthRange } from '@zaraki/core';
import { listAccounts, listCategories, listCounterparties, withContext } from '@zaraki/db';
import type { AdminContext } from './admin';

/** Períodos do filtro de lançamentos (pela data do movimento). */
export const PERIODS = {
  mes: 'Este mês',
  'mes-anterior': 'Mês passado',
  'proximo-mes': 'Próximo mês',
  '3-meses': 'Últimos 3 meses',
  ano: 'Este ano',
  tudo: 'Todo o período',
} as const;
export type Period = keyof typeof PERIODS;

export function periodRange(period: Period, today: string): { from?: string; to?: string } {
  switch (period) {
    case 'mes':
      return monthRange(today);
    case 'mes-anterior':
      return monthRange(addMonths(today, -1));
    case 'proximo-mes':
      return monthRange(addMonths(today, 1));
    case '3-meses':
      return { from: monthRange(addMonths(today, -2)).from, to: monthRange(today).to };
    case 'ano':
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    default:
      return {};
  }
}

/** Opções dos formulários do financeiro da unidade ativa. */
export function loadFinanceOptions(ctx: AdminContext) {
  return withContext(ctx.db, async (tx) => ({
    categories: await listCategories(tx, ctx.tenant.id),
    accounts: await listAccounts(tx, ctx.tenant.id),
    counterparties: await listCounterparties(tx, ctx.tenant.id),
  }));
}
