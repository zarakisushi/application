import { z } from 'zod';
import { moneyField } from './order';
import { formatBrPhone, normalizeBrPhone } from './phone';
import { whatsappUrl } from './whatsapp';

// Fornecedores da unidade: cadastro, documentos (CNPJ/CPF) e contatos.

export const SUPPLIER_CATEGORIES = [
  'PEIXES',
  'HORTIFRUTI',
  'MERCEARIA',
  'LATICINIOS',
  'EMBALAGENS',
  'GRAFICA',
  'LIMPEZA',
  'BEBIDAS',
  'GAS',
  'EQUIPAMENTOS',
  'SERVICOS',
  'OUTROS',
] as const;
export type SupplierCategory = (typeof SUPPLIER_CATEGORIES)[number];
export const SUPPLIER_CATEGORY_LABEL: Record<SupplierCategory, string> = {
  PEIXES: 'Peixes e frutos do mar',
  HORTIFRUTI: 'Hortifruti',
  MERCEARIA: 'Mercearia e secos',
  LATICINIOS: 'Laticínios',
  EMBALAGENS: 'Embalagens',
  GRAFICA: 'Gráfica e marketing',
  LIMPEZA: 'Limpeza e descartáveis',
  BEBIDAS: 'Bebidas',
  GAS: 'Gás',
  EQUIPAMENTOS: 'Equipamentos e manutenção',
  SERVICOS: 'Serviços',
  OUTROS: 'Outros',
};

export const SUPPLIER_PAYMENT_METHODS = ['PIX', 'BOLETO', 'CARTAO', 'DINHEIRO', 'TRANSFERENCIA'] as const;
export type SupplierPaymentMethod = (typeof SUPPLIER_PAYMENT_METHODS)[number];
export const SUPPLIER_PAYMENT_LABEL: Record<SupplierPaymentMethod, string> = {
  PIX: 'Pix',
  BOLETO: 'Boleto',
  CARTAO: 'Cartão',
  DINHEIRO: 'Dinheiro',
  TRANSFERENCIA: 'Transferência',
};

/** Dias da semana (0 = domingo), como em Date.getDay(). */
export const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;

export const BR_STATES = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

const onlyDigits = (v: string) => v.replace(/\D/g, '');

/** CNPJ com dígitos verificadores corretos. */
export function isValidCnpj(input: string): boolean {
  const d = onlyDigits(input);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const check = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((s, w, i) => s + w * Number(d[i]), 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return check(12) === Number(d[12]) && check(13) === Number(d[13]);
}

/** CPF com dígitos verificadores corretos. */
export function isValidCpf(input: string): boolean {
  const d = onlyDigits(input);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const check = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return check(9) === Number(d[9]) && check(10) === Number(d[10]);
}

/** "12345678000195" → "12.345.678/0001-95"; "12345678909" → "123.456.789-09". */
export function formatDocument(doc: string | null | undefined): string {
  const d = onlyDigits(doc ?? '');
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return doc ?? '';
}

/** "74000000" → "74000-000". */
export const formatCep = (cep: string | null | undefined) => {
  const d = onlyDigits(cep ?? '');
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : (cep ?? '');
};

/** Conversa no WhatsApp com o fornecedor, já com a saudação. */
export const supplierWhatsappUrl = (whatsapp: string, unitName?: string) =>
  whatsappUrl(whatsapp, `Olá! Aqui é da ${unitName ?? 'Zaraki Sushi'}.`);

/** Link de ligação ("tel:+5562..."). */
export const telHref = (phone: string) => `tel:+${onlyDigits(phone)}`;

export const formatSupplierPhone = (phone: string | null | undefined) => (phone ? formatBrPhone(phone) : '');

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Até ${max} caracteres`)
    .default('')
    .transform((v) => v || null);

const optionalPhone = z
  .string()
  .trim()
  .default('')
  .transform((v, ctx) => {
    if (!v) return null;
    const phone = normalizeBrPhone(v);
    if (!phone) {
      ctx.addIssue({ code: 'custom', message: 'Telefone inválido (ex.: 62 98109-2799)' });
      return z.NEVER;
    }
    return phone;
  });

/** Lista enviada pelo formulário como "A,B,C" (ou array). */
const listField = <T extends string>(values: readonly T[]) =>
  z
    .union([z.string(), z.array(z.string())])
    .default('')
    .transform((v) => (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values as unknown as [T, ...T[]]), 'Opção inválida'))
    .transform((v) => [...new Set(v)]);

export const supplierSchema = z
  .object({
    personKind: z.enum(['PJ', 'PF']).default('PJ'),
    name: z.string().trim().min(2, 'Informe o nome do fornecedor').max(120),
    legalName: optional(160),
    document: z
      .string()
      .trim()
      .default('')
      .transform((v) => onlyDigits(v) || null),
    stateRegistration: optional(30),
    categories: listField(SUPPLIER_CATEGORIES),
    contactName: optional(80),
    whatsapp: optionalPhone,
    phone: optionalPhone,
    email: z
      .union([z.literal(''), z.email('E-mail inválido').max(160)])
      .default('')
      .transform((v) => v.trim().toLowerCase() || null),
    website: optional(200),
    cep: z
      .string()
      .trim()
      .default('')
      .transform((v) => onlyDigits(v) || null)
      .refine((v) => v === null || v.length === 8, 'CEP deve ter 8 dígitos'),
    street: optional(160),
    number: optional(20),
    complement: optional(80),
    district: optional(80),
    city: optional(80),
    state: z
      .string()
      .trim()
      .toUpperCase()
      .default('')
      .transform((v) => v || null)
      .refine((v) => v === null || (BR_STATES as readonly string[]).includes(v), 'UF inválida'),
    deliveryDays: z
      .union([z.string(), z.array(z.string())])
      .default('')
      .transform((v) => (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim()).filter(Boolean).map(Number))
      .pipe(z.array(z.number().int().min(0).max(6), 'Dia inválido'))
      .transform((v) => [...new Set(v)].sort()),
    minOrder: moneyField,
    paymentTerms: optional(80),
    paymentMethods: listField(SUPPLIER_PAYMENT_METHODS),
    pixKey: optional(120),
    bankDetails: optional(300),
    rating: z.preprocess(
      (v) => (v === '' || v === null || v === undefined || v === '0' ? null : Number(v)),
      z.number().int().min(1).max(5).nullable(),
    ),
    notes: optional(2000),
    networkShared: z.preprocess((v) => v === true || v === 'on' || v === 'true', z.boolean()).default(false),
  })
  .superRefine((v, ctx) => {
    if (v.document) {
      const ok = v.personKind === 'PJ' ? isValidCnpj(v.document) : isValidCpf(v.document);
      if (!ok) ctx.addIssue({ code: 'custom', path: ['document'], message: v.personKind === 'PJ' ? 'CNPJ inválido' : 'CPF inválido' });
    }
    if (!v.whatsapp && !v.phone && !v.email) {
      ctx.addIssue({ code: 'custom', path: ['whatsapp'], message: 'Informe ao menos um contato: WhatsApp, telefone ou e-mail' });
    }
  });

export type SupplierInput = z.output<typeof supplierSchema>;
