import { addDays, DomainError, dueFromPreset, weekRange, type TaskInput } from '@zaraki/core';
import { and, asc, eq, ilike, isNotNull, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from '../client';
import { contains } from '../admin/common';
import { memberships, tasks, users } from '../schema';

// Tarefas da equipe: lista de afazeres de cada unidade (o RLS e o tenant_id isolam as unidades).

export type TaskView = 'hoje' | 'semana' | 'todas' | 'feitas';

export type TaskListParams = {
  view: TaskView;
  /** Hoje no fuso da unidade ("AAAA-MM-DD"). */
  today: string;
  timezone: string;
  /** Só as tarefas deste responsável ("Minhas tarefas"). */
  assigneeId?: string;
  q?: string;
  /** Período do histórico (visão "feitas"); padrão: últimos 30 dias. */
  from?: string;
  to?: string;
};

const assignee = alias(users, 'assignee');
const doneByUser = alias(users, 'done_by_user');
const creator = alias(users, 'creator');

const taskColumns = {
  id: tasks.id,
  title: tasks.title,
  notes: tasks.notes,
  dueDate: tasks.dueDate,
  important: tasks.important,
  assigneeId: tasks.assigneeUserId,
  assigneeName: assignee.name,
  doneAt: tasks.doneAt,
  doneByName: doneByUser.name,
  createdBy: tasks.createdBy,
  createdByName: creator.name,
  createdAt: tasks.createdAt,
  status: tasks.status,
};

export type TaskRow = Awaited<ReturnType<typeof listTasks>>[number];

/** Dia (no fuso da unidade) em que a tarefa foi concluída. */
const doneDay = (timezone: string) => sql`(${tasks.doneAt} at time zone ${timezone})::date`;

function baseQuery(tx: Tx) {
  return tx
    .select(taskColumns)
    .from(tasks)
    .leftJoin(assignee, eq(assignee.id, tasks.assigneeUserId))
    .leftJoin(doneByUser, eq(doneByUser.id, tasks.doneBy))
    .leftJoin(creator, eq(creator.id, tasks.createdBy));
}

export async function listTasks(tx: Tx, tenantId: string, p: TaskListParams) {
  const week = weekRange(p.today);
  const open = isNull(tasks.doneAt);
  const done = isNotNull(tasks.doneAt);
  const day = doneDay(p.timezone);
  const views: Record<TaskView, SQL | undefined> = {
    // Em aberto até hoje (inclui as atrasadas) + as concluídas hoje.
    hoje: or(and(open, lte(tasks.dueDate, p.today)), and(done, sql`${day} = ${p.today}::date`)),
    // Em aberto até domingo + as concluídas nesta semana.
    semana: or(and(open, lte(tasks.dueDate, week.end)), and(done, sql`${day} between ${week.start}::date and ${p.today}::date`)),
    todas: open,
    feitas: and(done, sql`${day} between ${p.from ?? addDays(p.today, -30)}::date and ${p.to ?? p.today}::date`),
  };
  const rows = await baseQuery(tx)
    .where(
      and(
        eq(tasks.tenantId, tenantId),
        eq(tasks.status, true),
        views[p.view],
        p.assigneeId ? eq(tasks.assigneeUserId, p.assigneeId) : undefined,
        p.q ? ilike(tasks.title, contains(p.q)) : undefined,
      ),
    )
    .orderBy(asc(tasks.dueDate), asc(tasks.createdAt))
    .limit(500);

  // Em aberto primeiro (atrasadas, importantes, prazo, criação); depois as feitas, mais recentes primeiro.
  const late = (r: (typeof rows)[number]) => (r.dueDate < p.today ? 0 : 1);
  return rows.sort((a, b) => {
    if (!a.doneAt !== !b.doneAt) return a.doneAt ? 1 : -1;
    if (a.doneAt && b.doneAt) return b.doneAt.getTime() - a.doneAt.getTime();
    return (
      late(a) - late(b) ||
      Number(b.important) - Number(a.important) ||
      a.dueDate.localeCompare(b.dueDate) ||
      a.createdAt.getTime() - b.createdAt.getTime()
    );
  });
}

/** Contadores das abas e da página inicial (só tarefas em aberto). */
export async function taskCounts(tx: Tx, tenantId: string, today: string, userId?: string) {
  const week = weekRange(today);
  const [row] = await tx
    .select({
      today: sql<number>`count(*) filter (where ${tasks.dueDate} <= ${today}::date)`.mapWith(Number),
      late: sql<number>`count(*) filter (where ${tasks.dueDate} < ${today}::date)`.mapWith(Number),
      week: sql<number>`count(*) filter (where ${tasks.dueDate} <= ${week.end}::date)`.mapWith(Number),
      open: sql<number>`count(*)`.mapWith(Number),
      mine: userId ? sql<number>`count(*) filter (where ${tasks.assigneeUserId} = ${userId})`.mapWith(Number) : sql<number>`0`.mapWith(Number),
    })
    .from(tasks)
    .where(and(eq(tasks.tenantId, tenantId), eq(tasks.status, true), isNull(tasks.doneAt)));
  return row ?? { today: 0, late: 0, week: 0, open: 0, mine: 0 };
}

export async function getTask(tx: Tx, tenantId: string, id: string) {
  const [row] = await baseQuery(tx).where(and(eq(tasks.tenantId, tenantId), eq(tasks.id, id)));
  return row ?? null;
}

export async function createTask(tx: Tx, tenantId: string, input: TaskInput, today: string) {
  const [row] = await tx
    .insert(tasks)
    .values({
      tenantId,
      title: input.title,
      notes: input.notes,
      dueDate: dueFromPreset(input.duePreset, today, input.dueDate),
      important: input.important,
      assigneeUserId: input.assigneeId,
    })
    .returning();
  return row!;
}

export async function updateTask(tx: Tx, tenantId: string, id: string, input: TaskInput, today: string) {
  const [row] = await tx
    .update(tasks)
    .set({
      title: input.title,
      notes: input.notes,
      dueDate: dueFromPreset(input.duePreset, today, input.dueDate),
      important: input.important,
      assigneeUserId: input.assigneeId,
    })
    .where(and(eq(tasks.tenantId, tenantId), eq(tasks.id, id), eq(tasks.status, true)))
    .returning();
  if (!row) throw new DomainError('Tarefa não encontrada.');
  return row;
}

/** Marca como feita (guarda quem e quando) ou desmarca. Marcar de novo uma tarefa já feita não muda o autor. */
export async function setTaskDone(tx: Tx, tenantId: string, id: string, done: boolean, userId: string) {
  const where = and(eq(tasks.tenantId, tenantId), eq(tasks.id, id), eq(tasks.status, true));
  const [row] = await tx
    .update(tasks)
    .set(done ? { doneAt: new Date(), doneBy: userId } : { doneAt: null, doneBy: null })
    .where(and(where, done ? isNull(tasks.doneAt) : isNotNull(tasks.doneAt)))
    .returning();
  if (row) return row;
  const [current] = await tx.select().from(tasks).where(where);
  if (!current) throw new DomainError('Tarefa não encontrada.');
  return current;
}

export async function setTaskStatus(tx: Tx, tenantId: string, id: string, status: boolean) {
  const [row] = await tx.update(tasks).set({ status }).where(and(eq(tasks.tenantId, tenantId), eq(tasks.id, id))).returning();
  if (!row) throw new DomainError('Tarefa não encontrada.');
  return row;
}

/** Pessoas que podem ser responsáveis: quem tem acesso ativo à unidade. */
export function listTaskAssignees(tx: Tx, tenantId: string) {
  return tx
    .select({ id: users.id, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, true), eq(users.status, true)))
    .orderBy(asc(users.name));
}
