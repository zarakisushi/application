'use server';

import { taskSchema, todayInZone } from '@zaraki/core';
import { createTask, getTask, setTaskDone, setTaskStatus, updateTask, withContext } from '@zaraki/db';
import { revalidatePath } from 'next/cache';
import { attempt, parseForm, type ActionResult } from '@/server/actions';
import { requireAdmin, type AdminContext } from '@/server/admin';

function refresh() {
  revalidatePath('/admin/tarefas');
  revalidatePath('/admin');
}

/** Editar ou excluir: quem criou a tarefa, ou Gerente/Administrador. */
async function assertCanChange(ctx: AdminContext, id: string) {
  if (ctx.can('tasks:manage')) return null;
  const task = await withContext(ctx.db, (tx) => getTask(tx, ctx.tenant.id, id));
  if (!task) return 'Tarefa não encontrada.';
  return task.createdBy === ctx.user.id ? null : 'Só quem criou a tarefa, o gerente ou o administrador podem alterá-la ou excluí-la.';
}

export async function saveTaskAction(id: string | null, form: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin('tasks:write');
  const { data, result } = parseForm(taskSchema, form);
  if (!data) return result;
  if (id) {
    const denied = await assertCanChange(ctx, id);
    if (denied) return { error: denied };
  }
  const today = todayInZone(ctx.tenant.timezone);
  return attempt(async () => {
    const task = await withContext(ctx.db, (tx) => (id ? updateTask(tx, ctx.tenant.id, id, data, today) : createTask(tx, ctx.tenant.id, data, today)));
    refresh();
    return { ok: true, id: task.id, message: id ? 'Tarefa salva.' : undefined };
  });
}

export async function toggleTaskDoneAction(id: string, done: boolean): Promise<ActionResult> {
  const ctx = await requireAdmin('tasks:write');
  return attempt(async () => {
    await withContext(ctx.db, (tx) => setTaskDone(tx, ctx.tenant.id, id, done, ctx.user.id));
    refresh();
    return { ok: true };
  });
}

export async function deleteTaskAction(id: string): Promise<ActionResult> {
  const ctx = await requireAdmin('tasks:write');
  const denied = await assertCanChange(ctx, id);
  if (denied) return { error: denied };
  return attempt(async () => {
    await withContext(ctx.db, (tx) => setTaskStatus(tx, ctx.tenant.id, id, false));
    refresh();
    return { ok: true, message: 'Tarefa excluída. Ela continua no histórico da auditoria.' };
  });
}
