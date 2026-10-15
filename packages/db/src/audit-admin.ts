import { and, asc, desc, eq, gte, ilike, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from './client';
import { auditLogs, users } from './schema';
import { contains, paging } from './admin/common';

export type AuditScope = { tenantId: string } | 'global';

export type AuditListParams = {
  scope: AuditScope;
  action?: string;
  entity?: string;
  actorUserId?: string;
  /** Busca no id do registro, no rótulo do ator (ex.: e-mail de login) ou no IP. */
  q?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
};

const actor = alias(users, 'actor');

const fields = {
  id: auditLogs.id,
  tenantId: auditLogs.tenantId,
  createdAt: auditLogs.createdAt,
  action: auditLogs.action,
  entity: auditLogs.entity,
  entityId: auditLogs.entityId,
  changedFields: auditLogs.changedFields,
  before: auditLogs.before,
  after: auditLogs.after,
  actorUserId: auditLogs.actorUserId,
  actorLabel: auditLogs.actorLabel,
  actorName: actor.name,
  ip: auditLogs.ip,
};

const scopeWhere = (scope: AuditScope) => (scope === 'global' ? isNull(auditLogs.tenantId) : eq(auditLogs.tenantId, scope.tenantId));

/** Trilha de auditoria, mais recente primeiro. Eventos globais (logins) exigem contexto da Matriz. */
export async function listAuditLogs(tx: Tx, params: AuditListParams) {
  const { page, pageSize, offset } = paging({ page: params.page, pageSize: params.pageSize ?? 30 });
  const where = and(
    scopeWhere(params.scope),
    params.action ? eq(auditLogs.action, params.action) : undefined,
    params.entity ? eq(auditLogs.entity, params.entity) : undefined,
    params.actorUserId ? eq(auditLogs.actorUserId, params.actorUserId) : undefined,
    params.from ? gte(auditLogs.createdAt, params.from) : undefined,
    params.to ? lt(auditLogs.createdAt, params.to) : undefined,
    params.q
      ? or(
          eq(auditLogs.entityId, params.q.trim()),
          ilike(auditLogs.actorLabel, contains(params.q)),
          eq(auditLogs.ip, params.q.trim()),
        )
      : undefined,
  );
  // Busca uma linha a mais para saber se há próxima página sem contar a tabela inteira (ela só cresce).
  const rows = await tx
    .select(fields)
    .from(auditLogs)
    .leftJoin(actor, eq(actor.id, auditLogs.actorUserId))
    .where(where)
    .orderBy(desc(auditLogs.id))
    .limit(pageSize + 1)
    .offset(offset);
  return { rows: rows.slice(0, pageSize), page, pageSize, hasNext: rows.length > pageSize };
}

export async function getAuditLog(tx: Tx, id: number) {
  const [row] = await tx
    .select({ ...fields, userAgent: auditLogs.userAgent, requestId: auditLogs.requestId, hash: auditLogs.hash, prevHash: auditLogs.prevHash })
    .from(auditLogs)
    .leftJoin(actor, eq(actor.id, auditLogs.actorUserId))
    .where(eq(auditLogs.id, id));
  return row ?? null;
}

/** Quem aparece como autor na trilha da unidade (para o filtro por pessoa). */
export function listAuditActors(tx: Tx, scope: AuditScope) {
  return tx
    .selectDistinct({ id: actor.id, name: actor.name })
    .from(auditLogs)
    .innerJoin(actor, eq(actor.id, auditLogs.actorUserId))
    .where(scopeWhere(scope))
    .orderBy(asc(actor.name));
}

/**
 * Histórico completo de um registro, em ordem cronológica. Pedidos incluem itens e mudanças de
 * etapa; usuários incluem credenciais, vínculos e eventos de login/senha.
 */
export function listRecordHistory(tx: Tx, entity: string, entityId: string) {
  const conditions: SQL[] = [and(eq(auditLogs.entity, entity), eq(auditLogs.entityId, entityId))!];
  if (entity === 'orders') {
    conditions.push(
      and(
        sql`${auditLogs.entity} in ('order_items', 'order_stage_history')`,
        sql`${auditLogs.after} ->> 'order_id' = ${entityId}`,
      )!,
    );
  }
  if (entity === 'users') {
    conditions.push(
      and(sql`${auditLogs.entity} in ('accounts', 'memberships')`, sql`${auditLogs.after} ->> 'user_id' = ${entityId}`)!,
    );
  }
  return tx
    .select(fields)
    .from(auditLogs)
    .leftJoin(actor, eq(actor.id, auditLogs.actorUserId))
    .where(or(...conditions))
    .orderBy(asc(auditLogs.id))
    .limit(500);
}
