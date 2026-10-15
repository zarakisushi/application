import { describe, expect, it } from 'vitest';
import { couponSchema, describeCoupon, evaluateCoupon, generateCouponCode, normalizeCouponCode, type CouponRule } from '../src';

const base: CouponRule = {
  code: 'ZARAKI10',
  kind: 'PERCENT',
  percentOff: '10.00',
  amountOffCents: null,
  minTubes: null,
  minSubtotalCents: null,
  startsAt: null,
  endsAt: null,
  maxUses: null,
  phone: null,
  active: true,
  status: true,
};
const ctx = { subtotalCents: 16000, tubes: 3, phone: '+5562981092799', usesSoFar: 0, today: '2026-10-15' };

describe('avaliação do cupom', () => {
  it('porcentagem sobre os produtos e valor fixo limitado ao subtotal', () => {
    expect(evaluateCoupon(base, ctx)).toEqual({ ok: true, code: 'ZARAKI10', discountCents: 1600 });
    const fixed = { ...base, kind: 'FIXED' as const, percentOff: null, amountOffCents: 2000 };
    expect(evaluateCoupon(fixed, ctx)).toMatchObject({ ok: true, discountCents: 2000 });
    expect(evaluateCoupon({ ...fixed, amountOffCents: 99999 }, ctx)).toMatchObject({ ok: true, discountCents: 16000 });
  });

  it.each([
    ['inativo', { active: false }, ctx, 'Cupom inválido.'],
    ['excluído', { status: false }, ctx, 'Cupom inválido.'],
    ['antes da validade', { startsAt: '2026-10-20' }, ctx, 'Este cupom ainda não está valendo.'],
    ['depois da validade', { endsAt: '2026-10-14' }, ctx, 'Este cupom expirou.'],
    ['esgotado', { maxUses: 5 }, { ...ctx, usesSoFar: 5 }, 'Este cupom já foi totalmente utilizado.'],
    ['mínimo de tubos', { minTubes: 5 }, ctx, 'Válido para pedidos a partir de 5 tubos.'],
    ['mínimo de valor', { minSubtotalCents: 20000 }, ctx, 'Válido para pedidos a partir de R$ 200,00.'],
    ['exclusivo de outro telefone', { phone: '+5562900000000', maxUses: 1 }, ctx, 'Este cupom não é válido para este WhatsApp.'],
    ['exclusivo sem telefone informado', { phone: '+5562981092799', maxUses: 1 }, { ...ctx, phone: null }, 'Informe o seu WhatsApp para usar este cupom.'],
    ['exclusivo já usado', { phone: '+5562981092799', maxUses: 1 }, { ...ctx, usesSoFar: 1 }, 'Este cupom já foi utilizado.'],
  ])('recusa: %s', (_, rule, context, message) => {
    expect(evaluateCoupon({ ...base, ...rule }, context)).toMatchObject({ ok: false, message });
  });

  it('validade é inclusiva nos dois extremos e não recusa cupom inexistente revelando detalhes', () => {
    expect(evaluateCoupon({ ...base, startsAt: '2026-10-15', endsAt: '2026-10-15' }, ctx).ok).toBe(true);
    expect(evaluateCoupon(null, ctx)).toMatchObject({ ok: false, reason: 'INVALID', message: 'Cupom inválido.' });
  });
});

describe('cadastro do cupom', () => {
  it('normaliza código, porcentagem e transforma exclusivo em uso único', () => {
    const c = couponSchema.parse({ code: ' zaraki 10 ', kind: 'PERCENT', percentOff: '10,5', maxUses: '50', exclusive: 'on', phone: '(62) 98109-2799', active: 'on' });
    expect(c).toMatchObject({ code: 'ZARAKI10', percentOff: '10.50', amountOffCents: null, maxUses: 1, phone: '+5562981092799', active: true });
  });

  it('valida campos conforme o tipo e as datas', () => {
    const r = couponSchema.safeParse({ code: 'X', kind: 'FIXED', amountOff: '', startsAt: '2026-10-20', endsAt: '2026-10-10', exclusive: 'on', phone: '12' });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.path[0]).sort()).toEqual(['amountOff', 'code', 'endsAt', 'phone']);
  });

  it('descreve o cupom em português e gera códigos legíveis', () => {
    const c = couponSchema.parse({ code: 'FESTA20', kind: 'FIXED', amountOff: '20', minTubes: '5', endsAt: '2026-10-31', maxUses: '50', active: 'on' });
    expect(describeCoupon(c)).toBe('R$ 20,00 de desconto nos produtos, a partir de 5 tubos, até 31/10/2026, limitado a 50 usos.');
    expect(generateCouponCode()).toMatch(/^ZK-[A-HJ-NP-Z2-9]{6}$/);
    expect(normalizeCouponCode(' ana 7k ')).toBe('ANA7K');
  });
});
