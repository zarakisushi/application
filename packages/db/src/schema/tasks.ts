import { sql } from 'drizzle-orm';
import { boolean, check, date, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { baseColumns, id, ts } from './common';
import { tenants } from './tenancy';

/** Tarefas da equipe (lista de afazeres da unidade). Concluir preenche done_at e done_by. */
export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    title: text().notNull(),
    notes: text(),
    dueDate: date({ mode: 'string' }).notNull(),
    important: boolean().notNull().default(false),
    /** Responsável (opcional): precisa ter acesso à unidade (gatilho task_same_tenant). */
    assigneeUserId: uuid().references(() => users.id),
    doneAt: ts(),
    doneBy: uuid().references(() => users.id),
    ...baseColumns(),
  },
  (t) => [
    index('tasks_tenant_due_idx').on(t.tenantId, t.dueDate).where(sql`${t.status}`),
    check('tasks_title_ck', sql`length(${t.title}) between 1 and 200`),
    check('tasks_done_ck', sql`(${t.doneAt} is null) = (${t.doneBy} is null)`),
  ],
);
