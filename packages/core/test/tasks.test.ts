import { describe, expect, it } from 'vitest';
import { dueFromPreset, taskDueInfo, taskSchema, weekRange } from '../src';

describe('prazos das tarefas', () => {
  it('semana vai de segunda a domingo, inclusive na virada do mês', () => {
    expect(weekRange('2026-10-19')).toEqual({ start: '2026-10-19', end: '2026-10-25' }); // segunda
    expect(weekRange('2026-10-25')).toEqual({ start: '2026-10-19', end: '2026-10-25' }); // domingo
    expect(weekRange('2026-10-29')).toEqual({ start: '2026-10-26', end: '2026-11-01' });
  });

  it('opções de prazo viram datas', () => {
    expect(dueFromPreset('HOJE', '2026-10-21')).toBe('2026-10-21');
    expect(dueFromPreset('AMANHA', '2026-10-31')).toBe('2026-11-01');
    expect(dueFromPreset('SEMANA', '2026-10-21')).toBe('2026-10-25');
    expect(dueFromPreset('DATA', '2026-10-21', '2026-12-24')).toBe('2026-12-24');
  });

  it('rótulo e tom do prazo', () => {
    const today = '2026-10-21'; // quarta
    expect(taskDueInfo('2026-10-19', today)).toEqual({ label: 'Atrasada · 2 dias', tone: 'late' });
    expect(taskDueInfo('2026-10-20', today)).toEqual({ label: 'Atrasada · 1 dia', tone: 'late' });
    expect(taskDueInfo('2026-10-21', today)).toEqual({ label: 'Hoje', tone: 'today' });
    expect(taskDueInfo('2026-10-22', today)).toEqual({ label: 'Amanhã', tone: 'normal' });
    expect(taskDueInfo('2026-10-25', today)).toEqual({ label: 'Até domingo', tone: 'normal' });
    expect(taskDueInfo('2026-10-30', today)).toEqual({ label: 'Sex, 30/10', tone: 'normal' });
    expect(taskDueInfo('2026-10-19', today, true)).toEqual({ label: 'Seg, 19/10', tone: 'done' });
  });
});

describe('cadastro da tarefa', () => {
  it('valida título, data escolhida e campos opcionais', () => {
    expect(taskSchema.parse({ title: '  Limpar o freezer ' })).toEqual({
      title: 'Limpar o freezer',
      notes: null,
      duePreset: 'HOJE',
      dueDate: null,
      assigneeId: null,
      important: false,
    });
    expect(taskSchema.safeParse({ title: 'x' }).success).toBe(false);
    expect(taskSchema.safeParse({ title: 'Pedir salmão', duePreset: 'DATA' }).success).toBe(false);
    expect(taskSchema.parse({ title: 'Pedir salmão', duePreset: 'DATA', dueDate: '2026-10-30', important: 'on' })).toMatchObject({
      dueDate: '2026-10-30',
      important: true,
    });
  });
});
