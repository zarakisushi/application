import { describe, expect, it } from 'vitest';
import { formatDocument, isValidCnpj, isValidCpf, supplierSchema, supplierWhatsappUrl, telHref } from '../src';

describe('documentos', () => {
  it('confere os dígitos do CNPJ e do CPF', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11.222.333/0001-82')).toBe(false);
    expect(isValidCnpj('11111111111111')).toBe(false);
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('529.982.247-26')).toBe(false);
    expect(formatDocument('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatDocument('52998224725')).toBe('529.982.247-25');
  });
});

describe('cadastro do fornecedor', () => {
  const base = { name: 'Peixaria Goiás', whatsapp: '62 98109-2799' };

  it('normaliza telefones, CNPJ, CEP, UF, listas e pedido mínimo', () => {
    const s = supplierSchema.parse({
      ...base,
      document: '11.222.333/0001-81',
      phone: '(62) 3241-0000',
      cep: '74000-000',
      state: 'go',
      categories: 'PEIXES,MERCEARIA,PEIXES',
      deliveryDays: '5,2',
      paymentMethods: 'PIX,BOLETO',
      minOrder: '300,00',
      rating: '4',
      email: 'Vendas@Peixaria.com.br',
    });
    expect(s).toMatchObject({
      personKind: 'PJ',
      whatsapp: '+5562981092799',
      phone: '+556232410000',
      document: '11222333000181',
      cep: '74000000',
      state: 'GO',
      categories: ['PEIXES', 'MERCEARIA'],
      deliveryDays: [2, 5],
      paymentMethods: ['PIX', 'BOLETO'],
      minOrder: 30000,
      rating: 4,
      email: 'vendas@peixaria.com.br',
      networkShared: false,
    });
  });

  it('recusa documento inválido, contato ausente e campos inválidos', () => {
    const errors = (input: Record<string, unknown>) => [...new Set(supplierSchema.safeParse(input).error?.issues.map((i) => String(i.path[0])) ?? [])];
    expect(errors({ ...base, document: '11.222.333/0001-82' })).toEqual(['document']);
    expect(errors({ ...base, personKind: 'PF', document: '529.982.247-25' })).toEqual([]);
    expect(errors({ name: 'Sem contato' })).toEqual(['whatsapp']);
    expect(errors({ ...base, whatsapp: '123' })).toContain('whatsapp');
    expect(errors({ ...base, cep: '7400' })).toEqual(['cep']);
    expect(errors({ ...base, state: 'XX' })).toEqual(['state']);
    expect(errors({ ...base, categories: 'PEIXES,FOO' })).toEqual(['categories']);
  });

  it('links de WhatsApp e ligação', () => {
    expect(supplierWhatsappUrl('+5562981092799', 'Zaraki Sushi — Matriz')).toBe(
      `https://wa.me/5562981092799?text=${encodeURIComponent('Olá! Aqui é da Zaraki Sushi — Matriz.')}`,
    );
    expect(telHref('+556232410000')).toBe('tel:+556232410000');
  });
});
