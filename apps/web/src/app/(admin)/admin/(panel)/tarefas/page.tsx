import { todayInZone } from '@zaraki/core';
import { listTaskAssignees, listTasks, taskCounts, withContext, type TaskView } from '@zaraki/db';
import { UserRound } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ListToolbar } from '@/components/admin/ListToolbar';
import { PageHeader } from '@/components/admin/PageHeader';
import { TaskList, TaskQuickAdd } from '@/components/admin/tasks/Tasks';
import { cn } from '@/lib/utils';
import { requireAdmin } from '@/server/admin';

export const metadata: Metadata = { title: 'Tarefas' };

const VIEWS: { key: TaskView; label: string }[] = [
  { key: 'hoje', label: 'Hoje' },
  { key: 'semana', label: 'Semana' },
  { key: 'todas', label: 'Todas' },
  { key: 'feitas', label: 'Feitas' },
];

const EMPTY: Record<TaskView, [string, string]> = {
  hoje: ['Nada para hoje 🎉', 'Escreva acima o que precisa ser feito: a equipe toda vê a lista.'],
  semana: ['Nada para esta semana', 'As tarefas com prazo até domingo aparecem aqui.'],
  todas: ['Nenhuma tarefa em aberto', 'Tudo em dia por aqui.'],
  feitas: ['Nenhuma tarefa feita nos últimos 30 dias', 'Quando alguém marcar uma tarefa como feita, ela fica guardada aqui.'],
};

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireAdmin('tasks:read');
  const sp = await searchParams;
  const view = (VIEWS.find((v) => v.key === sp.aba)?.key ?? 'hoje') as TaskView;
  const mine = sp.minhas === '1';
  const q = typeof sp.q === 'string' ? sp.q.trim() : '';
  const timezone = ctx.tenant.timezone;
  const today = todayInZone(timezone);

  const { tasks, counts, assignees } = await withContext(ctx.db, async (tx) => ({
    tasks: await listTasks(tx, ctx.tenant.id, { view, today, timezone, q: q || undefined, assigneeId: mine ? ctx.user.id : undefined }),
    counts: await taskCounts(tx, ctx.tenant.id, today, ctx.user.id),
    assignees: await listTaskAssignees(tx, ctx.tenant.id),
  }));

  const href = (params: { aba?: TaskView; minhas?: boolean }) => {
    const s = new URLSearchParams();
    const aba = params.aba ?? view;
    if (aba !== 'hoje') s.set('aba', aba);
    if (params.minhas ?? mine) s.set('minhas', '1');
    if (q) s.set('q', q);
    const qs = s.toString();
    return `/admin/tarefas${qs ? `?${qs}` : ''}`;
  };
  const badge: Partial<Record<TaskView, number>> = { hoje: counts.today, semana: counts.week, todas: counts.open };
  const listCtx = { today, timezone, me: { id: ctx.user.id, name: ctx.user.name }, canManage: ctx.can('tasks:manage'), assignees };

  return (
    <>
      <PageHeader
        title="Tarefas"
        description={`Os afazeres da equipe da ${ctx.tenant.name}. Marque o que já foi feito: fica tudo guardado no histórico.`}
      />
      {ctx.can('tasks:write') && <TaskQuickAdd {...listCtx} />}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <nav className="flex flex-wrap gap-1 rounded-lg bg-muted p-1" aria-label="Visões das tarefas">
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={href({ aba: v.key })}
              aria-current={v.key === view ? 'page' : undefined}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground',
                v.key === view && 'bg-card text-foreground shadow-xs',
              )}
            >
              {v.label}
              {badge[v.key] ? (
                <span
                  className={cn(
                    'rounded-full px-1.5 text-xs tabular-nums',
                    v.key === 'hoje' && counts.late ? 'bg-red-600 text-white' : 'bg-foreground/10',
                  )}
                >
                  {badge[v.key]}
                </span>
              ) : null}
            </Link>
          ))}
        </nav>
        <Link
          href={href({ minhas: !mine })}
          aria-pressed={mine}
          className={cn(
            'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
            mine ? 'border-brand-ink bg-brand-ink text-[#f4efe6]' : 'bg-card text-muted-foreground hover:text-foreground',
          )}
        >
          <UserRound className="size-4" /> Minhas tarefas{counts.mine ? ` (${counts.mine})` : ''}
        </Link>
      </div>
      <ListToolbar q={q} placeholder="Buscar tarefa" hidden={{ ...(view !== 'hoje' ? { aba: view } : {}), ...(mine ? { minhas: '1' } : {}) }} />

      {counts.late > 0 && view !== 'feitas' && (
        <p className="mb-3 text-sm font-medium text-red-700" role="status">
          {counts.late === 1 ? '1 tarefa atrasada' : `${counts.late} tarefas atrasadas`}: elas ficam no topo até serem feitas.
        </p>
      )}

      <TaskList
        {...listCtx}
        tasks={tasks}
        emptyTitle={q ? `Nada encontrado para "${q}"` : mine ? 'Nenhuma tarefa sua aqui' : EMPTY[view][0]}
        emptyText={q ? 'Tente outra palavra.' : mine ? 'Tarefas com você como responsável aparecem aqui.' : EMPTY[view][1]}
      />
    </>
  );
}
