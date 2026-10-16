import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, numeric, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { products } from './catalog';
import { baseColumns, id } from './common';
import { stockKind, stockMovementKind } from './enums';
import { financeAttachments, financeCategories } from './finance';
import { orders } from './orders';
import { tenants } from './tenancy';

const tenantId = () =>
  uuid()
    .notNull()
    .references(() => tenants.id);

/** Quantidades com 3 casas (gramas em kg, ml em litros). */
const qty = () => numeric({ precision: 14, scale: 3 });

/** Itens controlados no estoque da unidade: insumos, tubos e embalagens, materiais de marketing... */
export const stockItems = pgTable(
  'stock_items',
  {
    id: id(),
    tenantId: tenantId(),
    name: text().notNull(),
    kind: stockKind().notNull(),
    unit: text().notNull(),
    /** Abaixo disso o item aparece como "repor". */
    minQty: qty().notNull().default('0'),
    /** Categoria do Financeiro usada quando o item é comprado (ex.: Insumos, Embalagens, Marketing). */
    financeCategoryId: uuid().references(() => financeCategories.id),
    supplier: text(),
    active: boolean().notNull().default(true),
    ...baseColumns(),
  },
  (t) => [
    uniqueIndex('stock_items_tenant_name_uq').on(t.tenantId, t.name).where(sql`${t.status}`),
    check('stock_items_unit_ck', sql`${t.unit} in ('un', 'kg', 'g', 'l', 'ml', 'pct', 'cx', 'folha', 'rolo', 'm')`),
    check('stock_items_min_ck', sql`${t.minQty} >= 0`),
  ],
);

/** Compras de estoque: entram no estoque (movimentações COMPRA) e viram contas a pagar no Financeiro. */
export const stockPurchases = pgTable(
  'stock_purchases',
  {
    id: id(),
    tenantId: tenantId(),
    supplier: text().notNull(),
    purchasedOn: date({ mode: 'string' }).notNull(),
    dueDate: date({ mode: 'string' }).notNull(),
    totalCents: integer().notNull(),
    /** Nota fiscal (arquivo privado no banco, como os comprovantes do Financeiro). */
    attachmentId: uuid().references(() => financeAttachments.id),
    notes: text(),
    /** Lançamentos criados no Financeiro (um por categoria dos itens). */
    financeEntryIds: uuid().array().notNull().default(sql`'{}'`),
    ...baseColumns(),
  },
  (t) => [index('stock_purchases_tenant_date_idx').on(t.tenantId, t.purchasedOn), check('stock_purchases_total_ck', sql`${t.totalCents} > 0`)],
);

/**
 * Movimentações: o saldo de um item é a soma das ativas. Entradas (compra, outra entrada) são positivas;
 * saídas (pedido, perda, consumo) negativas; o ajuste de contagem pode ser dos dois sinais.
 */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: id(),
    tenantId: tenantId(),
    itemId: uuid()
      .notNull()
      .references(() => stockItems.id),
    kind: stockMovementKind().notNull(),
    qty: qty().notNull(),
    /** Valor da linha na compra (base do custo médio). */
    totalCents: integer(),
    occurredOn: date({ mode: 'string' }).notNull(),
    orderId: uuid().references(() => orders.id),
    purchaseId: uuid().references(() => stockPurchases.id),
    notes: text(),
    ...baseColumns(),
  },
  (t) => [
    index('stock_movements_item_idx').on(t.itemId, t.occurredOn),
    index('stock_movements_tenant_date_idx').on(t.tenantId, t.occurredOn),
    index('stock_movements_order_idx').on(t.orderId),
    index('stock_movements_purchase_idx').on(t.purchaseId),
    check(
      'stock_movements_sign_ck',
      sql`(${t.kind} in ('COMPRA', 'ENTRADA') and ${t.qty} > 0)
          or (${t.kind} in ('PEDIDO', 'PERDA', 'CONSUMO') and ${t.qty} < 0)
          or (${t.kind} = 'AJUSTE' and ${t.qty} <> 0)`,
    ),
    check('stock_movements_purchase_ck', sql`(${t.kind} = 'COMPRA') = (${t.purchaseId} is not null and ${t.totalCents} is not null)`),
    check('stock_movements_order_ck', sql`(${t.kind} = 'PEDIDO') = (${t.orderId} is not null)`),
  ],
);

/** Ficha técnica: quanto de cada item vai em 1 tubo do sabor (baixa automática quando o pedido é entregue). */
export const productRecipes = pgTable(
  'product_recipes',
  {
    id: id(),
    tenantId: tenantId(),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    itemId: uuid()
      .notNull()
      .references(() => stockItems.id),
    qty: qty().notNull(),
    ...baseColumns(),
  },
  (t) => [
    uniqueIndex('product_recipes_product_item_uq').on(t.productId, t.itemId).where(sql`${t.status}`),
    check('product_recipes_qty_ck', sql`${t.qty} > 0`),
  ],
);
