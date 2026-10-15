import { z } from 'zod';
import { formatCents } from './money';
import { checkboxField, moneyField } from './order';
import { formatBrPhone, normalizeBrPhone } from './phone';
import { normalizeCouponCode } from './text';
import { formatDateBr } from './time';

export const COUPON_KINDS = ['PERCENT', 'FIXED'] as const;
export type CouponKind = (typeof COUPON_KINDS)[number];

export const COUPON_KIND_LABEL: Record<CouponKind, string> = {
  PERCENT: 'Porcentagem',
  FIXED: 'Valor em reais',
};


/** Código aleatório fácil de ditar (sem 0/O, 1/I/L). */
export function generateCouponCode(prefix = 'ZK') {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `${prefix}-${[...bytes].map((b) => alphabet[b % alphabet.length]).join('')}`;
}

/** Regras do cupom necessárias para avaliá-lo (vindas do banco). */
export type CouponRule = {
  code: string;
  kind: CouponKind;
  /** Percentual 0,01–100 (o banco guarda como texto numérico). */
  percentOff: string | number | null;
  amountOffCents: number | null;
  minTubes: number | null;
  minSubtotalCents: number | null;
  /** "AAAA-MM-DD", inclusive, no fuso da unidade. */
  startsAt: string | null;
  endsAt: string | null;
  maxUses: number | null;
  /** Telefone E.164 do cupom exclusivo. */
  phone: string | null;
  active: boolean;
  status: boolean;
};

export type CouponContext = {
  subtotalCents: number;
  tubes: number;
  /** Telefone (E.164) de quem está usando, quando conhecido. */
  phone: string | null;
  /** Usos já registrados (pedidos ativos e não cancelados, sem contar o pedido em edição). */
  usesSoFar: number;
  /** Hoje no fuso da unidade ("AAAA-MM-DD"). */
  today: string;
};

export type CouponRejection = 'INVALID' | 'NOT_STARTED' | 'EXPIRED' | 'PHONE_REQUIRED' | 'NOT_YOURS' | 'USED_UP' | 'MIN_TUBES' | 'MIN_SUBTOTAL';

export type CouponCheck =
  | { ok: true; code: string; discountCents: number }
  | { ok: false; reason: CouponRejection; message: string };

const reject = (reason: CouponRejection, message: string): CouponCheck => ({ ok: false, reason, message });

/**
 * Avalia um cupom para um pedido. Regra única usada pelo site e pelo painel (e revalidada no banco,
 * dentro da transação do pedido). O desconto incide só sobre os produtos, nunca maior que o subtotal.
 */
export function evaluateCoupon(coupon: CouponRule | null, o: CouponContext): CouponCheck {
  if (!coupon || !coupon.status || !coupon.active) return reject('INVALID', 'Cupom inválido.');
  if (coupon.startsAt && o.today < coupon.startsAt) return reject('NOT_STARTED', 'Este cupom ainda não está valendo.');
  if (coupon.endsAt && o.today > coupon.endsAt) return reject('EXPIRED', 'Este cupom expirou.');
  if (coupon.phone) {
    if (!o.phone) return reject('PHONE_REQUIRED', 'Informe o seu WhatsApp para usar este cupom.');
    if (o.phone !== coupon.phone) return reject('NOT_YOURS', 'Este cupom não é válido para este WhatsApp.');
  }
  if (coupon.maxUses !== null && o.usesSoFar >= coupon.maxUses) {
    return reject('USED_UP', coupon.phone ? 'Este cupom já foi utilizado.' : 'Este cupom já foi totalmente utilizado.');
  }
  if (coupon.minTubes && o.tubes < coupon.minTubes) {
    return reject('MIN_TUBES', `Válido para pedidos a partir de ${coupon.minTubes} tubos.`);
  }
  if (coupon.minSubtotalCents && o.subtotalCents < coupon.minSubtotalCents) {
    return reject('MIN_SUBTOTAL', `Válido para pedidos a partir de ${formatCents(coupon.minSubtotalCents)}.`);
  }
  const raw =
    coupon.kind === 'PERCENT'
      ? Math.round((o.subtotalCents * Number(coupon.percentOff ?? 0)) / 100)
      : (coupon.amountOffCents ?? 0);
  return { ok: true, code: coupon.code, discountCents: Math.max(0, Math.min(raw, o.subtotalCents)) };
}

/** "10%" ou "R$ 20,00". */
export function couponDiscountLabel(c: Pick<CouponRule, 'kind' | 'percentOff' | 'amountOffCents'>) {
  return c.kind === 'PERCENT'
    ? `${Number(c.percentOff ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
    : formatCents(c.amountOffCents ?? 0);
}

/** Condições em texto curto: "a partir de 3 tubos · acima de R$ 200,00 · exclusivo (62) 9…". */
export function couponConditions(c: Pick<CouponRule, 'minTubes' | 'minSubtotalCents' | 'phone'>) {
  const parts = [
    c.minTubes ? `a partir de ${c.minTubes} tubos` : null,
    c.minSubtotalCents ? `a partir de ${formatCents(c.minSubtotalCents)}` : null,
    c.phone ? `exclusivo ${formatBrPhone(c.phone)}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'sem pedido mínimo';
}

/** Descrição completa, em português, de como o cupom funciona. */
export function describeCoupon(c: Omit<CouponRule, 'code' | 'active' | 'status'>) {
  const parts = [
    `${couponDiscountLabel(c)} de desconto nos produtos`,
    c.minTubes ? `a partir de ${c.minTubes} tubos` : null,
    c.minSubtotalCents ? `em pedidos a partir de ${formatCents(c.minSubtotalCents)}` : null,
    c.startsAt && c.endsAt
      ? `de ${formatDateBr(c.startsAt)} até ${formatDateBr(c.endsAt)}`
      : c.startsAt
        ? `a partir de ${formatDateBr(c.startsAt)}`
        : c.endsAt
          ? `até ${formatDateBr(c.endsAt)}`
          : null,
    c.phone ? `exclusivo para ${formatBrPhone(c.phone)}, uso único` : c.maxUses ? `limitado a ${c.maxUses} ${c.maxUses === 1 ? 'uso' : 'usos'}` : 'sem limite de usos',
  ].filter(Boolean);
  return `${parts.join(', ')}.`;
}

const optionalDate = z
  .union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')])
  .default('')
  .transform((v) => v || null);

const optionalInt = (min: number, message: string) =>
  z.preprocess((v) => (v === '' || v === null || v === undefined ? null : Number(v)), z.number(message).int(message).min(min, message).nullable());

/** Cadastro de cupom no painel. */
export const couponSchema = z
  .object({
    code: z
      .string()
      .transform(normalizeCouponCode)
      .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9-]{2,29}$/, 'Use de 3 a 30 letras, números ou hífen (ex.: ZARAKI10)')),
    description: z
      .string()
      .trim()
      .max(200)
      .default('')
      .transform((v) => v || null),
    kind: z.enum(COUPON_KINDS, 'Escolha o tipo de desconto'),
    percentOff: z.string().trim().default(''),
    amountOff: moneyField,
    minTubes: optionalInt(1, 'Informe um número inteiro de tubos'),
    minSubtotal: moneyField,
    startsAt: optionalDate,
    endsAt: optionalDate,
    maxUses: optionalInt(1, 'Informe um número inteiro de usos'),
    exclusive: checkboxField,
    phone: z.string().trim().default(''),
    active: checkboxField,
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (v.kind === 'PERCENT') {
      const pct = Number(v.percentOff.replace(',', '.'));
      if (!v.percentOff || !Number.isFinite(pct) || pct <= 0 || pct > 100) issue('percentOff', 'Informe uma porcentagem entre 0,01 e 100');
    } else if (!v.amountOff) {
      issue('amountOff', 'Informe o valor do desconto');
    }
    if (v.startsAt && v.endsAt && v.endsAt < v.startsAt) issue('endsAt', 'A data final precisa ser depois da inicial');
    if (v.exclusive && !normalizeBrPhone(v.phone)) issue('phone', 'Informe o WhatsApp do cliente');
  })
  .transform((v) => ({
    code: v.code,
    description: v.description,
    kind: v.kind,
    percentOff: v.kind === 'PERCENT' ? Number(v.percentOff.replace(',', '.')).toFixed(2) : null,
    amountOffCents: v.kind === 'FIXED' ? v.amountOff : null,
    minTubes: v.minTubes,
    minSubtotalCents: v.minSubtotal || null,
    startsAt: v.startsAt,
    endsAt: v.endsAt,
    // Cupom exclusivo é sempre de uso único.
    maxUses: v.exclusive ? 1 : v.maxUses,
    phone: v.exclusive ? normalizeBrPhone(v.phone) : null,
    active: v.active,
  }));
export type CouponInput = z.output<typeof couponSchema>;
