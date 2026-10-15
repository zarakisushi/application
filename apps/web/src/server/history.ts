import 'server-only';
import { listRecordHistory, withContext } from '@zaraki/db';
import type { AdminContext } from './admin';

/**
 * Histórico de um registro para a aba "Histórico", ou null sem permissão de auditoria.
 * A Matriz enxerga também o que foi registrado fora da unidade ativa (ex.: logins do usuário).
 */
export async function recordHistory(ctx: AdminContext, entity: string, entityId: string) {
  if (!ctx.can('audit:read')) return null;
  const db = ctx.platformAdmin ? { ...ctx.db, platformAdmin: true } : ctx.db;
  return withContext(db, (tx) => listRecordHistory(tx, entity, entityId));
}
