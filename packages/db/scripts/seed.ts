// Seed idempotente: unidade MATRIZ e cardápio inicial. Usuários são criados na fase de autenticação.
import { requireEnv } from './env';
import { DEFAULT_MENU } from '@zaraki/core';
import { and, eq } from 'drizzle-orm';
import { createDb } from '../src/client';
import { withContext } from '../src/context';
import { ensureFinanceDefaults } from '../src/finance';
import { products, tenants } from '../src/schema';

const db = createDb(requireEnv('DATABASE_URL'), 1);
const slug = process.env.DEFAULT_TENANT_SLUG ?? 'matriz';

await withContext({ platformAdmin: true, actorLabel: 'seed' }, async (tx) => {
  let [tenant] = await tx
    .select()
    .from(tenants)
    .where(and(eq(tenants.slug, slug), eq(tenants.status, true)));
  if (!tenant) {
    [tenant] = await tx
      .insert(tenants)
      .values({ name: 'Zaraki Sushi — Matriz', slug, kind: 'MATRIZ', city: 'Goiânia' })
      .returning();
    console.log(`Unidade criada: ${tenant!.name}`);
  }

  for (const [i, item] of DEFAULT_MENU.entries()) {
    const [existing] = await tx
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.tenantId, tenant!.id), eq(products.slug, item.slug), eq(products.status, true)));
    if (existing) continue;
    await tx.insert(products).values({ ...item, tenantId: tenant!.id, sortOrder: i + 1 });
    console.log(`Produto criado: ${item.name}`);
  }
  await ensureFinanceDefaults(tx, tenant!.id);
}, db);

await db.$client.end();
console.log('Seed concluído.');
