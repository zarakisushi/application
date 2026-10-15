import { sql } from 'drizzle-orm';
import { integer, numeric, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { baseColumns, id } from './common';
import { membershipRole, tenantKind } from './enums';

export const tenants = pgTable(
  'tenants',
  {
    id: id(),
    name: text().notNull(),
    slug: text().notNull(),
    kind: tenantKind().notNull().default('FRANQUIA'),
    cnpj: text(),
    /** Domínio próprio da unidade (futuro: resolvido no proxy.ts). */
    domain: text(),
    /** Quando vazio, vale a env WHATSAPP_NUMBER. */
    whatsappNumber: text(),
    /** Quando vazio, vale a env GOOGLE_CALENDAR_ID. */
    calendarId: text(),
    city: text(),
    timezone: text().notNull().default('America/Sao_Paulo'),
    royaltyPct: numeric({ precision: 5, scale: 2 }).notNull().default('0'),
    /** Dia do mês em que vencem os royalties do mês anterior. */
    royaltyDueDay: integer().notNull().default(10),
    orderCodePrefix: text().notNull().default('ZK'),
    ...baseColumns(),
  },
  (t) => [
    uniqueIndex('tenants_slug_uq').on(t.slug).where(sql`${t.status}`),
    uniqueIndex('tenants_domain_uq').on(t.domain).where(sql`${t.status} and ${t.domain} is not null`),
  ],
);

export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    role: membershipRole().notNull(),
    ...baseColumns(),
  },
  (t) => [uniqueIndex('memberships_tenant_user_uq').on(t.tenantId, t.userId).where(sql`${t.status}`)],
);

/** Contador do código sequencial de pedidos por unidade (ZK-000123). Tabela técnica, sem auditoria. */
export const orderCounters = pgTable('order_counters', {
  tenantId: uuid()
    .primaryKey()
    .references(() => tenants.id),
  lastValue: integer().notNull().default(0),
});
