import { z } from 'zod';
import { formatCents } from './money';
import { checkboxField, moneyField, PAYMENT_METHODS } from './order';

// ---------- Domínio ----------

export const STOCK_KINDS = ['INSUMO', 'EMBALAGEM', 'MARKETING', 'OPERACIONAL', 'OUTRO'] as const;
export type StockKind = (typeof STOCK_KINDS)[number];
export const STOCK_KIND_LABEL: Record<StockKind, string> = {
  INSUMO: 'Insumos de produção',
  EMBALAGEM: 'Tubos e embalagens',
  MARKETING: 'Marketing (adesivos, panfletos)',
  OPERACIONAL: 'Operacional (limpeza, descartáveis)',
  OUTRO: 'Outros',
};

export const STOCK_UNITS = ['un', 'kg', 'g', 'l', 'ml', 'pct', 'cx', 'folha', 'rolo', 'm'] as const;
export type StockUnit = (typeof STOCK_UNITS)[number];
export const STOCK_UNIT_LABEL: Record<StockUnit, string> = {
  un: 'unidade',
  kg: 'quilo (kg)',
  g: 'grama (g)',
  l: 'litro (l)',
  ml: 'mililitro (ml)',
  pct: 'pacote',
  cx: 'caixa',
  folha: 'folha',
  rolo: 'rolo',
  m: 'metro',
};

/**
 * Tipos de movimentação. Entradas somam, saídas subtraem; o saldo de um item é a soma das movimentações
 * ativas (nada é apagado: cancelar = exclusão lógica).
 */
export const STOCK_MOVEMENT_KINDS = ['COMPRA', 'PEDIDO', 'PERDA', 'CONSUMO', 'AJUSTE', 'ENTRADA'] as const;
export type StockMovementKind = (typeof STOCK_MOVEMENT_KINDS)[number];
export const STOCK_MOVEMENT_LABEL: Record<StockMovementKind, string> = {
  COMPRA: 'Compra',
  PEDIDO: 'Saída por pedido',
  PERDA: 'Perda / desperdício',
  CONSUMO: 'Consumo interno',
  AJUSTE: 'Ajuste de contagem',
  ENTRADA: 'Outra entrada',
};
/** Movimentações que a equipe registra à mão na tela "Registrar saída ou entrada". */
export const MANUAL_MOVEMENT_KINDS = ['PERDA', 'CONSUMO', 'ENTRADA'] as const;
export type ManualMovementKind = (typeof MANUAL_MOVEMENT_KINDS)[number];

export type StockSituation = 'ZERADO' | 'BAIXO' | 'OK';
export const STOCK_SITUATION_LABEL: Record<StockSituation, string> = { ZERADO: 'Sem estoque', BAIXO: 'Abaixo do mínimo', OK: 'Em dia' };

/** Zerado (ou negativo), abaixo do mínimo ou em dia. */
export function stockSituation(qty: number, minQty: number): StockSituation {
  if (qty <= 0) return 'ZERADO';
  if (minQty > 0 && qty < minQty) return 'BAIXO';
  return 'OK';
}

// ---------- Números ----------

/** Arredonda quantidades para 3 casas (gramas em kg, ml em litros). */
export const roundQty = (n: number) => Math.round(n * 1000) / 1000;

/** "1,5" / "1.250,75" / "2" → número; vazio ou inválido → null. */
export function parseQuantity(input: string): number | null {
  const clean = input.trim().replace(/\s/g, '');
  if (!clean) return null;
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,3})?$|^\d+(,\d{1,3})?$|^\d+(\.\d{1,3})?$/.test(clean)) return null;
  const thousands = !clean.includes(',') && /^\d{1,3}(\.\d{3})+$/.test(clean);
  const normalized = clean.includes(',') || thousands ? clean.replace(/\./g, '').replace(',', '.') : clean;
  const n = Number(normalized);
  return Number.isFinite(n) ? roundQty(n) : null;
}

/** 1.5, "kg" → "1,5 kg"; 12, "un" → "12 un". */
export const formatQty = (qty: number, unit?: string) =>
  `${roundQty(qty).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ''}`;

/** Custo de uma ficha técnica (centavos) a partir do custo médio por unidade de cada item. */
export function recipeCostCents(lines: { qty: number; unitCostCents: number | null }[]): { cents: number; missing: number } {
  let cents = 0;
  let missing = 0;
  for (const l of lines) {
    if (l.unitCostCents === null) missing++;
    else cents += l.qty * l.unitCostCents;
  }
  return { cents: Math.round(cents), missing };
}

/** "R$ 0,12 / g" — custo por unidade com até 4 casas quando é fração de centavo. */
export function formatUnitCost(cents: number | null, unit: string) {
  if (cents === null) return '—';
  if (cents >= 100 || Number.isInteger(cents)) return `${formatCents(Math.round(cents))} / ${unit}`;
  return `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} / ${unit}`;
}

// ---------- Catálogo sugerido (Push Pop Sushi) ----------

export type SuggestedStockItem = { name: string; kind: StockKind; unit: StockUnit; minQty: number; financeCategory: string };

/** Lista inicial pensada para o Push Pop Sushi; a unidade escolhe se quer começar com ela e ajusta depois. */
export const SUGGESTED_STOCK_ITEMS: SuggestedStockItem[] = [
  { name: 'Arroz para sushi', kind: 'INSUMO', unit: 'kg', minQty: 10, financeCategory: 'Insumos: arroz, nori e mercearia' },
  { name: 'Alga nori', kind: 'INSUMO', unit: 'folha', minQty: 100, financeCategory: 'Insumos: arroz, nori e mercearia' },
  { name: 'Salmão', kind: 'INSUMO', unit: 'kg', minQty: 5, financeCategory: 'Insumos: peixes e frutos do mar' },
  { name: 'Camarão', kind: 'INSUMO', unit: 'kg', minQty: 2, financeCategory: 'Insumos: peixes e frutos do mar' },
  { name: 'Cream cheese', kind: 'INSUMO', unit: 'kg', minQty: 2, financeCategory: 'Insumos: arroz, nori e mercearia' },
  { name: 'Manga', kind: 'INSUMO', unit: 'kg', minQty: 1, financeCategory: 'Hortifrúti' },
  { name: 'Vinagre de arroz', kind: 'INSUMO', unit: 'l', minQty: 2, financeCategory: 'Insumos: arroz, nori e mercearia' },
  { name: 'Gergelim', kind: 'INSUMO', unit: 'kg', minQty: 0.5, financeCategory: 'Insumos: arroz, nori e mercearia' },
  { name: 'Shoyu (sachê)', kind: 'INSUMO', unit: 'un', minQty: 200, financeCategory: 'Insumos: arroz, nori e mercearia' },
  { name: 'Tubo Push Pop', kind: 'EMBALAGEM', unit: 'un', minQty: 300, financeCategory: 'Embalagens' },
  { name: 'Tampa do tubo', kind: 'EMBALAGEM', unit: 'un', minQty: 300, financeCategory: 'Embalagens' },
  { name: 'Adesivo de lacre', kind: 'EMBALAGEM', unit: 'un', minQty: 300, financeCategory: 'Embalagens' },
  { name: 'Sacola para delivery', kind: 'EMBALAGEM', unit: 'un', minQty: 100, financeCategory: 'Embalagens' },
  { name: 'Adesivo da marca', kind: 'MARKETING', unit: 'un', minQty: 200, financeCategory: 'Marketing' },
  { name: 'Panfleto', kind: 'MARKETING', unit: 'un', minQty: 500, financeCategory: 'Marketing' },
  { name: 'Luvas descartáveis', kind: 'OPERACIONAL', unit: 'cx', minQty: 2, financeCategory: 'Manutenção e limpeza' },
  { name: 'Filme plástico', kind: 'OPERACIONAL', unit: 'rolo', minQty: 2, financeCategory: 'Manutenção e limpeza' },
];

// ---------- Formulários ----------

const quantityField = (message: string, { allowZero = false } = {}) =>
  z
    .union([z.string(), z.number()])
    .transform((v, ctx) => {
      const n = typeof v === 'number' ? roundQty(v) : parseQuantity(v);
      if (n === null || n < 0 || (!allowZero && n === 0)) {
        ctx.addIssue({ code: 'custom', message });
        return z.NEVER;
      }
      return n;
    });
const dateField = (message: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, message);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .default('')
    .transform((v) => v || null);
const optionalUuid = z
  .union([z.literal(''), z.uuid()])
  .default('')
  .transform((v) => v || null);

export const stockItemSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome do item').max(80),
  kind: z.enum(STOCK_KINDS, 'Escolha a categoria'),
  unit: z.enum(STOCK_UNITS, 'Escolha a unidade de medida'),
  minQty: z
    .string()
    .default('')
    .transform((v, ctx) => {
      if (!v.trim()) return 0;
      const n = parseQuantity(v);
      if (n === null) {
        ctx.addIssue({ code: 'custom', message: 'Quantidade inválida (ex.: 2,5)' });
        return z.NEVER;
      }
      return n;
    }),
  financeCategoryId: optionalUuid,
  supplier: optionalText(120),
  active: checkboxField,
});
export type StockItemInput = z.output<typeof stockItemSchema>;

/** Saída ou entrada registrada à mão (perda, consumo interno, outra entrada). */
export const stockMovementSchema = z.object({
  itemId: z.uuid('Escolha o item'),
  kind: z.enum(MANUAL_MOVEMENT_KINDS, 'Escolha o tipo'),
  qty: quantityField('Informe a quantidade (ex.: 1,5)'),
  occurredOn: dateField('Informe a data'),
  notes: optionalText(300),
});
export type StockMovementInput = z.output<typeof stockMovementSchema>;

/** Compra: itens com quantidade e valor da linha; vira entrada no estoque e conta a pagar no Financeiro. */
export const stockPurchaseSchema = z
  .object({
    supplier: z.string().trim().min(2, 'Informe o fornecedor').max(120),
    purchasedOn: dateField('Informe a data da compra'),
    dueDate: dateField('Informe o vencimento'),
    paid: checkboxField,
    paidOn: z
      .union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')])
      .default('')
      .transform((v) => v || null),
    accountId: optionalUuid,
    paymentMethod: z
      .union([z.literal(''), z.enum(PAYMENT_METHODS)])
      .default('')
      .transform((v) => v || null),
    notes: optionalText(500),
    attachmentId: optionalUuid,
    lines: z
      .array(z.object({ itemId: z.uuid('Escolha o item'), qty: quantityField('Quantidade inválida'), total: moneyField }))
      .min(1, 'Adicione ao menos um item à compra')
      .max(50),
  })
  .superRefine((v, ctx) => {
    if (v.paid && !v.paidOn) ctx.addIssue({ code: 'custom', path: ['paidOn'], message: 'Informe a data do pagamento' });
    if (v.paid && !v.accountId) ctx.addIssue({ code: 'custom', path: ['accountId'], message: 'Escolha a conta' });
    if (v.lines.some((l) => l.total <= 0)) ctx.addIssue({ code: 'custom', path: ['lines'], message: 'Informe o valor de cada item' });
    if (new Set(v.lines.map((l) => l.itemId)).size !== v.lines.length) {
      ctx.addIssue({ code: 'custom', path: ['lines'], message: 'O mesmo item aparece duas vezes: some as quantidades numa linha só' });
    }
  })
  .transform((v) => ({ ...v, paidOn: v.paid ? v.paidOn : null, lines: v.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, totalCents: l.total })) }));
export type StockPurchaseInput = z.output<typeof stockPurchaseSchema>;

/** Contagem de estoque: só os itens contados entram (os demais ficam como estão). */
export const stockCountSchema = z.object({
  occurredOn: dateField('Informe a data da contagem'),
  counts: z
    .array(z.object({ itemId: z.uuid(), counted: quantityField('Quantidade contada inválida', { allowZero: true }) }))
    .min(1, 'Informe a quantidade contada de ao menos um item'),
  notes: optionalText(300),
});
export type StockCountInput = z.output<typeof stockCountSchema>;

/** Ficha técnica de um sabor: quanto de cada item vai em 1 tubo. */
export const recipeSchema = z.object({
  lines: z
    .array(z.object({ itemId: z.uuid('Escolha o item'), qty: quantityField('Quantidade por tubo inválida') }))
    .max(40)
    .superRefine((lines, ctx) => {
      if (new Set(lines.map((l) => l.itemId)).size !== lines.length) ctx.addIssue({ code: 'custom', message: 'O mesmo item aparece duas vezes na ficha' });
    }),
});
export type RecipeInput = z.output<typeof recipeSchema>;
