import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, numeric, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { baseColumns, id } from './common';
import { couponKind } from './enums';
import { tenants } from './tenancy';

/**
 * Cupons de desconto. `active` liga/desliga o cupom; `status` é a exclusão lógica.
 * Os usos não ficam guardados aqui: são contados nos pedidos ativos e não cancelados.
 */
export const coupons = pgTable(
  'coupons',
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    code: text().notNull(),
    description: text(),
    kind: couponKind().notNull(),
    percentOff: numeric({ precision: 5, scale: 2 }),
    amountOffCents: integer(),
    minTubes: integer(),
    minSubtotalCents: integer(),
    /** Validade inclusiva, em dias do fuso da unidade. */
    startsAt: date({ mode: 'string' }),
    endsAt: date({ mode: 'string' }),
    maxUses: integer(),
    /** Cupom exclusivo de um cliente (E.164). */
    phone: text(),
    active: boolean().notNull().default(true),
    ...baseColumns(),
  },
  (t) => [
    uniqueIndex('coupons_tenant_code_uq').on(t.tenantId, t.code).where(sql`${t.status}`),
    index('coupons_tenant_active_idx').on(t.tenantId, t.active),
    check(
      'coupons_value_ck',
      sql`(${t.kind} = 'PERCENT' and ${t.percentOff} > 0 and ${t.percentOff} <= 100 and ${t.amountOffCents} is null)
          or (${t.kind} = 'FIXED' and ${t.amountOffCents} > 0 and ${t.percentOff} is null)`,
    ),
    check('coupons_limits_ck', sql`coalesce(${t.maxUses}, 1) >= 1 and coalesce(${t.minTubes}, 1) >= 1 and coalesce(${t.minSubtotalCents}, 0) >= 0`),
    check('coupons_dates_ck', sql`${t.startsAt} is null or ${t.endsAt} is null or ${t.endsAt} >= ${t.startsAt}`),
    check('coupons_exclusive_ck', sql`${t.phone} is null or ${t.maxUses} = 1`),
  ],
);
