import { describe, expect, it } from 'vitest';
import { formatReportValue, granularityFor, periodBuckets, previousPeriod, resolvePeriod, toCsv } from '../src';

const TZ = 'America/Sao_Paulo';
// 15/10/2026 às 01:00 UTC ainda é 14/10 em Goiânia.
const NOW = new Date('2026-10-15T01:00:00Z');

describe('períodos', () => {
  it.each([
    ['7d', '2026-10-08', '2026-10-14', 7],
    ['30d', '2026-09-15', '2026-10-14', 30],
    ['mes', '2026-10-01', '2026-10-14', 14],
    ['mes-anterior', '2026-09-01', '2026-09-30', 30],
    ['ano', '2026-01-01', '2026-10-14', 287],
  ])('%s → %s a %s', (preset, from, to, days) => {
    expect(resolvePeriod({ preset }, TZ, NOW)).toEqual({ preset, from, to, days });
  });

  it('personalizado aceita datas invertidas e cai para 30 dias se inválido', () => {
    expect(resolvePeriod({ preset: 'personalizado', from: '2026-05-10', to: '2026-05-01' }, TZ, NOW)).toMatchObject({
      from: '2026-05-01',
      to: '2026-05-10',
      days: 10,
    });
    expect(resolvePeriod({ preset: 'xyz' }, TZ, NOW).preset).toBe('30d');
  });

  it('período anterior tem o mesmo tamanho', () => {
    expect(previousPeriod({ from: '2026-10-01', days: 14 })).toEqual({ from: '2026-09-17', to: '2026-09-30' });
  });

  it('agrupa por dia, semana ou mês e gera todos os intervalos', () => {
    expect(granularityFor(30)).toBe('day');
    expect(granularityFor(90)).toBe('week');
    expect(granularityFor(365)).toBe('month');
    expect(periodBuckets('2026-10-12', '2026-10-14', 'day')).toEqual(['2026-10-12', '2026-10-13', '2026-10-14']);
    expect(periodBuckets('2026-10-14', '2026-10-27', 'week')).toEqual(['2026-10-12', '2026-10-19', '2026-10-26']);
    expect(periodBuckets('2026-01-15', '2026-03-02', 'month')).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
  });
});

describe('valores e CSV', () => {
  it('formata valores de relatório', () => {
    expect(formatReportValue(1234567, 'money')).toBe('R$ 12.345,67');
    expect(formatReportValue(12.345, 'percent')).toBe('12,3%');
    expect(formatReportValue(95, 'minutes')).toBe('1h35');
    expect(formatReportValue(40, 'minutes')).toBe('40 min');
    expect(formatReportValue('2026-10-01', 'month')).toBe('out/2026');
    expect(formatReportValue('2026-10-01', 'date')).toBe('01/10/2026');
    expect(formatReportValue(null, 'money')).toBe('—');
  });

  it('gera CSV para o Excel brasileiro', () => {
    const csv = toCsv(
      [
        { key: 'sabor', label: 'Sabor' },
        { key: 'total', label: 'Faturamento', format: 'money' },
        { key: 'pct', label: '%', format: 'percent' },
      ],
      [{ sabor: 'Salmão; "especial"', total: 123456, pct: 12.5 }],
    );
    expect(csv).toBe('﻿Sabor;Faturamento;%\r\n"Salmão; ""especial""";1234,56;12,5\r\n');
  });
});
