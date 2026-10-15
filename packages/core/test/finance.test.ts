import { describe, expect, it } from 'vitest';
import {
  addMonths,
  buildSeries,
  can,
  DEFAULT_FINANCE_ACCOUNTS,
  DEFAULT_FINANCE_CATEGORIES,
  entrySituation,
  entrySituationLabel,
  financeAccountSchema,
  financeEntrySchema,
  formatAuditValue,
  monthRange,
  transferSchema,
} from '../src';

const CAT = '0b0f6a52-4a35-4d0c-9b8d-2f7a2c3a9e11';
const ACC = '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f';

describe('datas do financeiro', () => {
  it('soma meses respeitando o fim do mês', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonths('2026-03-10', -3)).toBe('2025-12-10');
  });

  it('dá o primeiro e o último dia do mês', () => {
    expect(monthRange('2026-02-14')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2026-12-01')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});

describe('situação do lançamento', () => {
  const today = '2026-10-14';
  it('pago, vencido, vence hoje e em aberto', () => {
    expect(entrySituation({ paidOn: '2026-10-01', dueDate: '2026-09-01' }, today)).toBe('PAGO');
    expect(entrySituation({ paidOn: null, dueDate: '2026-10-13' }, today)).toBe('VENCIDO');
    expect(entrySituation({ paidOn: null, dueDate: today }, today)).toBe('HOJE');
    expect(entrySituation({ paidOn: null, dueDate: '2026-10-20' }, today)).toBe('ABERTO');
  });

  it('rótulos mudam conforme entrada ou saída', () => {
    expect(entrySituationLabel('PAGO', 'ENTRADA')).toBe('Recebido');
    expect(entrySituationLabel('PAGO', 'SAIDA')).toBe('Pago');
    expect(entrySituationLabel('ABERTO', 'ENTRADA')).toBe('A receber');
    expect(entrySituationLabel('ABERTO', 'SAIDA')).toBe('A pagar');
  });
});

describe('recorrência e parcelas', () => {
  const base = { description: 'Aluguel', amountCents: 350000, competenceDate: '2026-01-31', dueDate: '2026-02-10' };

  it('sem repetição gera um lançamento', () => {
    expect(buildSeries({ ...base, repeat: 'NAO', count: 1 })).toEqual([{ ...base, installment: null, installments: null }]);
  });

  it('mensal repete o mesmo valor, mês a mês', () => {
    const s = buildSeries({ ...base, repeat: 'MENSAL', count: 3 });
    expect(s.map((i) => [i.description, i.amountCents, i.competenceDate, i.dueDate, i.installment])).toEqual([
      ['Aluguel', 350000, '2026-01-31', '2026-02-10', 1],
      ['Aluguel', 350000, '2026-02-28', '2026-03-10', 2],
      ['Aluguel', 350000, '2026-03-31', '2026-04-10', 3],
    ]);
  });

  it('parcelado divide o total e põe o centavo restante na última parcela', () => {
    const s = buildSeries({ ...base, description: 'Freezer', amountCents: 100000, repeat: 'PARCELADO', count: 3 });
    expect(s.map((i) => [i.description, i.amountCents])).toEqual([
      ['Freezer (1/3)', 33333],
      ['Freezer (2/3)', 33333],
      ['Freezer (3/3)', 33334],
    ]);
    expect(s.reduce((t, i) => t + i.amountCents, 0)).toBe(100000);
  });
});

describe('formulário de lançamento', () => {
  const valid = { direction: 'SAIDA', description: 'Salmão', amount: '1.250,50', categoryId: CAT, competenceDate: '2026-10-01', dueDate: '2026-10-10' };

  it('converte valores e deixa em aberto quando não pago', () => {
    const r = financeEntrySchema.parse(valid);
    expect(r).toMatchObject({ amountCents: 125050, paidOn: null, accountId: null, repeat: 'NAO', repeatCount: 1, counterparty: null });
  });

  it('pago exige data e conta', () => {
    const r = financeEntrySchema.safeParse({ ...valid, paid: 'on' });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.path[0]).sort()).toEqual(['accountId', 'paidOn']);
    expect(financeEntrySchema.parse({ ...valid, paid: 'on', paidOn: '2026-10-02', accountId: ACC })).toMatchObject({ paidOn: '2026-10-02', accountId: ACC });
  });

  it('recusa valor zero e repetição de uma vez só', () => {
    const r = financeEntrySchema.safeParse({ ...valid, amount: '0', repeat: 'MENSAL', repeatCount: '1' });
    expect(r.error!.issues.map((i) => i.path[0]).sort()).toEqual(['amount', 'repeatCount']);
  });

  it('desmarcar "pago" descarta a data de pagamento', () => {
    expect(financeEntrySchema.parse({ ...valid, paidOn: '2026-10-02', accountId: ACC }).paidOn).toBeNull();
  });
});

describe('contas e transferências', () => {
  it('aceita saldo inicial negativo (conta no cheque especial)', () => {
    const r = financeAccountSchema.parse({ name: 'Banco', kind: 'BANCO', openingBalance: '-1.200,00', openingDate: '2026-10-01', active: 'on' });
    expect(r).toMatchObject({ openingBalance: -120000, receivesMethods: [], active: true });
  });

  it('transferência precisa de contas diferentes e valor', () => {
    const r = transferSchema.safeParse({ fromAccountId: ACC, toAccountId: ACC, amount: '', date: '2026-10-01' });
    expect(r.error!.issues.map((i) => i.path[0]).sort()).toEqual(['amount', 'toAccountId']);
  });
});

describe('cadastros padrão e permissões', () => {
  it('toda forma de pagamento cai em exatamente uma conta padrão', () => {
    const methods = DEFAULT_FINANCE_ACCOUNTS.flatMap((a) => a.receivesMethods).sort();
    expect(methods).toEqual(['CARTAO_CREDITO', 'CARTAO_DEBITO', 'DINHEIRO', 'OUTRO', 'PIX']);
  });

  it('categorias do sistema existem e são únicas', () => {
    const keys = DEFAULT_FINANCE_CATEGORIES.flatMap((c) => (c.systemKey ? [c.systemKey] : []));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(expect.arrayContaining(['VENDAS', 'ROYALTIES_PAGOS', 'ROYALTIES_RECEBIDOS', 'AJUSTE_ENTRADA', 'AJUSTE_SAIDA']));
  });

  it('gerente vê e lança; só o administrador gerencia; atendente não vê', () => {
    const gerente = { role: 'GERENTE' as const, platformAdmin: false };
    const atendente = { role: 'ATENDENTE' as const, platformAdmin: false };
    const admin = { role: 'ADMIN' as const, platformAdmin: false };
    expect([can(gerente, 'finance:read'), can(gerente, 'finance:write'), can(gerente, 'finance:manage')]).toEqual([true, true, false]);
    expect(can(atendente, 'finance:read')).toBe(false);
    expect(can(admin, 'finance:manage')).toBe(true);
  });

  it('auditoria mostra os campos do financeiro em português', () => {
    expect(formatAuditValue('direction', 'SAIDA', 'UTC')).toBe('Saída');
    expect(formatAuditValue('receives_methods', ['PIX', 'DINHEIRO'], 'UTC')).toBe('Pix, Dinheiro');
    expect(formatAuditValue('amount_cents', 12345, 'UTC')).toBe('R$ 123,45');
  });
});
