import { supplierSchema } from '@zaraki/core';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  copyNetworkSupplier,
  createSupplier,
  createDb,
  getSupplier,
  listSupplierCities,
  listSuppliers,
  setSupplierStatus,
  updateSupplier,
  withContext,
} from '../src';
import { auditLogs, suppliers, tenants } from '../src/schema';

const db = createDb(inject('appUrl'), 5);
const owner = createDb(inject('ownerUrl'), 2);
afterAll(async () => {
  await db.$client.end();
  await owner.$client.end();
});

type Tenant = typeof tenants.$inferSelect;
let matriz: Tenant;
let franquia: Tenant;
let outra: Tenant;
const run = <T>(t: Tenant, fn: Parameters<typeof withContext<T>>[1]) => withContext({ tenantId: t.id, actorLabel: 'teste' }, fn, db);
const input = (data: Record<string, unknown>) => supplierSchema.parse({ whatsapp: '62 98109-2799', ...data });
const names = (rows: { name: string }[]) => rows.map((r) => r.name);

beforeAll(async () => {
  await withContext(
    { platformAdmin: true, actorLabel: 'teste' },
    async (tx) => {
      [matriz] = (await tx.insert(tenants).values({ name: 'Matriz Fornecedores', slug: `m-${randomUUID()}`, kind: 'MATRIZ' }).returning()) as [Tenant];
      [franquia] = (await tx.insert(tenants).values({ name: 'Franquia Fornecedores', slug: `f-${randomUUID()}` }).returning()) as [Tenant];
      [outra] = (await tx.insert(tenants).values({ name: 'Outra Franquia', slug: `f-${randomUUID()}` }).returning()) as [Tenant];
    },
    db,
  );
});

describe('cadastro de fornecedores', () => {
  it('cria, edita, busca por CNPJ com ou sem máscara e filtra por categoria, cidade e dia de entrega', async () => {
    const peixe = await run(franquia, (tx) =>
      createSupplier(tx, franquia.id, input({ name: 'Peixaria do Lago', document: '11.222.333/0001-81', categories: 'PEIXES', city: 'Goiânia', deliveryDays: '2,5' })),
    );
    await run(franquia, (tx) => createSupplier(tx, franquia.id, input({ name: 'Gráfica Rápida', categories: 'GRAFICA', city: 'Anápolis', deliveryDays: '1' })));

    const list = (p: Parameters<typeof listSuppliers>[2]) => run(franquia, (tx) => listSuppliers(tx, franquia.id, { origin: 'meus', ...p }));
    expect(names((await list({ q: '11.222.333/0001-81' })).rows)).toEqual(['Peixaria do Lago']);
    expect(names((await list({ q: '11222333' })).rows)).toEqual(['Peixaria do Lago']);
    expect(names((await list({ q: '98109' })).rows)).toEqual(['Gráfica Rápida', 'Peixaria do Lago']);
    expect(names((await list({ category: 'GRAFICA' })).rows)).toEqual(['Gráfica Rápida']);
    expect(names((await list({ city: 'goiânia' })).rows)).toEqual(['Peixaria do Lago']);
    expect(names((await list({ deliveryDay: 5 })).rows)).toEqual(['Peixaria do Lago']);
    expect(await run(franquia, (tx) => listSupplierCities(tx, franquia.id))).toEqual(expect.arrayContaining(['Anápolis', 'Goiânia']));

    const edited = await run(franquia, (tx) => updateSupplier(tx, franquia.id, peixe.id, input({ name: 'Peixaria do Lago', document: '11222333000181', rating: '5' })));
    expect(edited.rating).toBe(5);
    const logs = await owner.select().from(auditLogs).where(and(eq(auditLogs.entity, 'suppliers'), eq(auditLogs.entityId, peixe.id)));
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(['CREATE', 'UPDATE']));
  });

  it('não repete o CNPJ na mesma unidade; excluir é lógico e o banco não deixa apagar', async () => {
    await expect(run(franquia, (tx) => createSupplier(tx, franquia.id, input({ name: 'Duplicado', document: '11222333000181' })))).rejects.toThrow(
      'Este CNPJ/CPF já está cadastrado: Peixaria do Lago.',
    );
    // Em outra unidade o mesmo CNPJ pode existir.
    await run(outra, (tx) => createSupplier(tx, outra.id, input({ name: 'Peixaria do Lago', document: '11222333000181' })));

    const [g] = (await run(franquia, (tx) => listSuppliers(tx, franquia.id, { q: 'Gráfica' }))).rows;
    await run(franquia, (tx) => setSupplierStatus(tx, franquia.id, g!.id, false));
    expect(names((await run(franquia, (tx) => listSuppliers(tx, franquia.id, { origin: 'meus' }))).rows)).toEqual(['Peixaria do Lago']);
    expect(names((await run(franquia, (tx) => listSuppliers(tx, franquia.id, { origin: 'meus', status: 'inativos' }))).rows)).toEqual(['Gráfica Rápida']);
    await expect(run(franquia, (tx) => tx.execute(sql`delete from suppliers where id = ${g!.id}`))).rejects.toThrow();
  });
});

describe('fornecedores da rede', () => {
  let shared: string;
  let notShared: string;

  beforeAll(async () => {
    shared = (await run(matriz, (tx) => createSupplier(tx, matriz.id, input({ name: 'Atacado Rede Teste', categories: 'MERCEARIA', networkShared: 'on' })))).id;
    notShared = (await run(matriz, (tx) => createSupplier(tx, matriz.id, input({ name: 'Interno da Matriz Teste' })))).id;
  });

  it('a franquia vê só os compartilhados pela Matriz, sem poder alterar', async () => {
    const rede = await run(franquia, (tx) => listSuppliers(tx, franquia.id, { origin: 'rede', q: 'Teste' }));
    expect(rede.rows.map((r) => [r.name, r.fromNetwork])).toEqual([['Atacado Rede Teste', true]]);
    expect(await run(franquia, (tx) => getSupplier(tx, franquia.id, notShared))).toBeNull();
    expect(await run(franquia, (tx) => getSupplier(tx, franquia.id, shared))).toMatchObject({ editable: false, fromNetwork: true, copyId: null });

    // Nem pela função nem direto no banco: o RLS não deixa a franquia alterar o fornecedor da Matriz.
    await expect(run(franquia, (tx) => updateSupplier(tx, franquia.id, shared, input({ name: 'Hackeado' })))).rejects.toThrow('Fornecedor não encontrado.');
    const changed = await run(franquia, (tx) => tx.update(suppliers).set({ name: 'Hackeado' }).where(eq(suppliers.id, shared)).returning());
    expect(changed).toEqual([]);
  });

  it('só a Matriz compartilha; a cópia é única e editável', async () => {
    await expect(run(franquia, (tx) => createSupplier(tx, franquia.id, input({ name: 'Quero compartilhar', networkShared: 'on' })))).rejects.toMatchObject({
      cause: { message: 'Só a Matriz compartilha fornecedores com a rede' },
    });
    const first = await run(franquia, (tx) => copyNetworkSupplier(tx, franquia.id, shared));
    expect(first.created).toBe(true);
    expect(await run(franquia, (tx) => copyNetworkSupplier(tx, franquia.id, shared))).toEqual({ id: first.id, created: false });
    expect(await run(franquia, (tx) => getSupplier(tx, franquia.id, shared))).toMatchObject({ copyId: first.id });
    const copy = await run(franquia, (tx) => updateSupplier(tx, franquia.id, first.id, input({ name: 'Atacado Rede Teste', notes: 'Vendedor: Jorge' })));
    expect(copy).toMatchObject({ tenantId: franquia.id, copiedFromId: shared, notes: 'Vendedor: Jorge' });
    await expect(run(franquia, (tx) => copyNetworkSupplier(tx, franquia.id, notShared))).rejects.toThrow('Fornecedor da rede não encontrado.');
  });

  it('outra franquia não vê os fornecedores próprios desta', async () => {
    const theirs = await run(outra, (tx) => listSuppliers(tx, outra.id, { q: 'Lago' }));
    expect(theirs.rows.map((r) => r.tenantId)).toEqual([outra.id]);
  });
});
