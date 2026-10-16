import { describe, expect, it } from 'vitest';
import { formatQty, formatUnitCost, parseQuantity, recipeCostCents, stockPurchaseSchema, stockSituation, SUGGESTED_STOCK_ITEMS } from '../src';

const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';

describe('quantidades do estoque', () => {
  it.each([
    ['1,5', 1.5],
    ['0,080', 0.08],
    ['1.000', 1000],
    ['1.250,75', 1250.75],
    ['2', 2],
    ['2.5', 2.5],
  ])('"%s" vira %d', (raw, n) => {
    expect(parseQuantity(raw)).toBe(n);
  });
  it('recusa texto e vazio', () => {
    expect(parseQuantity('')).toBeNull();
    expect(parseQuantity('abc')).toBeNull();
  });
  it('formata com unidade', () => {
    expect(formatQty(1.5, 'kg')).toBe('1,5 kg');
    expect(formatQty(1000, 'un')).toBe('1.000 un');
  });
});

describe('situação e custos', () => {
  it('zerado, abaixo do mínimo ou em dia', () => {
    expect(stockSituation(0, 5)).toBe('ZERADO');
    expect(stockSituation(-1, 0)).toBe('ZERADO');
    expect(stockSituation(3, 5)).toBe('BAIXO');
    expect(stockSituation(5, 5)).toBe('OK');
    expect(stockSituation(1, 0)).toBe('OK');
  });
  it('custo da ficha técnica soma quantidade × custo médio e conta os itens sem custo', () => {
    expect(recipeCostCents([{ qty: 0.08, unitCostCents: 9000 }, { qty: 1, unitCostCents: 60 }, { qty: 0.01, unitCostCents: null }])).toEqual({ cents: 780, missing: 1 });
  });
  it('custo por unidade com fração de centavo', () => {
    expect(formatUnitCost(9000, 'kg')).toBe('R$ 90,00 / kg');
    expect(formatUnitCost(0.85, 'g')).toBe('R$ 0,0085 / g');
  });
  it('lista sugerida tem tubos, adesivos e panfletos', () => {
    expect(SUGGESTED_STOCK_ITEMS.map((i) => i.name)).toEqual(expect.arrayContaining(['Tubo Push Pop', 'Adesivo de lacre', 'Panfleto', 'Salmão']));
  });
});

describe('formulário de compra', () => {
  const base = { supplier: 'Peixaria', purchasedOn: '2026-10-10', dueDate: '2026-10-20' };
  it('converte quantidades e valores das linhas', () => {
    const r = stockPurchaseSchema.parse({ ...base, lines: [{ itemId: ID1, qty: '1.000', total: '600,00' }] });
    expect(r.lines).toEqual([{ itemId: ID1, qty: 1000, totalCents: 60000 }]);
    expect(r.paidOn).toBeNull();
  });
  it('recusa item repetido, linha sem valor e compra paga sem conta', () => {
    const r = stockPurchaseSchema.safeParse({
      ...base,
      paid: 'on',
      paidOn: '2026-10-10',
      lines: [
        { itemId: ID2, qty: '1', total: '' },
        { itemId: ID2, qty: '2', total: '10' },
      ],
    });
    expect(r.error!.issues.map((i) => i.message)).toEqual(
      expect.arrayContaining(['Escolha a conta', 'Informe o valor de cada item', 'O mesmo item aparece duas vezes: some as quantidades numa linha só']),
    );
  });
});
