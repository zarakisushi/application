import { taskSchema } from '@zaraki/core';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  createDb,
  createTask,
  createUserWithPassword,
  listTaskAssignees,
  listTasks,
  setTaskDone,
  setTaskStatus,
  taskCounts,
  updateTask,
  withContext,
} from '../src';
import { auditLogs, tasks, tenants } from '../src/schema';

const db = createDb(inject('appUrl'), 5);
const owner = createDb(inject('ownerUrl'), 2);
afterAll(async () => {
  await db.$client.end();
  await owner.$client.end();
});

type Tenant = typeof tenants.$inferSelect;
const TZ = 'America/Sao_Paulo';
const TODAY = '2026-10-21'; // quarta; semana de 19 a 25/10
let tenant: Tenant;
let other: Tenant;
let ana: string;
let bruno: string;
let estranho: string;

const run = <T>(fn: Parameters<typeof withContext<T>>[1], t: Tenant = tenant, userId = ana) => withContext({ tenantId: t.id, userId, actorLabel: 'teste' }, fn, db);
const add = (title: string, extra: Record<string, unknown> = {}) => run((tx) => createTask(tx, tenant.id, taskSchema.parse({ title, ...extra }), TODAY));
const titles = (rows: { title: string }[]) => rows.map((r) => r.title);

beforeAll(async () => {
  await withContext(
    { platformAdmin: true, actorLabel: 'teste' },
    async (tx) => {
      [tenant] = (await tx.insert(tenants).values({ name: 'Tarefas', slug: `t-${randomUUID()}` }).returning()) as [Tenant];
      [other] = (await tx.insert(tenants).values({ name: 'Tarefas 2', slug: `t-${randomUUID()}` }).returning()) as [Tenant];
      const user = (name: string, tenantId: string) =>
        createUserWithPassword(tx, { name, email: `${randomUUID()}@zaraki.test`, passwordHash: 'x', memberships: [{ tenantId, role: 'ATENDENTE' }] });
      ana = (await user('Ana Atendente', tenant.id)).id;
      bruno = (await user('Bruno Gerente', tenant.id)).id;
      estranho = (await user('Outra Unidade', other.id)).id;
    },
    db,
  );
});

describe('lista de tarefas', () => {
  it('organiza hoje, semana e todas: atrasadas e importantes no topo', async () => {
    await add('Limpar o freezer', { duePreset: 'SEMANA' });
    await add('Pedir salmão', { duePreset: 'DATA', dueDate: '2026-10-19' });
    await add('Postar story');
    await add('Conferir cream cheese', { important: 'on' });
    await add('Reunião do mês', { duePreset: 'DATA', dueDate: '2026-11-05' });

    const view = (v: 'hoje' | 'semana' | 'todas') => run((tx) => listTasks(tx, tenant.id, { view: v, today: TODAY, timezone: TZ }));
    expect(titles(await view('hoje'))).toEqual(['Pedir salmão', 'Conferir cream cheese', 'Postar story']);
    expect(titles(await view('semana'))).toEqual(['Pedir salmão', 'Conferir cream cheese', 'Postar story', 'Limpar o freezer']);
    expect(titles(await view('todas'))).toHaveLength(5);
    expect(await run((tx) => taskCounts(tx, tenant.id, TODAY, ana))).toEqual({ today: 3, late: 1, week: 4, open: 5, mine: 0 });
  });

  it('concluir guarda quem e quando, vai para o fim da lista e entra no histórico; desfazer volta', async () => {
    const [story] = (await run((tx) => listTasks(tx, tenant.id, { view: 'hoje', today: TODAY, timezone: TZ }))).filter((t) => t.title === 'Postar story');
    const done = await run((tx) => setTaskDone(tx, tenant.id, story!.id, true, bruno), tenant, bruno);
    expect(done.doneBy).toBe(bruno);
    // Marcar de novo não troca quem concluiu.
    await run((tx) => setTaskDone(tx, tenant.id, story!.id, true, ana));

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
    const hoje = await run((tx) => listTasks(tx, tenant.id, { view: 'hoje', today, timezone: TZ }));
    expect(hoje.at(-1)).toMatchObject({ title: 'Postar story', doneByName: 'Bruno Gerente' });
    const feitas = await run((tx) => listTasks(tx, tenant.id, { view: 'feitas', today, timezone: TZ }));
    expect(titles(feitas)).toEqual(['Postar story']);

    await run((tx) => setTaskDone(tx, tenant.id, story!.id, false, ana));
    expect(await run((tx) => listTasks(tx, tenant.id, { view: 'feitas', today, timezone: TZ }))).toHaveLength(0);

    const logs = await owner.select().from(auditLogs).where(and(eq(auditLogs.entity, 'tasks'), eq(auditLogs.entityId, story!.id)));
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(['CREATE', 'UPDATE']));
    expect(logs.some((l) => (l.after as Record<string, unknown> | null)?.done_by === bruno)).toBe(true);
  });

  it('responsável: "minhas tarefas" e só quem tem acesso à unidade', async () => {
    const t = await add('Repor panfletos', { assigneeId: ana, duePreset: 'SEMANA' });
    const mine = await run((tx) => listTasks(tx, tenant.id, { view: 'semana', today: TODAY, timezone: TZ, assigneeId: ana }));
    expect(mine).toEqual([expect.objectContaining({ title: 'Repor panfletos', assigneeName: 'Ana Atendente' })]);
    expect((await run((tx) => listTaskAssignees(tx, tenant.id))).map((u) => u.name)).toEqual(['Ana Atendente', 'Bruno Gerente']);

    await expect(add('Tarefa errada', { assigneeId: estranho })).rejects.toMatchObject({ cause: { message: 'O responsável não tem acesso a esta unidade' } });
    const edited = await run((tx) => updateTask(tx, tenant.id, t.id, taskSchema.parse({ title: 'Repor panfletos no balcão', assigneeId: bruno, duePreset: 'AMANHA' }), TODAY));
    expect(edited).toMatchObject({ title: 'Repor panfletos no balcão', assigneeUserId: bruno, dueDate: '2026-10-22' });
  });

  it('excluir é lógico; o banco não deixa apagar', async () => {
    const t = await add('Tarefa temporária');
    await run((tx) => setTaskStatus(tx, tenant.id, t.id, false));
    expect(titles(await run((tx) => listTasks(tx, tenant.id, { view: 'todas', today: TODAY, timezone: TZ })))).not.toContain('Tarefa temporária');
    await expect(run((tx) => tx.execute(sql`delete from tasks where id = ${t.id}`))).rejects.toThrow();
    const [row] = await owner.select().from(tasks).where(eq(tasks.id, t.id));
    expect(row!.status).toBe(false);
  });
});

describe('isolamento entre unidades', () => {
  it('cada unidade vê só as suas tarefas; uma unidade nova começa vazia', async () => {
    const theirs = await run((tx) => listTasks(tx, other.id, { view: 'todas', today: TODAY, timezone: TZ }), other, estranho);
    expect(theirs).toEqual([]);
    // Mesmo pedindo pela outra unidade, o RLS não entrega nada.
    expect(await run((tx) => listTasks(tx, tenant.id, { view: 'todas', today: TODAY, timezone: TZ }), other, estranho)).toEqual([]);
    await expect(
      run((tx) => tx.insert(tasks).values({ tenantId: tenant.id, title: 'Invasão', dueDate: TODAY }), other, estranho),
    ).rejects.toThrow();
  });
});
