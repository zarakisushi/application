import { describe, expect, it } from 'vitest';
import {
  buildOrderMessage,
  formatBrPhone,
  formatCents,
  normalizeBrPhone,
  OrderError,
  priceOrder,
  publicOrderSchema,
  todayInZone,
  whatsappUrl,
  zonedTimeToUtc,
} from '../src';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';

describe('dinheiro e telefone', () => {
  it('formata centavos em reais', () => {
    expect(formatCents(5000)).toBe('R$ 50,00');
    expect(formatCents(123456)).toBe('R$ 1.234,56');
  });

  it.each([
    ['(62) 98109-2799', '+5562981092799'],
    ['62981092799', '+5562981092799'],
    ['+55 62 98109-2799', '+5562981092799'],
    ['062 3212-3456', '+556232123456'],
  ])('normaliza %s', (input, expected) => {
    expect(normalizeBrPhone(input)).toBe(expected);
  });

  it.each(['123', '(62) 88109-2799', '00 98109-2799', ''])('rejeita %s', (input) => {
    expect(normalizeBrPhone(input)).toBeNull();
  });

  it('formata telefone para exibição', () => {
    expect(formatBrPhone('+5562981092799')).toBe('(62) 98109-2799');
    expect(formatBrPhone('5562981092799')).toBe('(62) 98109-2799');
  });
});

describe('fuso horário', () => {
  it('converte horário de Goiânia (UTC-3) para UTC', () => {
    expect(zonedTimeToUtc('2026-10-20', '19:30').toISOString()).toBe('2026-10-20T22:30:00.000Z');
  });

  it('calcula "hoje" no fuso da unidade', () => {
    // 01:00 UTC do dia 21 ainda é dia 20 em São Paulo
    expect(todayInZone('America/Sao_Paulo', new Date('2026-10-21T01:00:00Z'))).toBe('2026-10-20');
  });
});

describe('validação do pedido do site', () => {
  const base = { name: 'Ana', phone: '(62) 98109-2799', paymentMethod: 'PIX' as const, items: [{ productId: P1, qty: 2 }] };

  it('delivery exige bairro e endereço', () => {
    const r = publicOrderSchema.safeParse({ ...base, type: 'DELIVERY' });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.path[0])).toEqual(['neighborhood', 'address']);
  });

  it('evento exige data e horário; festa também exige convidados', () => {
    const enc = publicOrderSchema.safeParse({ ...base, type: 'ENCOMENDA' });
    expect(enc.error!.issues.map((i) => i.path[0])).toEqual(['date', 'time']);

    const festa = publicOrderSchema.safeParse({ ...base, type: 'FESTA', date: '2026-10-20', time: '19:00' });
    expect(festa.error!.issues.map((i) => i.path[0])).toEqual(['guests']);
  });

  it('exige pelo menos um tubo e WhatsApp válido', () => {
    const r = publicOrderSchema.safeParse({ ...base, type: 'ENCOMENDA', date: '2026-10-20', time: '19:00', phone: '123', items: [] });
    expect(r.error!.issues.map((i) => i.message)).toEqual(
      expect.arrayContaining(['Informe um WhatsApp válido com DDD', 'Adicione pelo menos um tubo ao pedido.']),
    );
  });

  it('normaliza o telefone e aceita pedido completo', () => {
    const r = publicOrderSchema.parse({ ...base, type: 'DELIVERY', neighborhood: 'Setor Bueno', address: 'Rua T-30, 100' });
    expect(r.phone).toBe('+5562981092799');
    expect(r.notes).toBe('');
    expect(r.addressReference).toBe('');
  });

  it('o site exige a forma de pagamento (Pix ou cartão)', () => {
    const delivery = { ...base, type: 'DELIVERY' as const, neighborhood: 'Centro', address: 'Rua 1' };
    const { paymentMethod: _, ...semPagamento } = delivery;
    expect(publicOrderSchema.safeParse(semPagamento).error!.issues.map((i) => i.message)).toEqual(['Escolha a forma de pagamento.']);
    expect(publicOrderSchema.safeParse({ ...delivery, paymentMethod: 'DINHEIRO' }).success).toBe(false);
    expect(publicOrderSchema.parse({ ...delivery, paymentMethod: 'CARTAO_CREDITO' }).paymentMethod).toBe('CARTAO_CREDITO');
  });
});

describe('cálculo do pedido', () => {
  const menu = [
    { id: P1, name: 'Salmão', priceCents: 5000, costCents: 2000 },
    { id: P2, name: 'Especial', priceCents: 6000 },
  ];

  it('usa o preço do cardápio e soma itens repetidos', () => {
    const r = priceOrder(menu, [
      { productId: P1, qty: 1 },
      { productId: P2, qty: 2 },
      { productId: P1, qty: 1 },
    ]);
    expect(r.subtotalCents).toBe(2 * 5000 + 2 * 6000);
    expect(r.tubes).toBe(4);
    expect(r.lines.find((l) => l.productId === P1)).toMatchObject({ qty: 2, unitCostCents: 2000, lineTotalCents: 10000 });
  });

  it('recusa produto fora do cardápio ativo', () => {
    expect(() => priceOrder(menu, [{ productId: '33333333-3333-4333-8333-333333333333', qty: 1 }])).toThrow(OrderError);
  });
});

describe('mensagem do WhatsApp', () => {
  it('evento: diz que é para um evento e mostra convidados só quando informados', () => {
    const base = { type: 'ENCOMENDA' as const, name: 'Ana', phone: '+5562981092799', date: '2026-10-20', time: '19:00', lines: [], totalCents: 0 };
    expect(buildOrderMessage(base)).toContain('Quero fazer um pedido de Push Pop Sushi para um evento.');
    expect(buildOrderMessage(base)).not.toContain('Convidados');
    expect(buildOrderMessage({ ...base, guests: 40 })).toContain('Convidados: 40');
    expect(buildOrderMessage({ ...base, type: 'DELIVERY' })).toContain('Quero fazer um pedido de Push Pop Sushi.');
  });

  it('inclui o ponto de referência e a forma de pagamento escolhidos no site', () => {
    const text = buildOrderMessage({
      type: 'DELIVERY',
      name: 'Ana',
      phone: '+5562981092799',
      neighborhood: 'Setor Bueno',
      address: 'Rua T-30, 100',
      addressReference: 'Portão azul',
      paymentMethod: 'CARTAO_CREDITO',
      lines: [{ productName: 'Salmão', qty: 1, lineTotalCents: 5000 }],
      totalCents: 5000,
    });
    expect(text).toContain('Endereço: Rua T-30, 100\nPonto de referência: Portão azul');
    expect(text).toContain('Total estimado: R$ 50,00\nPagamento: Cartão de crédito');
  });

  it('monta a mensagem da festa com código, data e itens', () => {
    const text = buildOrderMessage({
      code: 'ZK-000042',
      type: 'FESTA',
      name: 'Ana',
      phone: '+5562981092799',
      date: '2026-10-20',
      time: '19:00',
      address: 'Rua T-30, 100',
      guests: 30,
      lines: [{ productName: 'Salmão', qty: 2, lineTotalCents: 10000 }],
      totalCents: 10000,
      notes: 'Sem gergelim',
    });
    expect(text).toBe(
      [
        'Olá, Zaraki Sushi! Quero fazer um pedido de Push Pop Sushi para uma festa.',
        'Pedido: ZK-000042',
        '',
        'Tipo: Festa',
        'Nome: Ana',
        'WhatsApp: (62) 98109-2799',
        'Data: 20/10/2026 às 19:00',
        'Endereço: Rua T-30, 100',
        'Convidados: 30',
        '',
        '• 2x Salmão (R$ 100,00)',
        'Total estimado: R$ 100,00',
        '',
        'Obs: Sem gergelim',
      ].join('\n'),
    );
  });

  it('gera o link wa.me com o texto codificado', () => {
    expect(whatsappUrl('+55 (62) 98109-2799', 'Olá & tchau')).toBe('https://wa.me/5562981092799?text=Ol%C3%A1%20%26%20tchau');
  });
});
