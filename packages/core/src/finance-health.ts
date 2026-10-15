import type { DreGroup, FinanceDirection } from './finance';
import { formatCents } from './money';

// ---------- DRE gerencial (regime de competência) ----------

export type DreRow = { month: string; dreGroup: DreGroup; direction: FinanceDirection; cents: number };

export type DreLineKey =
  | 'receita'
  | 'custosVariaveis'
  | 'margemContribuicao'
  | 'despesasFixas'
  | 'impostos'
  | 'royalties'
  | 'resultadoOperacional'
  | 'financeiro'
  | 'investimentos'
  | 'outros'
  | 'resultado';

export const DRE_LINES: { key: DreLineKey; label: string; total?: boolean; hint?: string }[] = [
  { key: 'receita', label: 'Receita', total: true, hint: 'Vendas e outras receitas do mês.' },
  { key: 'custosVariaveis', label: '(−) Custos variáveis', hint: 'Insumos, bebidas, embalagens, entregas, taxas.' },
  { key: 'margemContribuicao', label: '= Margem de contribuição', total: true, hint: 'O que sobra das vendas para pagar as despesas fixas.' },
  { key: 'despesasFixas', label: '(−) Despesas fixas', hint: 'Aluguel, salários, energia, contador...' },
  { key: 'impostos', label: '(−) Impostos' },
  { key: 'royalties', label: '(±) Royalties', hint: 'Franquia: royalties pagos à Matriz. Matriz: royalties recebidos.' },
  { key: 'resultadoOperacional', label: '= Resultado operacional', total: true, hint: 'O lucro (ou prejuízo) da operação do restaurante.' },
  { key: 'financeiro', label: '(±) Financeiro', hint: 'Juros, tarifas, empréstimos, aportes e retiradas dos sócios.' },
  { key: 'investimentos', label: '(−) Investimentos', hint: 'Equipamentos e reformas.' },
  { key: 'outros', label: '(±) Outros', hint: 'Ajustes de saldo.' },
  { key: 'resultado', label: '= Resultado do período', total: true },
];

export type DreMonth = Record<DreLineKey, number>;

/** Valores de cada linha da DRE para um conjunto de lançamentos por competência (centavos). */
export function computeDre(rows: Omit<DreRow, 'month'>[]): DreMonth {
  const sum = (group: DreGroup, direction: FinanceDirection) =>
    rows.filter((r) => r.dreGroup === group && r.direction === direction).reduce((s, r) => s + r.cents, 0);
  /** Saídas − entradas do grupo (custo líquido; entrada no grupo é devolução/estorno). */
  const cost = (g: DreGroup) => sum(g, 'SAIDA') - sum(g, 'ENTRADA');
  /** Entradas − saídas do grupo. */
  const net = (g: DreGroup) => sum(g, 'ENTRADA') - sum(g, 'SAIDA');

  const receita = net('RECEITA');
  const custosVariaveis = cost('CUSTO_VARIAVEL');
  const margemContribuicao = receita - custosVariaveis;
  const despesasFixas = cost('DESPESA_FIXA');
  const impostos = cost('IMPOSTOS');
  const royalties = net('ROYALTIES');
  const resultadoOperacional = margemContribuicao - despesasFixas - impostos + royalties;
  const financeiro = net('FINANCEIRO');
  const investimentos = cost('INVESTIMENTO');
  const outros = net('OUTROS');
  return {
    receita,
    custosVariaveis,
    margemContribuicao,
    despesasFixas,
    impostos,
    royalties,
    resultadoOperacional,
    financeiro,
    investimentos,
    outros,
    resultado: resultadoOperacional + financeiro - investimentos + outros,
  };
}

/** DRE mês a mês ("AAAA-MM" → valores), na ordem dos meses pedidos. */
export function buildDre(rows: DreRow[], months: string[]): { month: string; values: DreMonth }[] {
  return months.map((month) => ({ month, values: computeDre(rows.filter((r) => r.month === month)) }));
}

// ---------- Indicadores de saúde ----------

export type HealthTone = 'good' | 'warn' | 'bad' | 'neutral';

export type HealthIndicator = {
  key: string;
  label: string;
  /** Valor principal já formatado. */
  value: string;
  tone: HealthTone;
  /** Frase em português simples: o que o número quer dizer. */
  message: string;
};

export type HealthInput = {
  /** Saldo somado das contas hoje. */
  balanceCents: number;
  /** Média mensal das saídas pagas nos 3 meses anteriores (sem transferências). */
  avgMonthlyOutCents: number;
  /** DRE do período (competência). */
  dre: DreMonth;
  /** Compras de mercadoria no período (categorias marcadas como CMV). */
  cmvCents: number;
  /** Custo das fichas do cardápio nos pedidos entregues e o valor dos produtos desses pedidos. */
  theoreticalCmv: { costCents: number; salesCents: number };
  overduePayables: { count: number; cents: number };
  overdueReceivables: { count: number; cents: number };
  /** Menor saldo previsto nos próximos 90 dias (contas em aberto + vendas estimadas). */
  projectedMin: { cents: number; date: string };
  /** Venda média por dia usada na previsão (0 = sem histórico de vendas). */
  estimatedDailySalesCents?: number;
  /** Mês usado em margem, CMV e ponto de equilíbrio (ex.: "setembro"), quando não é o mês exibido. */
  periodLabel?: string;
  /** Contas bancárias e o último extrato enviado de cada uma (para a conferência bancária). */
  bankStatements?: { accountName: string; lastDate: string | null; lastDiffCents: number | null }[];
  /** Hoje ("AAAA-MM-DD"), para medir há quanto tempo veio o último extrato. */
  today?: string;
};

/** Dias sem extrato a partir dos quais a conferência bancária pede atenção. */
export const STATEMENT_MAX_AGE_DAYS = 31;

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

/** Conferência bancária: há extrato recente de cada conta de banco, e ele bate com o sistema? */
export function statementIndicator(banks: NonNullable<HealthInput['bankStatements']>, today: string): HealthIndicator | null {
  if (!banks.length) return null;
  const missing = banks.filter((b) => !b.lastDate);
  const stale = banks.filter((b) => b.lastDate && daysBetween(b.lastDate, today) > STATEMENT_MAX_AGE_DAYS);
  const diff = banks.filter((b) => b.lastDate && b.lastDiffCents);
  const base = { key: 'conferencia', label: 'Conferência bancária' };
  if (diff.length) {
    const b = diff[0]!;
    return {
      ...base,
      value: formatCents(Math.abs(b.lastDiffCents!)),
      tone: 'warn',
      message: `O extrato de ${br(b.lastDate!)} da ${b.accountName} mostra ${formatCents(Math.abs(b.lastDiffCents!))} a ${b.lastDiffCents! > 0 ? 'mais' : 'menos'} do que o sistema. Confira os lançamentos ou lance o ajuste.`,
    };
  }
  if (missing.length || stale.length) {
    const b = missing[0] ?? stale[0]!;
    return {
      ...base,
      value: b.lastDate ? `há ${daysBetween(b.lastDate, today)} dias` : 'sem extrato',
      tone: 'warn',
      message: b.lastDate
        ? `Envie o extrato da ${b.accountName}: o último é de ${br(b.lastDate)}.`
        : `Envie um extrato da ${b.accountName} para conferir o saldo com o banco.`,
    };
  }
  return { ...base, value: 'Em dia', tone: 'good', message: 'Os extratos recentes conferem com o saldo do sistema.' };
}

/** Faixas usadas no semáforo (ajustáveis num só lugar). */
export const HEALTH_THRESHOLDS = {
  runwayMonths: { good: 3, warn: 1 },
  operatingMarginPct: { good: 10, warn: 0 },
  cmvPct: { good: 35, warn: 40 },
  cmvGapPp: 5,
  breakEvenWarnPct: 90,
};

const pct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
const br = (date: string) => date.split('-').reverse().join('/');

/** Semáforo de saúde financeira: cada indicador com cor e explicação. */
export function healthIndicators(input: HealthInput): HealthIndicator[] {
  const t = HEALTH_THRESHOLDS;
  const { dre } = input;
  const out: HealthIndicator[] = [];
  const when = (label: string) => (input.periodLabel ? `${label} (${input.periodLabel})` : label);
  const sales = input.estimatedDailySalesCents
    ? `as contas em aberto e vendas de cerca de ${formatCents(input.estimatedDailySalesCents)} por dia (média dos últimos 28 dias)`
    : 'as contas em aberto';

  // Fôlego de caixa: quantos meses de despesas o saldo atual cobre.
  if (input.avgMonthlyOutCents > 0) {
    const months = input.balanceCents / input.avgMonthlyOutCents;
    const shown = Math.max(0, months).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    out.push({
      key: 'folego',
      label: 'Fôlego de caixa',
      value: `${shown} ${months >= 1 && months < 2 ? 'mês' : 'meses'}`,
      tone: months >= t.runwayMonths.good ? 'good' : months >= t.runwayMonths.warn ? 'warn' : 'bad',
      message:
        months >= t.runwayMonths.good
          ? `Seu caixa cobre ${shown} meses de despesas. Situação confortável.`
          : months >= t.runwayMonths.warn
            ? `Seu caixa cobre ${shown} ${months < 2 ? 'mês' : 'meses'} de despesas. O ideal é ter reserva para 3 meses.`
            : 'O saldo não cobre um mês de despesas. Atenção ao caixa.',
    });
  } else {
    out.push({ key: 'folego', label: 'Fôlego de caixa', value: '—', tone: 'neutral', message: 'Ainda não há saídas suficientes para calcular.' });
  }

  // Saldo previsto: o caixa fica negativo em algum dia dos próximos 90?
  out.push({
    key: 'previsto',
    label: 'Saldo previsto (90 dias)',
    value: formatCents(input.projectedMin.cents),
    tone: input.projectedMin.cents < 0 ? 'bad' : 'good',
    message:
      input.projectedMin.cents < 0
        ? `Considerando ${sales}, o saldo fica negativo em ${br(input.projectedMin.date)}. Antecipe recebimentos ou renegocie pagamentos.`
        : `Considerando ${sales}, o menor saldo previsto é ${formatCents(input.projectedMin.cents)} (em ${br(input.projectedMin.date)}).`,
  });

  // Margem operacional.
  if (dre.receita > 0) {
    const m = (dre.resultadoOperacional / dre.receita) * 100;
    out.push({
      key: 'margem',
      label: when('Margem operacional'),
      value: pct(m),
      tone: m >= t.operatingMarginPct.good ? 'good' : m >= t.operatingMarginPct.warn ? 'warn' : 'bad',
      message:
        m >= t.operatingMarginPct.good
          ? `De cada R$ 100 vendidos, sobram ${formatCents(Math.round(m * 100))} de lucro operacional.`
          : m >= t.operatingMarginPct.warn
            ? `Margem baixa: de cada R$ 100 vendidos, sobram ${formatCents(Math.round(m * 100))}. O ideal é acima de 10%.`
            : 'A operação está dando prejuízo neste período: as despesas superaram o que as vendas deixaram.',
    });
  } else {
    out.push({ key: 'margem', label: when('Margem operacional'), value: '—', tone: 'neutral', message: 'Sem receitas no período.' });
  }

  // CMV real e comparação com o teórico (desperdício).
  if (dre.receita > 0) {
    const real = (input.cmvCents / dre.receita) * 100;
    const theo = input.theoreticalCmv.salesCents > 0 ? (input.theoreticalCmv.costCents / input.theoreticalCmv.salesCents) * 100 : null;
    const gap = theo === null ? null : real - theo;
    out.push({
      key: 'cmv',
      label: when('CMV (custo da mercadoria)'),
      value: pct(real),
      tone: real <= t.cmvPct.good && (gap === null || gap <= t.cmvGapPp) ? 'good' : real <= t.cmvPct.warn ? 'warn' : 'bad',
      message: [
        real <= t.cmvPct.good
          ? `As compras de insumos somam ${pct(real)} das vendas, dentro do recomendado (até 35%).`
          : `As compras de insumos somam ${pct(real)} das vendas. O recomendado é até 35%.`,
        theo !== null &&
          (gap! > t.cmvGapPp
            ? `Pelas fichas do cardápio seria ${pct(theo)}: a diferença pode ser desperdício, perda de peixe ou compra acima do necessário.`
            : `Pelas fichas do cardápio seria ${pct(theo)}.`),
      ]
        .filter(Boolean)
        .join(' '),
    });
  }

  // Ponto de equilíbrio: quanto precisa vender para pagar as despesas fixas.
  if (dre.receita > 0 && dre.margemContribuicao > 0) {
    const mc = dre.margemContribuicao / dre.receita;
    const fixed = dre.despesasFixas + dre.impostos;
    const breakEven = Math.round(fixed / mc);
    const ratio = (dre.receita / Math.max(1, breakEven)) * 100;
    out.push({
      key: 'equilibrio',
      label: when('Ponto de equilíbrio'),
      value: formatCents(breakEven),
      tone: dre.receita >= breakEven ? 'good' : ratio >= t.breakEvenWarnPct ? 'warn' : 'bad',
      message:
        dre.receita >= breakEven
          ? `Para pagar as despesas fixas era preciso vender ${formatCents(breakEven)}. Você vendeu ${formatCents(dre.receita)}.`
          : `Faltaram ${formatCents(breakEven - dre.receita)} em vendas para cobrir as despesas fixas (${formatCents(breakEven)}).`,
    });
  }

  // Contas vencidas.
  out.push({
    key: 'vencidas',
    label: 'Contas vencidas',
    value: input.overduePayables.count ? formatCents(input.overduePayables.cents) : 'Nenhuma',
    tone: input.overduePayables.count ? 'bad' : 'good',
    message: input.overduePayables.count
      ? `${input.overduePayables.count} ${input.overduePayables.count === 1 ? 'conta vencida' : 'contas vencidas'} a pagar. Juros e multas corroem o caixa.`
      : 'Nenhuma conta a pagar vencida.',
  });
  if (input.overdueReceivables.count) {
    out.push({
      key: 'receber-vencidos',
      label: 'Recebimentos atrasados',
      value: formatCents(input.overdueReceivables.cents),
      tone: 'warn',
      message: `${input.overdueReceivables.count} ${input.overdueReceivables.count === 1 ? 'recebimento atrasado' : 'recebimentos atrasados'}. Vale cobrar.`,
    });
  }
  if (input.bankStatements && input.today) {
    const conferencia = statementIndicator(input.bankStatements, input.today);
    if (conferencia) out.push(conferencia);
  }
  return out;
}
