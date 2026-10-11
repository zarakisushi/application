import { DomainError, type TenantInput } from '@zaraki/core';
import { and, asc, eq, ilike, ne, or } from 'drizzle-orm';
import type { Tx } from '../client';
import { products, tenants } from '../schema';
import { contains, countWhere, paging, statusWhere, toPage, type ListParams } from './common';

// Operações da Matriz sobre a rede: rodam com contexto `platformAdmin`.

export async function listTenants(tx: Tx, params: ListParams) {
  const { page, pageSize, offset } = paging(params);
  const where = and(
    statusWhere(tenants.status, params.status),
    params.q ? or(ilike(tenants.name, contains(params.q)), ilike(tenants.city, contains(params.q))) : undefined,
  );
  const rows = await tx
    .select()
    .from(tenants)
    .where(where)
    .orderBy(asc(tenants.kind), asc(tenants.name))
    .limit(pageSize)
    .offset(offset);
  return toPage(rows, await countWhere(tx, tenants, where), page, pageSize);
}

export async function getTenantById(tx: Pick<Tx, 'select'>, id: string) {
  const [row] = await tx.select().from(tenants).where(eq(tenants.id, id));
  return row ?? null;
}

async function assertSlugFree(tx: Tx, slug: string, exceptId?: string) {
  const [other] = await tx
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.slug, slug), eq(tenants.status, true), exceptId ? ne(tenants.id, exceptId) : undefined));
  if (other) throw new DomainError('Já existe uma unidade ativa com este identificador.');
}

/** Cria um franqueado já com uma cópia do cardápio ativo da unidade modelo (a Matriz). */
export async function createTenant(tx: Tx, input: TenantInput, templateTenantId: string) {
  await assertSlugFree(tx, input.slug);
  const [tenant] = await tx
    .insert(tenants)
    .values({ ...input, kind: 'FRANQUIA' })
    .returning();

  const menu = await tx
    .select()
    .from(products)
    .where(and(eq(products.tenantId, templateTenantId), eq(products.status, true)));
  if (menu.length) {
    await tx.insert(products).values(
      menu.map((p) => ({
        tenantId: tenant!.id,
        name: p.name,
        slug: p.slug,
        description: p.description,
        priceCents: p.priceCents,
        costCents: p.costCents,
        imageUrl: p.imageUrl,
        isSpecial: p.isSpecial,
        sortOrder: p.sortOrder,
      })),
    );
  }
  return tenant!;
}

export async function updateTenant(tx: Tx, id: string, input: TenantInput) {
  await assertSlugFree(tx, input.slug, id);
  const [row] = await tx.update(tenants).set(input).where(eq(tenants.id, id)).returning();
  return row ?? null;
}

export async function setTenantStatus(tx: Tx, id: string, status: boolean) {
  const tenant = await getTenantById(tx, id);
  if (!tenant) throw new DomainError('Unidade não encontrada.');
  if (!status && tenant.kind === 'MATRIZ') throw new DomainError('A Matriz não pode ser desativada.');
  if (status) await assertSlugFree(tx, tenant.slug, id);
  const [row] = await tx.update(tenants).set({ status }).where(eq(tenants.id, id)).returning();
  return row!;
}
