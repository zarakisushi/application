import { slugify, type ProductInput } from '@zaraki/core';
import { and, asc, eq, ilike, like, or } from 'drizzle-orm';
import type { Tx } from '../client';
import { products } from '../schema';
import { contains, countWhere, paging, statusWhere, toPage, type ListParams } from './common';

export type Product = typeof products.$inferSelect;

export async function listProducts(tx: Tx, tenantId: string, params: ListParams) {
  const { page, pageSize, offset } = paging(params);
  const where = and(
    eq(products.tenantId, tenantId),
    statusWhere(products.status, params.status),
    params.q ? or(ilike(products.name, contains(params.q)), ilike(products.description, contains(params.q))) : undefined,
  );
  const rows = await tx
    .select()
    .from(products)
    .where(where)
    .orderBy(asc(products.sortOrder), asc(products.name))
    .limit(pageSize)
    .offset(offset);
  return toPage(rows, await countWhere(tx, products, where), page, pageSize);
}

export async function getProduct(tx: Tx, tenantId: string, id: string) {
  const [row] = await tx.select().from(products).where(and(eq(products.tenantId, tenantId), eq(products.id, id)));
  return row ?? null;
}

/** Slug único entre os produtos ativos da unidade ("salmao", "salmao-2"...). */
async function uniqueSlug(tx: Tx, tenantId: string, name: string) {
  const base = slugify(name) || 'produto';
  const taken = new Set(
    (
      await tx
        .select({ slug: products.slug })
        .from(products)
        .where(and(eq(products.tenantId, tenantId), eq(products.status, true), like(products.slug, `${base}%`)))
    ).map((r) => r.slug),
  );
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
  return slug;
}

const columns = (input: ProductInput) => ({
  name: input.name,
  description: input.description,
  priceCents: input.price,
  costCents: input.cost,
  imageUrl: input.imageUrl,
  isSpecial: input.isSpecial,
  sortOrder: input.sortOrder,
});

export async function createProduct(tx: Tx, tenantId: string, input: ProductInput) {
  const [row] = await tx
    .insert(products)
    .values({ ...columns(input), tenantId, slug: await uniqueSlug(tx, tenantId, input.name) })
    .returning();
  return row!;
}

export async function updateProduct(tx: Tx, tenantId: string, id: string, input: ProductInput) {
  const [row] = await tx
    .update(products)
    .set(columns(input))
    .where(and(eq(products.tenantId, tenantId), eq(products.id, id)))
    .returning();
  return row ?? null;
}

export async function setProductStatus(tx: Tx, tenantId: string, id: string, status: boolean) {
  const [row] = await tx
    .update(products)
    .set({ status })
    .where(and(eq(products.tenantId, tenantId), eq(products.id, id)))
    .returning();
  return row ?? null;
}
