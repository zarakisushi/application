import { z } from 'zod';
import { checkboxField, moneyField, phoneField } from './order';
import { normalizeBrPhone } from './phone';
import { ROLES } from './permissions';

const text = (max: number) => z.string().trim().max(max).default('');
/** Texto opcional: vazio vira null no banco. */
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .default('')
    .transform((v) => v || null);

export const productSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome do sabor').max(120),
  description: text(600),
  price: moneyField.refine((v) => v > 0, 'Informe o preço de venda'),
  cost: moneyField,
  imageUrl: optional(500).refine(
    (v) => v === null || v.startsWith('/') || /^https:\/\//.test(v),
    'Use um caminho do site (/menu/...) ou um endereço https://',
  ),
  isSpecial: checkboxField,
  sortOrder: z.coerce.number('Ordem inválida').int().min(0).max(999).default(0),
});
export type ProductInput = z.output<typeof productSchema>;

export const customerSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  phone: phoneField,
  email: optional(160).refine((v) => v === null || z.email().safeParse(v).success, 'E-mail inválido'),
  birthday: z
    .union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')])
    .default('')
    .transform((v) => v || null),
  neighborhood: optional(120),
  address: optional(300),
  notes: optional(2000),
});
export type CustomerInput = z.output<typeof customerSchema>;

export const userSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  email: z.string().trim().toLowerCase().pipe(z.email('E-mail inválido')),
  role: z.enum(ROLES, 'Escolha o papel'),
  /** Só tem efeito quando quem salva é da Matriz. */
  isPlatformAdmin: checkboxField,
});
export type UserInput = z.output<typeof userSchema>;

export const tenantSchema = z.object({
  name: z.string().trim().min(3, 'Informe o nome da unidade').max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use letras minúsculas, números e hífens (ex.: setor-bueno)')
    .max(60),
  cnpj: optional(18).refine((v) => v === null || v.replace(/\D/g, '').length === 14, 'CNPJ deve ter 14 dígitos'),
  city: optional(80),
  whatsappNumber: z
    .string()
    .trim()
    .default('')
    .transform((v, ctx) => {
      if (!v) return null;
      const phone = normalizeBrPhone(v);
      if (!phone) {
        ctx.addIssue({ code: 'custom', message: 'WhatsApp inválido' });
        return z.NEVER;
      }
      return phone;
    }),
  calendarId: optional(200).refine((v) => v === null || z.email().safeParse(v).success, 'Informe o e-mail da agenda'),
  domain: optional(200),
  royaltyPct: z
    .string()
    .trim()
    .default('0')
    .transform((v, ctx) => {
      const n = Number(v.replace(',', '.') || '0');
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        ctx.addIssue({ code: 'custom', message: 'Percentual entre 0 e 100' });
        return z.NEVER;
      }
      return n.toFixed(2);
    }),
  orderCodePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,4}$/, 'Use de 2 a 4 letras (ex.: ZK, ZKB)'),
});
export type TenantInput = z.output<typeof tenantSchema>;

/** Primeira mensagem de erro de cada campo, no formato usado pelos formulários do painel. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[String(issue.path[0] ?? 'form')] ??= issue.message;
  return out;
}
