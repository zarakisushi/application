import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { baseColumns, id } from './common';
import { tenants } from './tenancy';

export const products = pgTable(
  'products',
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    name: text().notNull(),
    slug: text().notNull(),
    description: text().notNull().default(''),
    priceCents: integer().notNull(),
    costCents: integer().notNull().default(0),
    imageUrl: text(),
    isSpecial: boolean().notNull().default(false),
    sortOrder: integer().notNull().default(0),
    ...baseColumns(),
  },
  (t) => [
    uniqueIndex('products_tenant_slug_uq').on(t.tenantId, t.slug).where(sql`${t.status}`),
    check('products_price_ck', sql`${t.priceCents} >= 0 and ${t.costCents} >= 0`),
  ],
);

export const customers = pgTable(
  'customers',
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    name: text().notNull(),
    /** Telefone normalizado em E.164 (+5562981092799). */
    phone: text().notNull(),
    email: text(),
    birthday: date({ mode: 'string' }),
    neighborhood: text(),
    address: text(),
    notes: text(),
    ...baseColumns(),
  },
  (t) => [
    uniqueIndex('customers_tenant_phone_uq').on(t.tenantId, t.phone).where(sql`${t.status}`),
    index('customers_tenant_name_idx').on(t.tenantId, t.name),
  ],
);
