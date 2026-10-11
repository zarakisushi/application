import { sql } from 'drizzle-orm';
import { getDb, type Database } from './client';
import { withContext, type DbContext } from './context';
import { auditLogs } from './schema';

export type AuditEvent = {
  action: 'LOGIN' | 'LOGIN_FAILED' | 'LOGOUT' | 'EXPORT' | 'CALENDAR_SYNC_FAILED' | 'PERMISSION_DENIED' | (string & {});
  entity: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
};

/**
 * Registra um evento de aplicação (login, exportação, falha de integração...).
 * Alterações de dados não passam por aqui: são capturadas pelos triggers do banco.
 */
export function logEvent(ctx: DbContext, event: AuditEvent, db: Database = getDb()) {
  return withContext(
    ctx,
    (tx) =>
      tx.insert(auditLogs).values({
        tenantId: ctx.tenantId ?? null,
        actorUserId: ctx.userId ?? null,
        actorLabel: ctx.actorLabel ?? null,
        action: event.action,
        entity: event.entity,
        entityId: event.entityId ?? null,
        after: event.details ?? null,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
        requestId: ctx.requestId ?? null,
      }),
    db,
  );
}

export type ChainCheck = { ok: boolean; checked: number; brokenAt: number | null };

/** Recalcula a cadeia de hash da auditoria de uma unidade (null = eventos globais). */
export async function verifyAuditChain(tenantId: string | null, db: Database = getDb()): Promise<ChainCheck> {
  const { rows } = await db.execute<{ ok: boolean; checked: string; broken_at: string | null }>(
    sql`select * from audit_verify_chain(${tenantId}::uuid)`,
  );
  const r = rows[0]!;
  return { ok: r.ok, checked: Number(r.checked), brokenAt: r.broken_at === null ? null : Number(r.broken_at) };
}
