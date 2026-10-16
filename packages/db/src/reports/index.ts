import { cardapioReports } from './cardapio';
import { clientesReports } from './clientes';
import { estoqueRedeReports, estoqueReports } from './estoque';
import { financeiroRedeReports, financeiroReports } from './financeiro';
import { operacaoReports } from './operacao';
import { franquiaReports, governancaReports } from './rede';
import type { ReportDefinition } from './types';
import { vendasReports } from './vendas';

export * from './types';
export { productSales } from './cardapio';
export { revenueSeries, salesTotals } from './vendas';

/** Catálogo de relatórios, na ordem de exibição. */
export const REPORTS: ReportDefinition[] = [
  ...vendasReports,
  ...cardapioReports,
  ...clientesReports,
  ...operacaoReports,
  ...financeiroReports,
  ...estoqueReports,
  ...franquiaReports,
  ...financeiroRedeReports,
  ...estoqueRedeReports,
  ...governancaReports,
];

export const findReport = (slug: string) => REPORTS.find((r) => r.slug === slug) ?? null;
