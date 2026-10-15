import { buildDre, computeDre, DRE_GROUP_LABEL, DRE_LINES, todayInZone, type DreGroup, type DreRow, type FinanceDirection } from '@zaraki/core';
import { sql } from 'drizzle-orm';
import { pct, query, tenantArray, type ReportDefinition, type ReportParams } from './types';

// Relatórios do financeiro. Com "Todas as unidades" (Matriz), os valores são consolidados da rede.

const entries = (p: ReportParams) => sql`e.status and e.tenant_id = any(${tenantArray(p)})`;

/** Meses ("AAAA-MM") do período do relatório. */
function monthsOf(p: ReportParams) {
  const out: string[] = [];
  let [y, m] = p.from.split('-').map(Number) as [number, number];
  const end = p.to.slice(0, 7);
  for (let s = `${y}-${String(m).padStart(2, '0')}`; s <= end; ) {
    out.push(s);
    m += 1;
    if (m > 12) [y, m] = [y + 1, 1];
    s = `${y}-${String(m).padStart(2, '0')}`;
  }
  return out;
}

const MONTH_LABEL = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const monthLabel = (ym: string) => `${MONTH_LABEL[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`;

const dre: ReportDefinition = {
  slug: 'dre',
  group: 'Financeiro',
  title: 'DRE gerencial',
  description: 'Receitas, custos e despesas por competência, mês a mês: margem de contribuição e resultado.',
  permission: 'finance:read',
  async run(tx, p) {
    const months = monthsOf(p);
    const rows = await query<{ month: string; dre_group: DreGroup; direction: FinanceDirection; cents: number }>(
      tx,
      sql`select to_char(e.competence_date, 'YYYY-MM') as month, c.dre_group, e.direction, sum(e.amount_cents)::float8 as cents
            from finance_entries e join finance_categories c on c.id = e.category_id
           where ${entries(p)} and e.competence_date between ${p.from}::date and ${p.to}::date
           group by 1, 2, 3`,
    );
    const dreRows: DreRow[] = rows.map((r) => ({ month: r.month, dreGroup: r.dre_group, direction: r.direction, cents: r.cents }));
    const byMonth = buildDre(dreRows, months);
    const total = buildDre(dreRows.map((r) => ({ ...r, month: 'total' })), ['total'])[0]!.values;
    const data = DRE_LINES.map((line) => ({
      linha: line.label,
      ...Object.fromEntries(byMonth.map((m) => [`m${m.month}`, m.values[line.key]])),
      total: total[line.key],
    }));
    return {
      summary: [
        { label: 'Receita', value: total.receita, format: 'money' },
        { label: 'Margem de contribuição', value: total.receita ? pct(total.margemContribuicao, total.receita) : null, format: 'percent' },
        { label: 'Resultado operacional', value: total.resultadoOperacional, format: 'money' },
        { label: 'Resultado do período', value: total.resultado, format: 'money' },
      ],
      columns: [
        { key: 'linha', label: 'Linha' },
        ...months.map((m) => ({ key: `m${m}`, label: monthLabel(m), format: 'money' as const })),
        { key: 'total', label: 'Total', format: 'money' },
      ],
      rows: data,
      chart: {
        type: 'bar',
        x: 'mes',
        format: 'money',
        series: [
          { key: 'receita', label: 'Receita' },
          { key: 'resultado', label: 'Resultado operacional' },
        ],
        data: byMonth.map((m) => ({ mes: monthLabel(m.month), receita: m.values.receita, resultado: m.values.resultadoOperacional })),
      },
      note: 'Competência: cada lançamento conta no mês a que se refere, pago ou não. Transferências entre contas não entram.',
    };
  },
};

const fluxo: ReportDefinition = {
  slug: 'fluxo-caixa',
  group: 'Financeiro',
  title: 'Fluxo de caixa',
  description: 'Entradas e saídas efetivamente pagas, mês a mês, com o saldo das contas ao fim de cada mês.',
  permission: 'finance:read',
  async run(tx, p) {
    const months = monthsOf(p);
    const rows = await query<{ month: string; income: number; expense: number }>(
      tx,
      sql`select to_char(e.paid_on, 'YYYY-MM') as month,
                 coalesce(sum(e.amount_cents) filter (where e.direction = 'ENTRADA'), 0)::float8 as income,
                 coalesce(sum(e.amount_cents) filter (where e.direction = 'SAIDA'), 0)::float8 as expense
            from finance_entries e
           where ${entries(p)} and e.origin <> 'TRANSFERENCIA' and e.paid_on between ${p.from}::date and ${p.to}::date
           group by 1`,
    );
    const [opening] = await query<{ cents: number }>(
      tx,
      sql`select (
            coalesce((select sum(opening_balance_cents) from finance_accounts
                       where status and tenant_id = any(${tenantArray(p)}) and opening_date < ${p.from}::date), 0)
          + coalesce((select sum(case when e.direction = 'ENTRADA' then e.amount_cents else -e.amount_cents end)
                        from finance_entries e join finance_accounts a on a.id = e.account_id and a.status
                       where ${entries(p)} and e.paid_on < ${p.from}::date), 0))::float8 as cents`,
    );
    // Contas abertas dentro do período entram com o saldo inicial no mês da abertura.
    const openings = await query<{ month: string; cents: number }>(
      tx,
      sql`select to_char(opening_date, 'YYYY-MM') as month, sum(opening_balance_cents)::float8 as cents
            from finance_accounts
           where status and tenant_id = any(${tenantArray(p)}) and opening_date between ${p.from}::date and ${p.to}::date
           group by 1`,
    );
    let balance = opening?.cents ?? 0;
    const data = months.map((m) => {
      const r = rows.find((x) => x.month === m);
      const entradas = r?.income ?? 0;
      const saidas = r?.expense ?? 0;
      const inicial = balance;
      balance = inicial + (openings.find((o) => o.month === m)?.cents ?? 0) + entradas - saidas;
      return { mes: `${m}-01`, inicial, entradas, saidas, resultado: entradas - saidas, final: balance };
    });
    const sum = (k: 'entradas' | 'saidas') => data.reduce((s, r) => s + r[k], 0);
    return {
      summary: [
        { label: 'Entradas', value: sum('entradas'), format: 'money' },
        { label: 'Saídas', value: sum('saidas'), format: 'money' },
        { label: 'Resultado de caixa', value: sum('entradas') - sum('saidas'), format: 'money' },
        { label: 'Saldo ao fim do período', value: balance, format: 'money' },
      ],
      columns: [
        { key: 'mes', label: 'Mês', format: 'month' },
        { key: 'inicial', label: 'Saldo inicial', format: 'money' },
        { key: 'entradas', label: 'Entradas', format: 'money' },
        { key: 'saidas', label: 'Saídas', format: 'money' },
        { key: 'resultado', label: 'Resultado', format: 'money' },
        { key: 'final', label: 'Saldo final', format: 'money' },
      ],
      rows: data,
      chart: {
        type: 'bar',
        x: 'mes',
        xFormat: 'month',
        format: 'money',
        series: [
          { key: 'entradas', label: 'Entradas' },
          { key: 'saidas', label: 'Saídas' },
        ],
      },
      note: 'Regime de caixa: conta a data do pagamento. Transferências entre contas não entram.',
    };
  },
};

const despesasCategoria: ReportDefinition = {
  slug: 'despesas-categoria',
  group: 'Financeiro',
  title: 'Despesas por categoria',
  description: 'Para onde vai o dinheiro: saídas do período por categoria e grupo, com a participação de cada uma.',
  permission: 'finance:read',
  async run(tx, p) {
    const rows = await query<{ categoria: string; grupo: DreGroup; lancamentos: number; valor: number }>(
      tx,
      sql`select c.name as categoria, c.dre_group as grupo, count(*)::int as lancamentos, sum(e.amount_cents)::float8 as valor
            from finance_entries e join finance_categories c on c.id = e.category_id
           where ${entries(p)} and e.direction = 'SAIDA' and e.competence_date between ${p.from}::date and ${p.to}::date
           group by c.name, c.dre_group order by valor desc`,
    );
    const total = rows.reduce((s, r) => s + r.valor, 0);
    const data = rows.map((r) => ({ ...r, grupo: DRE_GROUP_LABEL[r.grupo], participacao: pct(r.valor, total) }));
    return {
      summary: [
        { label: 'Total de saídas', value: total, format: 'money' },
        { label: 'Maior categoria', value: rows[0]?.categoria ?? '—' },
      ],
      columns: [
        { key: 'categoria', label: 'Categoria' },
        { key: 'grupo', label: 'Grupo' },
        { key: 'lancamentos', label: 'Lançamentos', format: 'int' },
        { key: 'valor', label: 'Valor', format: 'money' },
        { key: 'participacao', label: 'Participação', format: 'percent' },
      ],
      rows: data,
      chart: { type: 'bar', x: 'categoria', format: 'money', horizontal: true, series: [{ key: 'valor', label: 'Saídas' }], data: data.slice(0, 12) },
      note: 'Competência: inclui contas ainda em aberto do período.',
    };
  },
};

const despesasFornecedor: ReportDefinition = {
  slug: 'despesas-fornecedor',
  group: 'Financeiro',
  title: 'Gastos por fornecedor',
  description: 'Quanto foi comprado de cada fornecedor no período (ex.: peixaria, distribuidora de bebidas).',
  permission: 'finance:read',
  async run(tx, p) {
    const rows = await query<{ fornecedor: string; lancamentos: number; valor: number; ultima: string }>(
      tx,
      sql`select coalesce(nullif(trim(e.counterparty), ''), '(sem fornecedor)') as fornecedor, count(*)::int as lancamentos,
                 sum(e.amount_cents)::float8 as valor, to_char(max(e.competence_date), 'YYYY-MM-DD') as ultima
            from finance_entries e
           where ${entries(p)} and e.direction = 'SAIDA' and e.origin <> 'TRANSFERENCIA'
             and e.competence_date between ${p.from}::date and ${p.to}::date
           group by 1 order by valor desc`,
    );
    const total = rows.reduce((s, r) => s + r.valor, 0);
    return {
      summary: [
        { label: 'Total de saídas', value: total, format: 'money' },
        { label: 'Fornecedores', value: rows.filter((r) => r.fornecedor !== '(sem fornecedor)').length, format: 'int' },
      ],
      columns: [
        { key: 'fornecedor', label: 'Fornecedor' },
        { key: 'lancamentos', label: 'Lançamentos', format: 'int' },
        { key: 'valor', label: 'Valor', format: 'money' },
        { key: 'participacao', label: 'Participação', format: 'percent' },
        { key: 'ultima', label: 'Último lançamento', format: 'date' },
      ],
      rows: rows.map((r) => ({ ...r, participacao: pct(r.valor, total) })),
    };
  },
};

const BUCKETS = ['A vencer', 'Vencidos há 1–30 dias', 'Vencidos há 31–60 dias', 'Vencidos há mais de 60 dias'] as const;

const contasEmAberto: ReportDefinition = {
  slug: 'contas-em-aberto',
  group: 'Financeiro',
  title: 'Contas a pagar e a receber por atraso',
  description: 'Tudo o que está em aberto, separado por faixa de atraso: a vencer, 1–30, 31–60 e mais de 60 dias.',
  permission: 'finance:read',
  usesPeriod: false,
  async run(tx, p) {
    const today = todayInZone(p.timezone);
    const rows = await query<{ descricao: string; tipo: FinanceDirection; vencimento: string; atraso: number; valor: number; fornecedor: string | null }>(
      tx,
      sql`select e.description as descricao, e.direction as tipo, to_char(e.due_date, 'YYYY-MM-DD') as vencimento,
                 greatest(0, ${today}::date - e.due_date)::int as atraso, e.amount_cents::float8 as valor, e.counterparty as fornecedor
            from finance_entries e
           where ${entries(p)} and e.paid_on is null and e.origin <> 'TRANSFERENCIA'
           order by e.due_date`,
    );
    const bucket = (d: number) => (d === 0 ? BUCKETS[0] : d <= 30 ? BUCKETS[1] : d <= 60 ? BUCKETS[2] : BUCKETS[3]);
    const data = rows.map((r) => ({ ...r, tipo: r.tipo === 'ENTRADA' ? 'A receber' : 'A pagar', faixa: bucket(r.atraso) }));
    const chartData = BUCKETS.map((faixa) => ({
      faixa,
      pagar: data.filter((r) => r.faixa === faixa && r.tipo === 'A pagar').reduce((s, r) => s + r.valor, 0),
      receber: data.filter((r) => r.faixa === faixa && r.tipo === 'A receber').reduce((s, r) => s + r.valor, 0),
    }));
    const total = (tipo: string) => data.filter((r) => r.tipo === tipo).reduce((s, r) => s + r.valor, 0);
    return {
      summary: [
        { label: 'A pagar', value: total('A pagar'), format: 'money' },
        { label: 'A receber', value: total('A receber'), format: 'money' },
        { label: 'Vencido a pagar', value: data.filter((r) => r.tipo === 'A pagar' && r.atraso > 0).reduce((s, r) => s + r.valor, 0), format: 'money' },
      ],
      columns: [
        { key: 'vencimento', label: 'Vencimento', format: 'date' },
        { key: 'descricao', label: 'Descrição' },
        { key: 'fornecedor', label: 'Fornecedor/cliente' },
        { key: 'tipo', label: 'Tipo' },
        { key: 'faixa', label: 'Faixa' },
        { key: 'atraso', label: 'Dias de atraso', format: 'int' },
        { key: 'valor', label: 'Valor', format: 'money' },
      ],
      rows: data,
      chart: {
        type: 'bar',
        x: 'faixa',
        format: 'money',
        series: [
          { key: 'pagar', label: 'A pagar' },
          { key: 'receber', label: 'A receber' },
        ],
        data: chartData,
      },
    };
  },
};

const financeiroRede: ReportDefinition = {
  slug: 'financeiro-rede',
  group: 'Franquia',
  title: 'Financeiro da rede',
  description: 'Receita, resultado, margem, CMV, saldo em caixa e contas vencidas de cada unidade, lado a lado.',
  permission: 'tenants:manage',
  network: true,
  async run(tx, p) {
    const today = todayInZone(p.timezone);
    const dreRows = await query<{ tenant_id: string; dre_group: DreGroup; direction: FinanceDirection; cents: number }>(
      tx,
      sql`select e.tenant_id, c.dre_group, e.direction, sum(e.amount_cents)::float8 as cents
            from finance_entries e join finance_categories c on c.id = e.category_id
           where ${entries(p)} and e.competence_date between ${p.from}::date and ${p.to}::date
           group by 1, 2, 3`,
    );
    const units = await query<{ id: string; unidade: string; tipo: string; saldo: number; cmv: number; vencidas: number }>(
      tx,
      sql`select t.id, t.name as unidade, t.kind::text as tipo,
                 (coalesce((select sum(opening_balance_cents) from finance_accounts a where a.tenant_id = t.id and a.status), 0)
                  + coalesce((select sum(case when e.direction = 'ENTRADA' then e.amount_cents else -e.amount_cents end)
                                from finance_entries e join finance_accounts a on a.id = e.account_id and a.status
                               where e.tenant_id = t.id and e.status and e.paid_on is not null), 0))::float8 as saldo,
                 coalesce((select sum(case when e.direction = 'SAIDA' then e.amount_cents else -e.amount_cents end)
                             from finance_entries e join finance_categories c on c.id = e.category_id and c.cmv
                            where e.tenant_id = t.id and e.status and e.competence_date between ${p.from}::date and ${p.to}::date), 0)::float8 as cmv,
                 coalesce((select sum(e.amount_cents) from finance_entries e
                            where e.tenant_id = t.id and e.status and e.direction = 'SAIDA' and e.paid_on is null
                              and e.origin <> 'TRANSFERENCIA' and e.due_date < ${today}::date), 0)::float8 as vencidas
            from tenants t where t.status and t.id = any(${tenantArray(p)})
           order by t.kind, t.name`,
    );
    const data = units.map((u) => {
      const d = computeDre(dreRows.filter((r) => r.tenant_id === u.id).map((r) => ({ dreGroup: r.dre_group, direction: r.direction, cents: r.cents })));
      return {
        unidade: u.unidade,
        tipo: u.tipo === 'MATRIZ' ? 'Matriz' : 'Franquia',
        receita: d.receita,
        resultado: d.resultadoOperacional,
        margem: d.receita ? pct(d.resultadoOperacional, d.receita) : null,
        cmv: d.receita ? pct(u.cmv, d.receita) : null,
        saldo: u.saldo,
        vencidas: u.vencidas,
      };
    });
    const sum = (k: 'receita' | 'resultado' | 'saldo' | 'vencidas') => data.reduce((s, r) => s + r[k], 0);
    return {
      summary: [
        { label: 'Receita da rede', value: sum('receita'), format: 'money' },
        { label: 'Resultado operacional', value: sum('resultado'), format: 'money' },
        { label: 'Saldo em caixa (todas)', value: sum('saldo'), format: 'money' },
        { label: 'Contas vencidas', value: sum('vencidas'), format: 'money' },
      ],
      columns: [
        { key: 'unidade', label: 'Unidade' },
        { key: 'tipo', label: 'Tipo' },
        { key: 'receita', label: 'Receita', format: 'money' },
        { key: 'resultado', label: 'Resultado operacional', format: 'money' },
        { key: 'margem', label: 'Margem', format: 'percent' },
        { key: 'cmv', label: 'CMV', format: 'percent' },
        { key: 'saldo', label: 'Saldo em caixa (hoje)', format: 'money' },
        { key: 'vencidas', label: 'Contas vencidas', format: 'money' },
      ],
      rows: data,
      chart: {
        type: 'bar',
        x: 'unidade',
        format: 'money',
        series: [
          { key: 'receita', label: 'Receita' },
          { key: 'resultado', label: 'Resultado operacional' },
        ],
      },
      note: 'Receita, resultado e CMV pela competência do período; saldo e contas vencidas na data de hoje. Royalties entram como despesa na franquia e receita na Matriz.',
    };
  },
};

export const financeiroReports: ReportDefinition[] = [dre, fluxo, despesasCategoria, despesasFornecedor, contasEmAberto];
export const financeiroRedeReports: ReportDefinition[] = [financeiroRede];
