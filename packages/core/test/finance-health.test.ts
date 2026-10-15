import { describe, expect, it } from 'vitest';
import { buildDre, computeDre, healthIndicators, statementIndicator, statementSchema, type DreMonth, type HealthInput } from '../src';

describe('DRE gerencial', () => {
  const rows = [
    { dreGroup: 'RECEITA', direction: 'ENTRADA', cents: 100_000_00 },
    { dreGroup: 'CUSTO_VARIAVEL', direction: 'SAIDA', cents: 40_000_00 },
    { dreGroup: 'CUSTO_VARIAVEL', direction: 'ENTRADA', cents: 1_000_00 }, // devolução de insumo
    { dreGroup: 'DESPESA_FIXA', direction: 'SAIDA', cents: 30_000_00 },
    { dreGroup: 'IMPOSTOS', direction: 'SAIDA', cents: 6_000_00 },
    { dreGroup: 'ROYALTIES', direction: 'SAIDA', cents: 5_000_00 },
    { dreGroup: 'FINANCEIRO', direction: 'ENTRADA', cents: 10_000_00 }, // aporte
    { dreGroup: 'FINANCEIRO', direction: 'SAIDA', cents: 500_00 },
    { dreGroup: 'INVESTIMENTO', direction: 'SAIDA', cents: 8_000_00 },
  ] as const;

  it('calcula margem de contribuição, resultado operacional e do período', () => {
    expect(computeDre([...rows])).toEqual({
      receita: 100_000_00,
      custosVariaveis: 39_000_00,
      margemContribuicao: 61_000_00,
      despesasFixas: 30_000_00,
      impostos: 6_000_00,
      royalties: -5_000_00,
      resultadoOperacional: 20_000_00,
      financeiro: 9_500_00,
      investimentos: 8_000_00,
      outros: 0,
      resultado: 21_500_00,
    });
  });

  it('na Matriz, royalties recebidos aumentam o resultado', () => {
    expect(computeDre([{ dreGroup: 'ROYALTIES', direction: 'ENTRADA', cents: 7_000_00 }]).resultadoOperacional).toBe(7_000_00);
  });

  it('separa os meses', () => {
    const dre = buildDre(
      [
        { month: '2026-09', dreGroup: 'RECEITA', direction: 'ENTRADA', cents: 100 },
        { month: '2026-10', dreGroup: 'RECEITA', direction: 'ENTRADA', cents: 300 },
      ],
      ['2026-09', '2026-10', '2026-11'],
    );
    expect(dre.map((m) => [m.month, m.values.receita])).toEqual([
      ['2026-09', 100],
      ['2026-10', 300],
      ['2026-11', 0],
    ]);
  });
});

describe('semáforo de saúde', () => {
  const dre = (v: Partial<DreMonth>): DreMonth => ({ ...computeDre([]), ...v });
  const base: HealthInput = {
    balanceCents: 90_000_00,
    avgMonthlyOutCents: 25_000_00,
    dre: dre({ receita: 100_000_00, margemContribuicao: 65_000_00, despesasFixas: 40_000_00, impostos: 6_000_00, resultadoOperacional: 15_000_00 }),
    cmvCents: 30_000_00,
    theoreticalCmv: { costCents: 28_000_00, salesCents: 100_000_00 },
    overduePayables: { count: 0, cents: 0 },
    overdueReceivables: { count: 0, cents: 0 },
    projectedMin: { cents: 40_000_00, date: '2026-11-10' },
  };
  const tone = (input: HealthInput) => Object.fromEntries(healthIndicators(input).map((i) => [i.key, i.tone]));

  it('empresa saudável fica toda verde', () => {
    expect(tone(base)).toEqual({ folego: 'good', previsto: 'good', margem: 'good', cmv: 'good', equilibrio: 'good', vencidas: 'good' });
    const folego = healthIndicators(base).find((i) => i.key === 'folego')!;
    expect(folego.value).toBe('3,6 meses');
    expect(folego.message).toContain('cobre 3,6 meses');
  });

  it('caixa curto, prejuízo, CMV alto e conta vencida acendem o vermelho', () => {
    const t = tone({
      ...base,
      balanceCents: 10_000_00,
      dre: dre({ receita: 100_000_00, margemContribuicao: 50_000_00, despesasFixas: 55_000_00, impostos: 5_000_00, resultadoOperacional: -10_000_00 }),
      cmvCents: 45_000_00,
      overduePayables: { count: 2, cents: 3_000_00 },
      projectedMin: { cents: -2_000_00, date: '2026-11-05' },
    });
    expect(t).toMatchObject({ folego: 'bad', previsto: 'bad', margem: 'bad', cmv: 'bad', equilibrio: 'bad', vencidas: 'bad' });
  });

  it('CMV real bem acima das fichas aponta possível desperdício', () => {
    const cmv = healthIndicators({ ...base, cmvCents: 34_000_00, theoreticalCmv: { costCents: 25_000_00, salesCents: 100_000_00 } }).find((i) => i.key === 'cmv')!;
    expect(cmv.tone).toBe('warn');
    expect(cmv.message).toContain('desperdício');
  });

  it('ponto de equilíbrio: quanto precisaria vender', () => {
    const eq = healthIndicators(base).find((i) => i.key === 'equilibrio')!;
    // fixas + impostos = 46.000; margem de contribuição = 65% → 70.769,23
    expect(eq.value).toBe('R$ 70.769,23');
  });

  it('sem histórico, fôlego fica neutro; sem receita, margem neutra', () => {
    const t = tone({ ...base, avgMonthlyOutCents: 0, dre: dre({}) });
    expect([t.folego, t.margem]).toEqual(['neutral', 'neutral']);
  });
});

describe('conferência bancária', () => {
  const today = '2026-10-15';
  it('verde com extrato recente que confere', () => {
    expect(statementIndicator([{ accountName: 'Conta bancária', lastDate: '2026-10-10', lastDiffCents: 0 }], today)).toMatchObject({ tone: 'good', value: 'Em dia' });
  });
  it('pede extrato quando nunca enviou ou o último é antigo', () => {
    expect(statementIndicator([{ accountName: 'Conta bancária', lastDate: null, lastDiffCents: null }], today)).toMatchObject({ tone: 'warn', value: 'sem extrato' });
    const old = statementIndicator([{ accountName: 'Conta bancária', lastDate: '2026-09-02', lastDiffCents: 0 }], today)!;
    expect(old).toMatchObject({ tone: 'warn', value: 'há 43 dias' });
    expect(old.message).toBe('Envie o extrato da Conta bancária: o último é de 02/09/2026.');
  });
  it('avisa a diferença do último extrato', () => {
    const r = statementIndicator([{ accountName: 'Conta bancária', lastDate: '2026-10-10', lastDiffCents: 12_345 }], today)!;
    expect(r.tone).toBe('warn');
    expect(r.message).toContain('a mais do que o sistema');
  });
  it('sem conta bancária, não mostra o indicador', () => {
    expect(statementIndicator([], today)).toBeNull();
  });
});

describe('formulário de extrato', () => {
  const id = '0b0f6a52-4a35-4d0c-9b8d-2f7a2c3a9e11';
  it('aceita saldo negativo e remove arquivos repetidos', () => {
    expect(statementSchema.parse({ statementDate: '2026-10-10', balance: '-1.250,00', attachmentIds: [id, id] })).toEqual({
      statementDate: '2026-10-10',
      balanceCents: -125000,
      attachmentIds: [id],
      notes: null,
    });
  });
  it('exige ao menos um arquivo e o saldo', () => {
    const r = statementSchema.safeParse({ statementDate: '2026-10-10', balance: '', attachmentIds: [] });
    expect(r.error!.issues.map((i) => i.path[0]).sort()).toEqual(['attachmentIds', 'balance']);
  });
});
