import { bigserial, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { ts } from './common';

/**
 * Trilha de auditoria append-only com cadeia de hash por unidade.
 * `created_at`, `prev_hash` e `hash` são definidos pelo trigger `audit_chain`;
 * UPDATE, DELETE e TRUNCATE são bloqueados por trigger e por privilégios.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    tenantId: uuid(),
    actorUserId: uuid(),
    actorLabel: text(),
    action: text().notNull(),
    entity: text().notNull(),
    entityId: text(),
    before: jsonb(),
    after: jsonb(),
    changedFields: text().array(),
    ip: text(),
    userAgent: text(),
    requestId: text(),
    createdAt: ts().notNull().defaultNow(),
    prevHash: text(),
    hash: text().notNull().default(''),
  },
  (t) => [
    index('audit_logs_tenant_idx').on(t.tenantId, t.id),
    index('audit_logs_entity_idx').on(t.entity, t.entityId),
    index('audit_logs_actor_idx').on(t.actorUserId, t.createdAt),
    index('audit_logs_ip_idx').on(t.ip, t.createdAt),
  ],
);
