import { z } from 'zod';
import { checkboxField, moneyField, PAYMENT_METHODS, type PaymentMethod } from './order';

// ---------- Domínio ----------

export const FINANCE_DIRECTIONS = ['ENTRADA', 'SAIDA'] as const;
export type FinanceDirection = (typeof FINANCE_DIRECTIONS)[number];
export const FINANCE_DIRECTION_LABEL: Record<FinanceDirection, string> = { ENTRADA: 'Entrada', SAIDA: 'Saída' };

export const FINANCE_ACCOUNT_KINDS = ['CAIXA', 'BANCO', 'CARTEIRA_DIGITAL', 'OUTRO'] as const;
export type FinanceAccountKind = (typeof FINANCE_ACCOUNT_KINDS)[number];
export const FINANCE_ACCOUNT_KIND_LABEL: Record<FinanceAccountKind, string> = {
  CAIXA: 'Caixa (dinheiro)',
  BANCO: 'Conta bancária',
  CARTEIRA_DIGITAL: 'Carteira digital',
  OUTRO: 'Outra',
};

/** Grupos do plano de contas, na ordem em que aparecem na DRE. */
export const DRE_GROUPS = ['RECEITA', 'CUSTO_VARIAVEL', 'DESPESA_FIXA', 'IMPOSTOS', 'ROYALTIES', 'FINANCEIRO', 'INVESTIMENTO', 'OUTROS'] as const;
export type DreGroup = (typeof DRE_GROUPS)[number];
export const DRE_GROUP_LABEL: Record<DreGroup, string> = {
  RECEITA: 'Receitas',
  CUSTO_VARIAVEL: 'Custos variáveis',
  DESPESA_FIXA: 'Despesas fixas',
  IMPOSTOS: 'Impostos',
  ROYALTIES: 'Royalties',
  FINANCEIRO: 'Financeiro',
  INVESTIMENTO: 'Investimentos',
  OUTROS: 'Outros',
};

export const FINANCE_ORIGINS = ['MANUAL', 'PEDIDO', 'ROYALTIES', 'AJUSTE', 'TRANSFERENCIA', 'ESTOQUE'] as const;
export type FinanceOrigin = (typeof FINANCE_ORIGINS)[number];
export const FINANCE_ORIGIN_LABEL: Record<FinanceOrigin, string> = {
  MANUAL: 'Manual',
  PEDIDO: 'Pedido',
  ROYALTIES: 'Royalties',
  AJUSTE: 'Ajuste de saldo',
  TRANSFERENCIA: 'Transferência',
  ESTOQUE: 'Compra de estoque',
};

/** Categorias com papel no sistema (não podem ser excluídas nem desativadas). */
export const FINANCE_SYSTEM_KEYS = ['VENDAS', 'ROYALTIES_PAGOS', 'ROYALTIES_RECEBIDOS', 'AJUSTE_ENTRADA', 'AJUSTE_SAIDA'] as const;
export type FinanceSystemKey = (typeof FINANCE_SYSTEM_KEYS)[number];

// ---------- Cadastros padrão de cada unidade ----------

type DefaultCategory = { name: string; direction: FinanceDirection; dreGroup: DreGroup; systemKey?: FinanceSystemKey; only?: 'MATRIZ' | 'FRANQUIA'; cmv?: boolean };

/** Plano de contas inicial, pensado para um restaurante japonês (cada unidade pode ajustar o seu). */
export const DEFAULT_FINANCE_CATEGORIES: DefaultCategory[] = [
  { name: 'Vendas (pedidos)', direction: 'ENTRADA', dreGroup: 'RECEITA', systemKey: 'VENDAS' },
  { name: 'Outras receitas', direction: 'ENTRADA', dreGroup: 'RECEITA' },
  { name: 'Royalties recebidos', direction: 'ENTRADA', dreGroup: 'ROYALTIES', systemKey: 'ROYALTIES_RECEBIDOS', only: 'MATRIZ' },
  { name: 'Aportes dos sócios', direction: 'ENTRADA', dreGroup: 'FINANCEIRO' },
  { name: 'Empréstimos recebidos', direction: 'ENTRADA', dreGroup: 'FINANCEIRO' },
  { name: 'Ajuste de saldo (sobra)', direction: 'ENTRADA', dreGroup: 'OUTROS', systemKey: 'AJUSTE_ENTRADA' },

  { name: 'Insumos: peixes e frutos do mar', direction: 'SAIDA', dreGroup: 'CUSTO_VARIAVEL', cmv: true },
  { name: 'Insumos: arroz, nori e mercearia', direction: 'SAIDA', dreGroup: 'CUSTO_VARIAVEL', cmv: true },
  { name: 'Hortifrúti', direction: 'SAIDA', dreGroup: 'CUSTO_VARIAVEL', cmv: true },
  { name: 'Bebidas', direction: 'SAIDA', dreGroup: 'CUSTO_VARIAVEL', cmv: true },
  { name: 'Embalagens', direction: 'SAIDA', dreGroup: 'CUSTO_VARIAVEL', cmv: true },
  { name: 'Entregas e motoboys', direction: 'SAIDA', dreGroup: 'CUSTO_VARIAVEL' },
  { name: 'Taxas de cartão e apps', direction: 'SAIDA', dreGroup: 'CUSTO_VARIAVEL' },

  { name: 'Aluguel', direction: 'SAIDA', dreGroup: 'DESPESA_FIXA' },
  { name: 'Energia', direction: 'SAIDA', dreGroup: 'DESPESA_FIXA' },
  { name: 'Água', direction: 'SAIDA', dreGroup: 'DESPESA_FIXA' },
  { name: 'Gás', direction: 'SAIDA', dreGroup: 'DESPESA_FIXA' },
  { name: 'Internet e telefone', direction: 'SAIDA', dreGroup: 'DESPESA_FIXA' },
  { name: 'Salários e encargos', direction: 'SAIDA', dreGroup: 'DESPESA_FIXA' },
  { name: 'Pró-labore', direction: 'SAIDA', dreGroup: 'DESPESA_FIXA' },
  { name: 'Contabilidade', direction: 'SAIDA', dreGroup: 'DESPESA_FIXA' },
  { name: 'Sistemas e assinaturas', direction: 'SAIDA', dreGroup: 'DESPESA_FIXA' },
  { name: 'Manutenção e limpeza', direction: 'SAIDA', dreGroup: 'DESPESA_FIXA' },
  { name: 'Marketing', direction: 'SAIDA', dreGroup: 'DESPESA_FIXA' },

  { name: 'Simples Nacional (DAS)', direction: 'SAIDA', dreGroup: 'IMPOSTOS' },
  { name: 'Outros impostos e taxas', direction: 'SAIDA', dreGroup: 'IMPOSTOS' },

  { name: 'Royalties à Matriz', direction: 'SAIDA', dreGroup: 'ROYALTIES', systemKey: 'ROYALTIES_PAGOS', only: 'FRANQUIA' },
  { name: 'Fundo de marketing', direction: 'SAIDA', dreGroup: 'ROYALTIES', only: 'FRANQUIA' },

  { name: 'Tarifas bancárias', direction: 'SAIDA', dreGroup: 'FINANCEIRO' },
  { name: 'Juros e multas', direction: 'SAIDA', dreGroup: 'FINANCEIRO' },
  { name: 'Pagamento de empréstimos', direction: 'SAIDA', dreGroup: 'FINANCEIRO' },
  { name: 'Retirada dos sócios', direction: 'SAIDA', dreGroup: 'FINANCEIRO' },

  { name: 'Equipamentos', direction: 'SAIDA', dreGroup: 'INVESTIMENTO' },
  { name: 'Reformas', direction: 'SAIDA', dreGroup: 'INVESTIMENTO' },
  { name: 'Ajuste de saldo (falta)', direction: 'SAIDA', dreGroup: 'OUTROS', systemKey: 'AJUSTE_SAIDA' },
];

export const DEFAULT_FINANCE_ACCOUNTS: { name: string; kind: FinanceAccountKind; receivesMethods: PaymentMethod[] }[] = [
  { name: 'Caixa da loja', kind: 'CAIXA', receivesMethods: ['DINHEIRO'] },
  { name: 'Conta bancária', kind: 'BANCO', receivesMethods: ['PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'OUTRO'] },
];

// ---------- Datas ----------

const pad = (n: number) => String(n).padStart(2, '0');

/** Soma meses a "AAAA-MM-DD"; dia que não existe no mês vira o último dia (31/01 + 1 → 28 ou 29/02). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(Math.min(d, last))}`;
}

export const addDays = (date: string, days: number) => {
  const t = new Date(`${date}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
};

/** Primeiro e último dia do mês de uma data. */
export function monthRange(date: string): { from: string; to: string } {
  const from = `${date.slice(0, 7)}-01`;
  return { from, to: addDays(addMonths(from, 1), -1) };
}

/** "2026-09-15" → "09/2026". */
export const formatMonthBr = (date: string) => `${date.slice(5, 7)}/${date.slice(0, 4)}`;

// ---------- Situação dos lançamentos ----------

export const ENTRY_SITUATIONS = ['PAGO', 'VENCIDO', 'HOJE', 'ABERTO'] as const;
export type EntrySituation = (typeof ENTRY_SITUATIONS)[number];

/** Pago/recebido, vencido (vencimento passou), vence hoje ou em aberto. */
export function entrySituation(entry: { paidOn: string | null; dueDate: string }, today: string): EntrySituation {
  if (entry.paidOn) return 'PAGO';
  if (entry.dueDate < today) return 'VENCIDO';
  if (entry.dueDate === today) return 'HOJE';
  return 'ABERTO';
}

export function entrySituationLabel(situation: EntrySituation, direction: FinanceDirection): string {
  const income = direction === 'ENTRADA';
  switch (situation) {
    case 'PAGO':
      return income ? 'Recebido' : 'Pago';
    case 'VENCIDO':
      return 'Vencido';
    case 'HOJE':
      return 'Vence hoje';
    default:
      return income ? 'A receber' : 'A pagar';
  }
}

/** Valor com sinal: entradas somam, saídas subtraem. */
export const signedCents = (e: { direction: FinanceDirection; amountCents: number }) => (e.direction === 'ENTRADA' ? e.amountCents : -e.amountCents);

// ---------- Recorrência e parcelas ----------

export const REPEAT_MODES = ['NAO', 'MENSAL', 'PARCELADO'] as const;
export type RepeatMode = (typeof REPEAT_MODES)[number];

export type SeriesItem = { description: string; amountCents: number; competenceDate: string; dueDate: string; installment: number | null; installments: number | null };

/**
 * Transforma um lançamento em série:
 * - MENSAL: o mesmo valor todo mês, por N meses (ex.: aluguel);
 * - PARCELADO: o valor total dividido em N parcelas mensais; o centavo que sobra vai na última.
 */
export function buildSeries(input: { description: string; amountCents: number; competenceDate: string; dueDate: string; repeat: RepeatMode; count: number }): SeriesItem[] {
  if (input.repeat === 'NAO' || input.count <= 1) {
    return [{ description: input.description, amountCents: input.amountCents, competenceDate: input.competenceDate, dueDate: input.dueDate, installment: null, installments: null }];
  }
  const n = input.count;
  const base = Math.floor(input.amountCents / n);
  return Array.from({ length: n }, (_, i) => ({
    description: input.repeat === 'PARCELADO' ? `${input.description} (${i + 1}/${n})` : input.description,
    amountCents: input.repeat === 'PARCELADO' ? (i === n - 1 ? input.amountCents - base * (n - 1) : base) : input.amountCents,
    competenceDate: addMonths(input.competenceDate, i),
    dueDate: addMonths(input.dueDate, i),
    installment: i + 1,
    installments: n,
  }));
}

// ---------- Formulários ----------

const dateField = (message: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, message);
const optionalDate = z
  .union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')])
  .default('')
  .transform((v) => v || null);
const optionalUuid = z
  .union([z.literal(''), z.uuid()])
  .default('')
  .transform((v) => v || null);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .default('')
    .transform((v) => v || null);
const paymentMethodField = z
  .union([z.literal(''), z.enum(PAYMENT_METHODS)])
  .default('')
  .transform((v) => v || null);

/** Lançamento manual (entrada ou saída). */
export const financeEntrySchema = z
  .object({
    direction: z.enum(FINANCE_DIRECTIONS, 'Escolha entrada ou saída'),
    description: z.string().trim().min(2, 'Descreva o lançamento').max(160),
    amount: moneyField,
    categoryId: z.uuid('Escolha a categoria'),
    competenceDate: dateField('Informe a data de competência'),
    dueDate: dateField('Informe o vencimento'),
    paid: checkboxField,
    paidOn: optionalDate,
    accountId: optionalUuid,
    paymentMethod: paymentMethodField,
    counterparty: optionalText(120),
    notes: optionalText(1000),
    attachmentId: optionalUuid,
    repeat: z.enum(REPEAT_MODES).default('NAO'),
    repeatCount: z.preprocess((v) => (v === '' || v === undefined || v === null ? 1 : Number(v)), z.number().int('Número inteiro').min(1).max(60, 'No máximo 60')),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (v.amount <= 0) issue('amount', 'Informe um valor maior que zero');
    if (v.paid && !v.paidOn) issue('paidOn', 'Informe a data do pagamento');
    if (v.paid && !v.accountId) issue('accountId', 'Escolha a conta');
    if (v.repeat !== 'NAO' && v.repeatCount < 2) issue('repeatCount', 'Informe de 2 a 60 vezes');
  })
  .transform((v) => ({
    direction: v.direction,
    description: v.description,
    amountCents: v.amount,
    categoryId: v.categoryId,
    competenceDate: v.competenceDate,
    dueDate: v.dueDate,
    paidOn: v.paid ? v.paidOn : null,
    accountId: v.accountId,
    paymentMethod: v.paymentMethod,
    counterparty: v.counterparty,
    notes: v.notes,
    attachmentId: v.attachmentId,
    repeat: v.repeat,
    repeatCount: v.repeat === 'NAO' ? 1 : v.repeatCount,
  }));
export type FinanceEntryInput = z.output<typeof financeEntrySchema>;

/** Na edição de um lançamento de série: só este ou este e os próximos em aberto. */
export const SERIES_SCOPES = ['ESTE', 'PROXIMOS'] as const;
export type SeriesScope = (typeof SERIES_SCOPES)[number];

/** Pagar/receber um lançamento em aberto. */
export const payEntrySchema = z.object({
  paidOn: dateField('Informe a data do pagamento'),
  accountId: z.uuid('Escolha a conta'),
  paymentMethod: paymentMethodField,
});
export type PayEntryInput = z.output<typeof payEntrySchema>;

export const financeAccountSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome da conta').max(80),
  kind: z.enum(FINANCE_ACCOUNT_KINDS, 'Escolha o tipo'),
  openingBalance: z
    .string()
    .default('')
    .transform((value, ctx) => {
      const v = value.trim();
      if (!v) return 0;
      const negative = v.startsWith('-');
      const parsed = moneyField.safeParse(v.replace(/^-/, ''));
      if (!parsed.success) {
        ctx.addIssue({ code: 'custom', message: 'Valor inválido (ex.: 1.500,00)' });
        return z.NEVER;
      }
      return negative ? -parsed.data : parsed.data;
    }),
  openingDate: dateField('Informe a data do saldo inicial'),
  receivesMethods: z.array(z.enum(PAYMENT_METHODS)).default([]),
  active: checkboxField,
});
export type FinanceAccountInput = z.output<typeof financeAccountSchema>;

export const financeCategorySchema = z
  .object({
    name: z.string().trim().min(2, 'Informe o nome da categoria').max(80),
    direction: z.enum(FINANCE_DIRECTIONS, 'Escolha entrada ou saída'),
    dreGroup: z.enum(DRE_GROUPS, 'Escolha o grupo'),
    cmv: checkboxField,
    active: checkboxField,
  })
  // Só compra de mercadoria (saída) entra no CMV.
  .transform((v) => ({ ...v, cmv: v.direction === 'SAIDA' && v.cmv }));
export type FinanceCategoryInput = z.output<typeof financeCategorySchema>;

export const transferSchema = z
  .object({
    fromAccountId: z.uuid('Escolha a conta de origem'),
    toAccountId: z.uuid('Escolha a conta de destino'),
    amount: moneyField,
    date: dateField('Informe a data'),
    notes: optionalText(300),
  })
  .superRefine((v, ctx) => {
    if (v.fromAccountId === v.toAccountId) ctx.addIssue({ code: 'custom', path: ['toAccountId'], message: 'Escolha uma conta diferente da origem' });
    if (v.amount <= 0) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Informe um valor maior que zero' });
  })
  .transform((v) => ({ fromAccountId: v.fromAccountId, toAccountId: v.toAccountId, amountCents: v.amount, date: v.date, notes: v.notes }));
export type TransferInput = z.output<typeof transferSchema>;

/** Extrato bancário enviado para conferência (o saldo aceita negativo, com "-"). */
export const statementSchema = z
  .object({
    statementDate: dateField('Informe a data do extrato'),
    balance: z.string().trim().min(1, 'Informe o saldo mostrado no extrato'),
    attachmentIds: z.array(z.uuid()).min(1, 'Envie ao menos uma foto ou PDF do extrato').max(10, 'No máximo 10 arquivos por extrato'),
    notes: optionalText(500),
  })
  .transform((v, ctx) => {
    const negative = v.balance.startsWith('-');
    const parsed = moneyField.safeParse(v.balance.replace(/^-/, ''));
    if (!parsed.success) {
      ctx.addIssue({ code: 'custom', path: ['balance'], message: 'Valor inválido (ex.: 12.345,67)' });
      return z.NEVER;
    }
    return {
      statementDate: v.statementDate,
      balanceCents: negative ? -parsed.data : parsed.data,
      attachmentIds: [...new Set(v.attachmentIds)],
      notes: v.notes,
    };
  });
export type StatementInput = z.output<typeof statementSchema>;
