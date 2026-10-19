import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, smallint, text, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { baseColumns, id } from './common';
import { tenants } from './tenancy';

/**
 * Fornecedores de cada unidade. A Matriz pode compartilhar fornecedores com a rede (network_shared): as
 * franquias os veem só para consulta e podem copiá-los para o próprio cadastro (copied_from_id).
 */
export const suppliers = pgTable(
  'suppliers',
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    personKind: text().notNull().default('PJ'),
    name: text().notNull(),
    legalName: text(),
    /** CNPJ ou CPF, só dígitos. */
    document: text(),
    stateRegistration: text(),
    categories: text().array().notNull().default(sql`'{}'::text[]`),
    contactName: text(),
    /** Telefones em E.164 (+5562...). */
    whatsapp: text(),
    phone: text(),
    email: text(),
    website: text(),
    cep: text(),
    street: text(),
    number: text(),
    complement: text(),
    district: text(),
    city: text(),
    state: text(),
    /** Dias de entrega (0 = domingo ... 6 = sábado). */
    deliveryDays: smallint().array().notNull().default(sql`'{}'::smallint[]`),
    minOrderCents: integer().notNull().default(0),
    paymentTerms: text(),
    paymentMethods: text().array().notNull().default(sql`'{}'::text[]`),
    pixKey: text(),
    bankDetails: text(),
    rating: smallint(),
    notes: text(),
    networkShared: boolean().notNull().default(false),
    copiedFromId: uuid().references((): AnyPgColumn => suppliers.id),
    ...baseColumns(),
  },
  (t) => [
    uniqueIndex('suppliers_tenant_document_uq').on(t.tenantId, t.document).where(sql`${t.status} and ${t.document} is not null`),
    index('suppliers_tenant_name_idx').on(t.tenantId, t.name).where(sql`${t.status}`),
    index('suppliers_network_idx').on(t.networkShared).where(sql`${t.status} and ${t.networkShared}`),
    check('suppliers_person_kind_ck', sql`${t.personKind} in ('PJ', 'PF')`),
    check('suppliers_name_ck', sql`length(${t.name}) between 1 and 120`),
    check('suppliers_document_ck', sql`${t.document} is null or ${t.document} ~ '^[0-9]{11}$|^[0-9]{14}$'`),
    check('suppliers_state_ck', sql`${t.state} is null or ${t.state} ~ '^[A-Z]{2}$'`),
    check('suppliers_rating_ck', sql`${t.rating} is null or ${t.rating} between 1 and 5`),
    check('suppliers_delivery_days_ck', sql`${t.deliveryDays} <@ '{0,1,2,3,4,5,6}'::smallint[]`),
    check('suppliers_min_order_ck', sql`${t.minOrderCents} >= 0`),
  ],
);
