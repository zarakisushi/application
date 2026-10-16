import { describe, expect, it } from 'vitest';
import {
  adminOrderSchema,
  centsToInput,
  customerSchema,
  fieldErrors,
  nextStage,
  parseMoneyToCents,
  maskMoneyInput,
  finishMoneyInput,
  productSchema,
  slugify,
  tenantSchema,
  userSchema,
} from '../src';

describe('valores e textos', () => {
  it.each([
    ['50', 5000],
    ['50,5', 5050],
    ['R$ 60,00', 6000],
    ['1.234,56', 123456],
    ['12.5', 1250],
    ['1.200', 120000],
    ['3.500', 350000],
    ['1.234.567', 123456700],
    ['0', 0],
  ])('converte "%s" para %i centavos', (input, cents) => {
    expect(parseMoneyToCents(input)).toBe(cents);
  });

  it.each(['', 'abc', '-5', '1,234'])('recusa "%s"', (input) => {
    expect(parseMoneyToCents(input)).toBeNull();
  });

  it('formata centavos para campo de formulário', () => {
    expect(centsToInput(5000)).toBe('50,00');
  });

  it('gera slug sem acentos nem símbolos', () => {
    expect(slugify('Uramaki de Salmão & Manga!')).toBe('uramaki-de-salmao-manga');
  });
});

describe('etapas do pedido', () => {
  it('segue o fluxo até a entrega e para nos estados finais', () => {
    expect(nextStage('NOVO')).toBe('CONFIRMADO');
    expect(nextStage('SAIU_PARA_ENTREGA')).toBe('ENTREGUE');
    expect(nextStage('ENTREGUE')).toBeNull();
    expect(nextStage('CANCELADO')).toBeNull();
  });
});

describe('formulários do painel', () => {
  it('produto: preço obrigatório, custo opcional e checkbox do HTML', () => {
    const ok = productSchema.parse({ name: 'Salmão', price: '50,00', cost: '', isSpecial: 'on', sortOrder: '2' });
    expect(ok).toMatchObject({ price: 5000, cost: 0, isSpecial: true, sortOrder: 2, imageUrl: null });

    const bad = productSchema.safeParse({ name: 'S', price: '', imageUrl: 'ftp://x' });
    expect(fieldErrors(bad.error!)).toMatchObject({
      name: 'Informe o nome do sabor',
      price: 'Informe o preço de venda',
      imageUrl: 'Use um caminho do site (/menu/...) ou um endereço https://',
    });
  });

  it('cliente: normaliza telefone e transforma campos vazios em null', () => {
    const c = customerSchema.parse({ name: 'Ana', phone: '(62) 98109-2799', email: '', birthday: '1990-05-20' });
    expect(c).toMatchObject({ phone: '+5562981092799', email: null, birthday: '1990-05-20', notes: null });
  });

  it('usuário: e-mail em minúsculas e papel obrigatório', () => {
    expect(userSchema.parse({ name: 'Ana', email: ' Ana@Zaraki.com ', role: 'GERENTE' })).toMatchObject({
      email: 'ana@zaraki.com',
      isPlatformAdmin: false,
    });
    expect(userSchema.safeParse({ name: 'Ana', email: 'ana@zaraki.com', role: 'DONO' }).success).toBe(false);
  });

  it('unidade: valida slug, CNPJ, prefixo e royalties', () => {
    const t = tenantSchema.parse({
      name: 'Zaraki Setor Bueno',
      slug: 'setor-bueno',
      cnpj: '12.345.678/0001-90',
      whatsappNumber: '62 98888-7777',
      royaltyPct: '6,5',
      orderCodePrefix: 'zkb',
    });
    expect(t).toMatchObject({ whatsappNumber: '+5562988887777', royaltyPct: '6.50', orderCodePrefix: 'ZKB', calendarId: null });

    const bad = tenantSchema.safeParse({ name: 'X Y Z', slug: 'Setor Bueno', cnpj: '123', orderCodePrefix: 'Z1', royaltyPct: '150' });
    expect(Object.keys(fieldErrors(bad.error!)).sort()).toEqual(['cnpj', 'orderCodePrefix', 'royaltyPct', 'slug']);
  });

  it('pedido do painel: aceita valores digitados e convidados como texto', () => {
    const o = adminOrderSchema.parse({
      type: 'FESTA',
      name: 'Ana',
      phone: '62981092799',
      source: 'WHATSAPP',
      date: '2026-12-20',
      time: '20:00',
      guests: '40',
      discount: '10,00',
      deliveryFee: '15',
      paymentMethod: 'PIX',
      paid: 'on',
      items: [{ productId: '11111111-1111-4111-8111-111111111111', qty: 3 }],
    });
    expect(o).toMatchObject({ guests: 40, discount: 1000, deliveryFee: 1500, paymentMethod: 'PIX', paid: true });
  });
});

describe('máscara de reais', () => {
  it.each([
    ['3500', '3.500'],
    ['3500,5', '3.500,5'],
    ['1234567,891', '1.234.567,89'],
    ['1.200', '1.200'],
    ['12.5', '12,5'],
    ['12.50', '12,50'],
    ['0050', '50'],
    [',5', '0,5'],
    ['R$ 60,00', '60,00'],
    ['1,2,3', '1,23'],
    ['abc', ''],
  ])('digitando "%s" mostra "%s"', (raw, shown) => {
    expect(maskMoneyInput(raw)).toBe(shown);
  });

  it('sinal de menos só quando o campo aceita negativo', () => {
    expect(maskMoneyInput('-1200,5', { allowNegative: true })).toBe('-1.200,5');
    expect(maskMoneyInput('-1200,5')).toBe('1.200,5');
  });

  it('ao sair do campo completa os centavos, e o valor continua válido', () => {
    expect(finishMoneyInput('3.500')).toBe('3.500,00');
    expect(finishMoneyInput('12,5')).toBe('12,50');
    expect(finishMoneyInput('')).toBe('');
    expect(parseMoneyToCents(finishMoneyInput(maskMoneyInput('1234567,8')))).toBe(123456780);
  });
});
