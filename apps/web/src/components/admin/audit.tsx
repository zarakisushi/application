import {
  AUDIT_ACTION_LABEL,
  AUDIT_ENTITY_LABEL,
  auditActor,
  auditChanges,
  auditRecordTitle,
  type AuditEntry,
} from '@zaraki/core';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { auditRecordHref } from '@/lib/audit';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const ACTION_STYLE: Record<string, string> = {
  CREATE: 'border-emerald-600/30 bg-emerald-50 text-emerald-800',
  UPDATE: 'border-sky-500/30 bg-sky-50 text-sky-800',
  SOFT_DELETE: 'border-brand-red/30 bg-red-50 text-brand-red',
  RESTORE: 'border-violet-500/30 bg-violet-50 text-violet-800',
  LOGIN_FAILED: 'border-amber-500/40 bg-amber-50 text-amber-800',
  LOGIN_BLOCKED: 'border-brand-red/30 bg-red-50 text-brand-red',
  PERMISSION_DENIED: 'border-brand-red/30 bg-red-50 text-brand-red',
  CALENDAR_SYNC_FAILED: 'border-brand-red/30 bg-red-50 text-brand-red',
};

export function AuditActionBadge({ action }: { action: string }) {
  return (
    <Badge variant="outline" className={ACTION_STYLE[action]}>
      {AUDIT_ACTION_LABEL[action] ?? action}
    </Badge>
  );
}

export type AuditRow = AuditEntry & {
  id: number;
  createdAt: Date;
  entityId: string | null;
  actorName: string | null;
  actorLabel: string | null;
  ip: string | null;
};

/** "Sabor do cardápio · Hot Roll" com link para o registro, quando houver. */
export function AuditRecord({ row }: { row: AuditRow }) {
  const title = auditRecordTitle(row);
  const href = auditRecordHref(row.entity, row.entityId, row.after ?? row.before);
  const label = `${AUDIT_ENTITY_LABEL[row.entity] ?? row.entity}${title ? ` · ${title}` : ''}`;
  return href ? (
    <Link href={href} className="hover:underline">
      {label}
    </Link>
  ) : (
    <span>{label}</span>
  );
}

/** Tabela "Campo · Antes · Depois" de uma entrada da auditoria. */
export function AuditChangesTable({ row, timezone, compact }: { row: AuditEntry; timezone: string; compact?: boolean }) {
  const changes = auditChanges(row, timezone);
  if (!changes.length) return <p className="text-sm text-muted-foreground">Sem detalhes adicionais.</p>;
  const showBefore = row.action !== 'CREATE' && !!row.before;
  return (
    <Table className={cn(compact && 'text-xs')}>
      <TableHeader>
        <TableRow>
          <TableHead>Campo</TableHead>
          {showBefore && <TableHead>Antes</TableHead>}
          <TableHead>{showBefore ? 'Depois' : 'Valor'}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {changes.map((c) => (
          <TableRow key={c.field}>
            <TableCell className="font-medium">{c.label}</TableCell>
            {showBefore && <TableCell className="text-muted-foreground line-through decoration-brand-red/40">{c.before}</TableCell>}
            <TableCell className={cn('whitespace-pre-wrap', showBefore && 'bg-emerald-50/60')}>{c.after}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Linha do tempo das alterações de um registro (aba "Histórico"). */
export function RecordHistory({ rows, timezone }: { rows: AuditRow[]; timezone: string }) {
  if (!rows.length) return <p className="py-8 text-center text-muted-foreground">Nenhuma alteração registrada.</p>;
  return (
    <ol className="grid gap-6 border-l-2 border-brand-gold/40 pl-6">
      {[...rows].reverse().map((row) => (
        <li key={row.id} className="relative">
          <span className="absolute top-1.5 -left-[31px] size-3 rounded-full border-2 border-background bg-brand-gold" />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <AuditActionBadge action={row.action} />
            <span className="font-medium">{AUDIT_ENTITY_LABEL[row.entity] ?? row.entity}</span>
            <span className="text-muted-foreground">
              {formatDateTime(row.createdAt, timezone)} · {auditActor(row.actorName, row.actorLabel)}
            </span>
            <Link href={`/admin/auditoria/${row.id}`} className="text-xs text-muted-foreground underline">
              #{row.id}
            </Link>
          </div>
          <div className="mt-2 overflow-hidden rounded-md border bg-card">
            <AuditChangesTable row={row} timezone={timezone} compact />
          </div>
        </li>
      ))}
    </ol>
  );
}
