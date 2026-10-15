import { and, asc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { createDb, logEvent, verifyAuditChain, withContext, type DbContext } from '../src';
import { accounts, auditLogs, products, tenants, users } from '../src/schema';

const app = createDb(inject('appUrl'), 10); // papel zaraki_app: RLS, sem DELETE
const owner = createDb(inject('ownerUrl')); // dono do banco (superusuário local)

afterAll(async () => {
  await app.$client.end();
  await owner.$client.end();
});

async function newTenant() {
  const [t] = await withContext(
    { platformAdmin: true, actorLabel: 'test' },
    (tx) => tx.insert(tenants).values({ name: 'Unidade teste', slug: `t-${randomUUID()}` }).returning(),
    app,
  );
  return t!;
}

async function newProduct(tenantId: string, ctx: DbContext = {}) {
  const [p] = await withContext(
    { tenantId, ...ctx },
    (tx) =>
      tx
        .insert(products)
        .values({ tenantId, name: 'Uramaki', slug: `p-${randomUUID()}`, priceCents: 5000 })
        .returning(),
    app,
  );
  return p!;
}

function auditOf(entityId: string) {
  return owner.select().from(auditLogs).where(eq(auditLogs.entityId, entityId)).orderBy(asc(auditLogs.id));
}

/** Código de erro do Postgres (o Drizzle embrulha o erro original em `cause`). */
async function pgError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } };
    return err.cause?.code ?? err.code ?? 'sem-codigo';
  }
  throw new Error('a operação deveria ter falhado');
}

describe('exclusão lógica', () => {
  it('a aplicação não tem permissão de DELETE', async () => {
    const t = await newTenant();
    const p = await newProduct(t.id);
    const code = await pgError(
      withContext({ tenantId: t.id }, (tx) => tx.delete(products).where(eq(products.id, p.id)), app),
    );
    expect(code).toBe('42501'); // insufficient_privilege
  });

  it('nem o dono do banco consegue DELETE físico', async () => {
    const t = await newTenant();
    const p = await newProduct(t.id);
    expect(await pgError(owner.delete(products).where(eq(products.id, p.id)))).toBe('23001'); // restrict_violation
  });

  it('status false → true é auditado como SOFT_DELETE e RESTORE', async () => {
    const t = await newTenant();
    const p = await newProduct(t.id);
    for (const status of [false, true]) {
      await withContext({ tenantId: t.id }, (tx) => tx.update(products).set({ status }).where(eq(products.id, p.id)), app);
    }
    expect((await auditOf(p.id)).map((a) => a.action)).toEqual(['CREATE', 'SOFT_DELETE', 'RESTORE']);
  });
});

describe('auditoria', () => {
  it('carimba autoria e registra ator, IP, requisição e campos alterados', async () => {
    const t = await newTenant();
    const userId = randomUUID();
    const ctx = { userId, ip: '200.10.20.30', userAgent: 'vitest', requestId: 'req-1' };
    const p = await newProduct(t.id, ctx);
    expect(p.createdBy).toBe(userId);

    await withContext(
      { tenantId: t.id, ...ctx },
      (tx) => tx.update(products).set({ priceCents: 6000 }).where(eq(products.id, p.id)),
      app,
    );
    const [, update] = await auditOf(p.id);
    expect(update).toMatchObject({
      action: 'UPDATE',
      tenantId: t.id,
      actorUserId: userId,
      ip: '200.10.20.30',
      userAgent: 'vitest',
      requestId: 'req-1',
      changedFields: ['price_cents'],
    });
    expect((update!.before as { price_cents: number }).price_cents).toBe(5000);
    expect((update!.after as { price_cents: number }).price_cents).toBe(6000);
  });

  it('não deixa a aplicação falsificar created_by nem created_at', async () => {
    const t = await newTenant();
    const userId = randomUUID();
    const [p] = await withContext(
      { tenantId: t.id, userId },
      (tx) =>
        tx
          .insert(products)
          .values({
            tenantId: t.id,
            name: 'X',
            slug: `p-${randomUUID()}`,
            priceCents: 1,
            createdBy: randomUUID(),
            createdAt: new Date('2000-01-01'),
          })
          .returning(),
      app,
    );
    expect(p!.createdBy).toBe(userId);
    expect(p!.createdAt.getFullYear()).toBeGreaterThan(2000);
  });

  it('senhas e tokens nunca entram na auditoria', async () => {
    const t = await newTenant();
    await withContext(
      { tenantId: t.id, actorLabel: 'test' },
      async (tx) => {
        const [u] = await tx
          .insert(users)
          .values({ name: 'Ana', email: `${randomUUID()}@zaraki.test` })
          .returning();
        await tx
          .insert(accounts)
          .values({ userId: u!.id, accountId: u!.id, providerId: 'credential', password: 'hash-secreto' });
      },
      app,
    );
    const rows = await owner
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, t.id), eq(auditLogs.entity, 'accounts')));
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]!.after)).not.toContain('hash-secreto');
  });

  it('audit_logs é somente inserção, para a aplicação e para o dono', async () => {
    const t = await newTenant();
    const p = await newProduct(t.id);
    const [row] = await auditOf(p.id);
    const tamper = (db: Pick<typeof app, 'update'>) =>
      db.update(auditLogs).set({ action: 'X' }).where(eq(auditLogs.id, row!.id));

    expect(await pgError(withContext({ tenantId: t.id }, (tx) => tamper(tx), app))).toBe('42501');
    expect(await pgError(tamper(owner))).toBe('42501');
    expect(await pgError(owner.delete(auditLogs).where(eq(auditLogs.id, row!.id)))).toBe('42501');
    expect(await pgError(owner.execute(sql`truncate audit_logs`))).toBe('42501');
  });

  it('a cadeia de hash fica íntegra com gravações concorrentes e inclui eventos de aplicação', async () => {
    const t = await newTenant();
    await Promise.all(Array.from({ length: 20 }, () => newProduct(t.id)));
    await logEvent({ tenantId: t.id, actorLabel: 'test', ip: '1.1.1.1' }, { action: 'LOGIN', entity: 'users' }, app);

    // criação da unidade + 20 produtos + login
    const check = await verifyAuditChain(t.id, app);
    expect(check).toEqual({ ok: true, checked: 22, brokenAt: null });
  });

  it('a verificação detecta adulteração feita direto no banco', async () => {
    const t = await newTenant();
    const p = await newProduct(t.id);
    await withContext({ tenantId: t.id }, (tx) => tx.update(products).set({ priceCents: 1 }).where(eq(products.id, p.id)), app);
    const [, update] = await auditOf(p.id);

    // Simula alguém com acesso de dono desligando a proteção para "maquiar" um registro.
    await owner.execute(sql`alter table audit_logs disable trigger audit_logs_immutable`);
    await owner.execute(sql`update audit_logs set after = after || '{"price_cents": 5000}' where id = ${update!.id}`);
    await owner.execute(sql`alter table audit_logs enable trigger audit_logs_immutable`);

    // criação da unidade, criação do produto e a alteração adulterada
    expect(await verifyAuditChain(t.id, app)).toEqual({ ok: false, checked: 3, brokenAt: update!.id });
  });
});

describe('isolamento entre unidades (RLS)', () => {
  it('cada unidade só enxerga e altera os próprios dados', async () => {
    const [a, b] = [await newTenant(), await newTenant()];
    const pa = await newProduct(a.id);
    const pb = await newProduct(b.id);

    await withContext(
      { tenantId: a.id },
      async (tx) => {
        const visible = await tx.select({ id: products.id, tenantId: products.tenantId }).from(products);
        expect(visible.map((r) => r.id)).toContain(pa.id);
        expect(visible.every((r) => r.tenantId === a.id)).toBe(true);

        const updated = await tx.update(products).set({ priceCents: 1 }).where(eq(products.id, pb.id)).returning();
        expect(updated).toHaveLength(0);

        const audit = await tx.select({ tenantId: auditLogs.tenantId }).from(auditLogs);
        expect(audit.every((r) => r.tenantId === a.id)).toBe(true);
      },
      app,
    );
  });

  it('não permite gravar dados em outra unidade', async () => {
    const [a, b] = [await newTenant(), await newTenant()];
    const code = await pgError(
      withContext(
        { tenantId: a.id },
        (tx) => tx.insert(products).values({ tenantId: b.id, name: 'X', slug: `p-${randomUUID()}`, priceCents: 1 }),
        app,
      ),
    );
    expect(code).toBe('42501');
  });

  it('sem unidade no contexto, nenhum dado de negócio é visível', async () => {
    const t = await newTenant();
    await newProduct(t.id);
    const rows = await withContext({}, (tx) => tx.select().from(products), app);
    expect(rows).toHaveLength(0);
  });

  it('a Matriz (platform admin) enxerga todas as unidades', async () => {
    const [a, b] = [await newTenant(), await newTenant()];
    const [pa, pb] = [await newProduct(a.id), await newProduct(b.id)];
    const ids = await withContext({ platformAdmin: true }, async (tx) =>
      (await tx.select({ id: products.id }).from(products)).map((r) => r.id),
    app);
    expect(ids).toEqual(expect.arrayContaining([pa.id, pb.id]));
  });
});
