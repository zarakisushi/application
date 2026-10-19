'use client';

import { TASK_DUE_PRESET_LABEL, TASK_DUE_PRESETS, taskDueInfo, type TaskDuePreset } from '@zaraki/core';
import { ChevronDown, Circle, CircleCheck, NotebookPen, Plus, Star, Trash2, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useOptimistic, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { deleteTaskAction, saveTaskAction, toggleTaskDoneAction } from '@/app/(admin)/admin/(panel)/tarefas/actions';
import { ConfirmAction } from '@/components/admin/ConfirmAction';
import { Field, FormError, useServerForm } from '@/components/admin/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export type TaskItemData = {
  id: string;
  title: string;
  notes: string | null;
  dueDate: string;
  important: boolean;
  assigneeId: string | null;
  assigneeName: string | null;
  doneAt: Date | null;
  doneByName: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: Date;
};

export type Assignee = { id: string; name: string };

type ListContext = {
  today: string;
  timezone: string;
  me: { id: string; name: string };
  canManage: boolean;
  assignees: Assignee[];
};

const NOBODY = 'ninguem';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

function doneWhen(at: Date, ctx: ListContext) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: ctx.timezone }).format(at);
  const time = new Intl.DateTimeFormat('pt-BR', { timeZone: ctx.timezone, hour: '2-digit', minute: '2-digit' }).format(at);
  if (day === ctx.today) return `às ${time}`;
  const date = new Intl.DateTimeFormat('pt-BR', { timeZone: ctx.timezone, day: '2-digit', month: '2-digit' }).format(at);
  return `em ${date} às ${time}`;
}

const DUE_TONE = {
  late: 'bg-red-100 text-red-800 ring-red-200',
  today: 'bg-amber-100 text-amber-900 ring-amber-200',
  normal: 'bg-muted text-muted-foreground ring-border',
  done: 'bg-muted text-muted-foreground ring-border',
} as const;

/** Lista de tarefas: em aberto primeiro, depois o bloco "Feitas". Marcar como feita é instantâneo. */
export function TaskList({
  tasks,
  emptyTitle,
  emptyText,
  compact = false,
  split = false,
  ...ctx
}: ListContext & {
  tasks: TaskItemData[];
  emptyTitle: string;
  emptyText?: string;
  compact?: boolean;
  /** Pendentes e feitas lado a lado (computador); no celular, as feitas num accordion fechado. */
  split?: boolean;
}) {
  const [, startTransition] = useTransition();
  const [doneOpen, setDoneOpen] = useState(false);
  const [optimistic, apply] = useOptimistic(tasks, (state, change: { id: string; done: boolean }) =>
    state.map((t) => (t.id === change.id ? { ...t, doneAt: change.done ? new Date() : null, doneByName: change.done ? ctx.me.name : null } : t)),
  );

  const toggle = (task: TaskItemData, done: boolean) =>
    startTransition(async () => {
      apply({ id: task.id, done });
      const r = await toggleTaskDoneAction(task.id, done);
      if (r?.error) toast.error(r.error);
      else if (done) toast.success('Tarefa concluída', { description: task.title, action: { label: 'Desfazer', onClick: () => toggle(task, false) } });
    });

  const open = optimistic.filter((t) => !t.doneAt);
  const done = optimistic.filter((t) => t.doneAt).sort((a, b) => b.doneAt!.getTime() - a.doneAt!.getTime());

  if (!optimistic.length) {
    return (
      <div className="rounded-xl border border-dashed bg-card px-6 py-10 text-center">
        <p className="font-display text-lg font-bold">{emptyTitle}</p>
        {emptyText && <p className="mt-1 text-sm text-muted-foreground">{emptyText}</p>}
      </div>
    );
  }

  const doneList = (
    <ul className="flex flex-col gap-2" aria-label="Tarefas concluídas">
      {done.map((t) => (
        <TaskItem key={t.id} task={t} ctx={ctx} onToggle={toggle} />
      ))}
    </ul>
  );
  const openList = (
    <ul className="flex flex-col gap-2" aria-label="Tarefas em aberto">
      {open.map((t) => (
        <TaskItem key={t.id} task={t} ctx={ctx} onToggle={toggle} compact={compact} />
      ))}
    </ul>
  );

  // Página inicial: só as pendentes. Aba "Feitas" (ou sem divisão): uma lista só, feitas mais recentes primeiro.
  if (compact) return open.length ? openList : null;
  if (!split) {
    return (
      <div className="flex flex-col gap-2">
        {open.length > 0 && openList}
        {done.length > 0 && doneList}
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
      {/* Feitas: à direita no computador; no celular, accordion fechado acima das pendentes. */}
      <section aria-label="Tarefas feitas" className="lg:sticky lg:top-20 lg:order-2 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:pb-2">
        {done.length > 0 ? (
          <>
            <button
              type="button"
              onClick={() => setDoneOpen((o) => !o)}
              aria-expanded={doneOpen}
              aria-controls="tarefas-feitas"
              className="flex w-full items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-left font-semibold text-emerald-900 lg:hidden"
            >
              <span className="flex items-center gap-2">
                <CircleCheck className="size-5 text-emerald-600" /> Feitas
                <span className="rounded-full bg-emerald-600 px-2 text-xs text-white tabular-nums">{done.length}</span>
              </span>
              <ChevronDown className={cn('size-5 transition-transform', doneOpen && 'rotate-180')} />
            </button>
            <h2 className="mb-2 hidden items-center gap-2 text-sm font-semibold text-emerald-800 lg:flex">
              <CircleCheck className="size-4" /> Feitas ({done.length})
            </h2>
            <div id="tarefas-feitas" className={cn('mt-2 lg:mt-0 lg:block', !doneOpen && 'hidden')}>
              {doneList}
            </div>
          </>
        ) : (
          <div className="hidden rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground lg:block">
            <CircleCheck className="mx-auto mb-2 size-6 text-emerald-600/50" />
            As tarefas concluídas aparecem aqui.
          </div>
        )}
      </section>

      <section aria-label="Tarefas pendentes" className="lg:order-1">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Circle className="size-4 text-muted-foreground" /> Pendentes ({open.length})
        </h2>
        {open.length > 0 ? (
          openList
        ) : (
          <div className="rounded-xl border border-dashed bg-card px-6 py-8 text-center">
            <p className="font-display text-lg font-bold">Tudo feito por aqui 🎉</p>
            <p className="mt-1 text-sm text-muted-foreground">Nenhuma tarefa pendente nesta lista.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function TaskItem({
  task,
  ctx,
  onToggle,
  compact = false,
}: {
  task: TaskItemData;
  ctx: ListContext;
  onToggle: (task: TaskItemData, done: boolean) => void;
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const done = !!task.doneAt;
  const due = taskDueInfo(task.dueDate, ctx.today, done);
  const late = due.tone === 'late';

  return (
    <li
      data-testid="task"
      data-done={done || undefined}
      className={cn(
        'flex items-start gap-2 rounded-xl border bg-card py-2 pr-3 pl-1.5 shadow-xs transition-colors sm:gap-3',
        done && 'border-emerald-200 bg-emerald-50 shadow-none',
        late && 'border-red-200 bg-red-50/60',
      )}
    >
      <button
        type="button"
        onClick={() => onToggle(task, !done)}
        aria-pressed={done}
        aria-label={done ? `Desmarcar "${task.title}"` : `Marcar "${task.title}" como feita`}
        className="group flex size-10 shrink-0 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:outline-none"
      >
        {done ? (
          <CircleCheck className="size-7 fill-emerald-600 text-white" aria-hidden />
        ) : (
          <Circle className={cn('size-7 text-muted-foreground/50 transition-colors group-hover:text-emerald-600', late && 'text-red-400')} aria-hidden />
        )}
      </button>
      <div className="min-w-0 flex-1 py-1.5">
        {compact ? (
          <Link href="/admin/tarefas" className="font-medium break-words hover:underline">
            {task.title}
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className={cn(
              'text-left font-medium break-words hover:underline',
              done && 'text-muted-foreground line-through decoration-emerald-700/60',
            )}
          >
            {task.title}
          </button>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {!done && <span className={cn('rounded-full px-2 py-0.5 font-medium ring-1', DUE_TONE[due.tone])}>{due.label}</span>}
          {task.important && (
            <span className="flex items-center gap-1 font-medium text-amber-700">
              <Star className="size-3.5 fill-amber-400 text-amber-500" aria-hidden /> Importante
            </span>
          )}
          {task.assigneeName && (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="flex size-5 items-center justify-center rounded-full bg-brand-ink text-[0.6rem] font-semibold text-brand-gold-light" aria-hidden>
                {initials(task.assigneeName)}
              </span>
              {task.assigneeName}
            </span>
          )}
          {task.notes && (
            <span className="flex items-center gap-1 text-muted-foreground" title={task.notes}>
              <NotebookPen className="size-3.5" aria-hidden /> Observação
            </span>
          )}
          {done && (
            <span className="font-medium text-emerald-800">
              Feita{task.doneByName ? ` por ${task.doneByName.split(' ')[0]}` : ''} {doneWhen(task.doneAt!, ctx)}
            </span>
          )}
        </div>
      </div>
      {!compact && <TaskSheet task={task} ctx={ctx} open={editing} onOpenChange={setEditing} />}
    </li>
  );
}

/** Prazo, responsável e importante (usados na adição rápida e na edição). */
function TaskOptions({
  ctx,
  errors,
  initial,
  layout,
}: {
  ctx: ListContext;
  errors: Record<string, string>;
  initial?: { preset: TaskDuePreset; date: string; assigneeId: string | null; important: boolean };
  layout: 'inline' | 'stacked';
}) {
  const [preset, setPreset] = useState<TaskDuePreset>(initial?.preset ?? 'HOJE');
  const [assignee, setAssignee] = useState(initial?.assigneeId ?? NOBODY);
  const [important, setImportant] = useState(initial?.important ?? false);
  const stacked = layout === 'stacked';

  const dueSelect = (
    <Select value={preset} onValueChange={(v) => setPreset(v as TaskDuePreset)}>
      <SelectTrigger className={cn('bg-card', !stacked && 'w-36')} aria-label="Prazo" id={stacked ? 'task-due' : undefined}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TASK_DUE_PRESETS.map((p) => (
          <SelectItem key={p} value={p}>
            {TASK_DUE_PRESET_LABEL[p]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const dateInput = preset === 'DATA' && (
    <Input
      type="date"
      name="dueDate"
      defaultValue={initial?.date ?? ''}
      min={stacked ? undefined : ctx.today}
      aria-label="Data do prazo"
      className={cn('bg-card', !stacked && 'w-40')}
      required
    />
  );
  const assigneeSelect = (
    <Select value={assignee} onValueChange={setAssignee}>
      <SelectTrigger className={cn('bg-card', !stacked && 'w-48')} aria-label="Responsável" id={stacked ? 'task-assignee' : undefined}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NOBODY}>Sem responsável</SelectItem>
        {ctx.assignees.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.id === ctx.me.id ? `${a.name} (eu)` : a.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const importantToggle = (
    <Button
      type="button"
      variant="outline"
      aria-pressed={important}
      onClick={() => setImportant((v) => !v)}
      className={cn('bg-card', important && 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100')}
    >
      <Star className={cn('size-4', important && 'fill-amber-400 text-amber-500')} /> Importante
    </Button>
  );
  const hidden = (
    <>
      <input type="hidden" name="duePreset" value={preset} />
      <input type="hidden" name="assigneeId" value={assignee === NOBODY ? '' : assignee} />
      <input type="hidden" name="important" value={important ? 'on' : ''} />
    </>
  );

  if (!stacked) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {hidden}
        {dueSelect}
        {dateInput}
        {assigneeSelect}
        {importantToggle}
        {errors.dueDate && <p className="w-full text-sm text-destructive">{errors.dueDate}</p>}
      </div>
    );
  }
  return (
    <>
      {hidden}
      <Field label="Prazo" htmlFor="task-due" error={errors.dueDate}>
        <div className="grid gap-2 sm:grid-cols-2">
          {dueSelect}
          {dateInput}
        </div>
      </Field>
      <Field label="Responsável (opcional)" htmlFor="task-assignee">
        {assigneeSelect}
      </Field>
      <div>{importantToggle}</div>
    </>
  );
}

/** Adição rápida: escreve, Enter, e já pode escrever a próxima. */
export function TaskQuickAdd(ctx: ListContext) {
  const title = useRef<HTMLInputElement>(null);
  const [key, setKey] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  // O campo esvazia na hora (dá para digitar a próxima enquanto a anterior é salva); se der erro, o texto volta.
  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = String(form.get('title') ?? '').trim();
    if (!text) return;
    if (title.current) title.current.value = '';
    title.current?.focus();
    setKey((k) => k + 1); // volta prazo, responsável e importante ao padrão
    startTransition(async () => {
      const r = await saveTaskAction(null, form);
      if (r?.ok) {
        setErrors({});
        toast.success('Tarefa adicionada.');
        return;
      }
      if (title.current && !title.current.value) title.current.value = text;
      setErrors(r?.fieldErrors ?? {});
      if (r?.error) toast.error(r.fieldErrors ? `Não foi possível adicionar "${text}": confira os campos.` : r.error);
    });
  };

  return (
    <form onSubmit={onSubmit} className="mb-6 rounded-xl border bg-card p-3 shadow-sm" aria-label="Nova tarefa">
      <div className="flex gap-2">
        <Input
          ref={title}
          name="title"
          placeholder="O que precisa ser feito?"
          aria-label="Nova tarefa"
          aria-invalid={errors.title ? true : undefined}
          className="h-11 text-base"
          maxLength={200}
          autoComplete="off"
          required
        />
        <Button type="submit" className="h-11">
          <Plus /> <span className="hidden sm:inline">Adicionar</span>
        </Button>
      </div>
      {errors.title && <p className="mt-1 text-sm text-destructive">{errors.title}</p>}
      <div className="mt-2">
        <TaskOptions key={key} ctx={ctx} errors={errors} layout="inline" />
      </div>
    </form>
  );
}

function TaskSheet({ task, ctx, open, onOpenChange }: { task: TaskItemData; ctx: ListContext; open: boolean; onOpenChange: (o: boolean) => void }) {
  const canChange = ctx.canManage || task.createdBy === ctx.me.id;
  const { result, pending, onSubmit, errors } = useServerForm((form) => saveTaskAction(task.id, form), { onSuccess: () => onOpenChange(false) });
  const created = new Intl.DateTimeFormat('pt-BR', { timeZone: ctx.timezone, dateStyle: 'short', timeStyle: 'short' }).format(task.createdAt);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Tarefa</SheetTitle>
          <SheetDescription>
            Criada{task.createdByName ? ` por ${task.createdByName}` : ''} em {created}.
            {task.doneAt && ` Feita${task.doneByName ? ` por ${task.doneByName}` : ''} ${doneWhen(task.doneAt, ctx)}.`}
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={onSubmit} className="grid gap-5 px-4 pb-6">
          <FormError result={result} />
          <fieldset disabled={pending || !canChange} className="grid gap-5">
            <Field label="Tarefa" htmlFor="task-title" error={errors.title}>
              <Input id="task-title" name="title" defaultValue={task.title} maxLength={200} required />
            </Field>
            <TaskOptions
              ctx={ctx}
              errors={errors}
              layout="stacked"
              initial={{ preset: 'DATA', date: task.dueDate, assigneeId: task.assigneeId, important: task.important }}
            />
            <Field label="Observação (opcional)" htmlFor="task-notes" error={errors.notes}>
              <Textarea id="task-notes" name="notes" defaultValue={task.notes ?? ''} rows={4} maxLength={1000} />
            </Field>
          </fieldset>
          {canChange ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button type="submit" disabled={pending}>
                {pending ? 'Salvando…' : 'Salvar tarefa'}
              </Button>
              <ConfirmAction
                label="Excluir"
                icon={<Trash2 />}
                variant="outline"
                title="Excluir a tarefa?"
                description={`"${task.title}" sai da lista. O registro continua na auditoria.`}
                confirmLabel="Excluir tarefa"
                action={() => deleteTaskAction(task.id)}
              />
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <UserRound className="size-4" /> Só quem criou, o gerente ou o administrador alteram esta tarefa. Você pode marcá-la como feita.
            </p>
          )}
        </form>
      </SheetContent>
    </Sheet>
  );
}
