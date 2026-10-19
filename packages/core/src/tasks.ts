import { z } from 'zod';
import { addDays } from './finance';
import { checkboxField } from './order';

// Tarefas da equipe (lista de afazeres da unidade): prazos, rótulos e validação.

/** Dias de `from` até `to` (positivo se `to` é depois). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Semana de segunda a domingo que contém a data. */
export function weekRange(today: string): { start: string; end: string } {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = domingo
  const start = addDays(today, dow === 0 ? -6 : 1 - dow);
  return { start, end: addDays(start, 6) };
}

export const TASK_DUE_PRESETS = ['HOJE', 'AMANHA', 'SEMANA', 'DATA'] as const;
export type TaskDuePreset = (typeof TASK_DUE_PRESETS)[number];
export const TASK_DUE_PRESET_LABEL: Record<TaskDuePreset, string> = {
  HOJE: 'Hoje',
  AMANHA: 'Amanhã',
  SEMANA: 'Esta semana',
  DATA: 'Escolher data',
};

/** Data do prazo a partir da opção escolhida ("Esta semana" = até domingo). */
export function dueFromPreset(preset: TaskDuePreset, today: string, date?: string | null): string {
  if (preset === 'AMANHA') return addDays(today, 1);
  if (preset === 'SEMANA') return weekRange(today).end;
  if (preset === 'DATA' && date) return date;
  return today;
}

export type TaskTone = 'late' | 'today' | 'normal' | 'done';

const WEEKDAY = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Rótulo e tom do prazo: "Atrasada · 2 dias", "Hoje", "Amanhã", "Até domingo", "Sex, 23/10". */
export function taskDueInfo(due: string, today: string, done = false): { label: string; tone: TaskTone } {
  const diff = daysBetween(today, due);
  const tone: TaskTone = done ? 'done' : diff < 0 ? 'late' : diff === 0 ? 'today' : 'normal';
  if (diff < 0 && !done) return { label: `Atrasada · ${-diff} ${diff === -1 ? 'dia' : 'dias'}`, tone };
  if (diff === 0) return { label: 'Hoje', tone };
  if (diff === 1) return { label: 'Amanhã', tone };
  if (diff === -1) return { label: 'Ontem', tone };
  const [, m, d] = due.split('-');
  const short = `${WEEKDAY[new Date(`${due}T00:00:00Z`).getUTCDay()]}, ${d}/${m}`;
  if (diff > 1 && due === weekRange(today).end) return { label: 'Até domingo', tone };
  return { label: short, tone };
}

export const taskSchema = z
  .object({
    title: z.string().trim().min(2, 'Escreva a tarefa').max(200, 'Até 200 caracteres'),
    notes: z
      .string()
      .trim()
      .max(1000, 'Até 1000 caracteres')
      .default('')
      .transform((v) => v || null),
    duePreset: z.enum(TASK_DUE_PRESETS).default('HOJE'),
    dueDate: z
      .union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')])
      .default('')
      .transform((v) => v || null),
    assigneeId: z
      .union([z.literal(''), z.uuid()])
      .default('')
      .transform((v) => v || null),
    important: checkboxField.default(false),
  })
  .refine((v) => v.duePreset !== 'DATA' || v.dueDate, { path: ['dueDate'], message: 'Escolha a data' });

export type TaskInput = z.output<typeof taskSchema>;
