import { DomainError, type SupplierCategory, type SupplierInput } from '@zaraki/core';
import { and, asc, eq, ilike, isNotNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../client';
import { contains, paging, statusWhere, toPage, type ListParams } from '../admin/common';
import { suppliers, tenants } from '../schema';

// Fornecedores: cada unidade tem os seus; os que a Matriz compartilha aparecem para a rede (só leitura).

export type SupplierOrigin = 'todos' | 'meus' | 'rede';

export type SupplierListParams = ListParams & {
  category?: SupplierCategory;
  city?: string;
  /** Dia de entrega (0 = domingo ... 6 = sábado). */
  deliveryDay?: number;
  origin?: SupplierOrigin;
};

const columns = {
  id: suppliers.id,
  tenantId: suppliers.tenantId,
  ownerName: tenants.name,
  personKind: suppliers.personKind,
  name: suppliers.name,
  legalName: suppliers.legalName,
  document: suppliers.document,
  stateRegistration: suppliers.stateRegistration,
  categories: suppliers.categories,
  contactName: suppliers.contactName,
  whatsapp: suppliers.whatsapp,
  phone: suppliers.phone,
  email: suppliers.email,
  website: suppliers.website,
  cep: suppliers.cep,
  street: suppliers.street,
  number: suppliers.number,
  complement: suppliers.complement,
  district: suppliers.district,
  city: suppliers.city,
  state: suppliers.state,
  deliveryDays: suppliers.deliveryDays,
  minOrderCents: suppliers.minOrderCents,
  paymentTerms: suppliers.paymentTerms,
  paymentMethods: suppliers.paymentMethods,
  pixKey: suppliers.pixKey,
  bankDetails: suppliers.bankDetails,
  rating: suppliers.rating,
  notes: suppliers.notes,
  networkShared: suppliers.networkShared,
  copiedFromId: suppliers.copiedFromId,
  status: suppliers.status,
};

/** Fornecedores da rede: compartilhados pela Matriz (vistos por outra unidade). */
const fromNetwork = (tenantId: string) =>
  and(ne(suppliers.tenantId, tenantId), eq(suppliers.networkShared, true), eq(tenants.kind, 'MATRIZ'));

function searchWhere(q: string): SQL | undefined {
  const like = contains(q);
  const digits = q.replace(/\D/g, '');
  return or(
    ilike(suppliers.name, like),
    ilike(suppliers.legalName, like),
    ilike(suppliers.contactName, like),
    ilike(suppliers.email, like),
    ilike(suppliers.city, like),
    ilike(suppliers.notes, like),
    // CNPJ/CPF e telefones: com ou sem máscara.
    digits.length >= 4 ? or(ilike(suppliers.document, `%${digits}%`), ilike(suppliers.whatsapp, `%${digits}%`), ilike(suppliers.phone, `%${digits}%`)) : undefined,
  );
}

export async function listSuppliers(tx: Tx, tenantId: string, params: SupplierListParams = {}) {
  const { page, pageSize, offset } = paging({ ...params, pageSize: params.pageSize ?? 50 });
  const origin = params.origin ?? 'todos';
  const own = eq(suppliers.tenantId, tenantId);
  const where = and(
    origin === 'meus' ? own : origin === 'rede' ? fromNetwork(tenantId) : or(own, fromNetwork(tenantId)),
    // Os da rede aparecem só enquanto ativos; a situação filtra os da unidade.
    or(and(own, statusWhere(suppliers.status, params.status)), and(ne(suppliers.tenantId, tenantId), eq(suppliers.status, true))),
    params.category ? sql`${params.category} = any(${suppliers.categories})` : undefined,
    params.city ? ilike(suppliers.city, params.city) : undefined,
    params.deliveryDay !== undefined ? sql`${params.deliveryDay}::smallint = any(${suppliers.deliveryDays})` : undefined,
    params.q ? searchWhere(params.q) : undefined,
  );
  const base = () => tx.select(columns).from(suppliers).innerJoin(tenants, eq(tenants.id, suppliers.tenantId)).where(where);
  const rows = await base().orderBy(asc(suppliers.name)).limit(pageSize).offset(offset);
  const [total] = await tx
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(suppliers)
    .innerJoin(tenants, eq(tenants.id, suppliers.tenantId))
    .where(where);
  return toPage(
    rows.map((r) => ({ ...r, fromNetwork: r.tenantId !== tenantId })),
    total?.n ?? 0,
    page,
    pageSize,
  );
}

/** Ficha do fornecedor: os da unidade (editáveis) ou um da rede (só leitura). */
export async function getSupplier(tx: Tx, tenantId: string, id: string) {
  const [row] = await tx
    .select(columns)
    .from(suppliers)
    .innerJoin(tenants, eq(tenants.id, suppliers.tenantId))
    .where(and(eq(suppliers.id, id), or(eq(suppliers.tenantId, tenantId), and(fromNetwork(tenantId), eq(suppliers.status, true)))));
  if (!row) return null;
  const fromNet = row.tenantId !== tenantId;
  // Se a unidade já copiou este fornecedor da rede, a ficha aponta para a cópia.
  const [copy] = fromNet
    ? await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.copiedFromId, id), eq(suppliers.status, true)))
    : [];
  return { ...row, fromNetwork: fromNet, editable: !fromNet, copyId: copy?.id ?? null };
}

const values = (input: SupplierInput) => ({
  personKind: input.personKind,
  name: input.name,
  legalName: input.legalName,
  document: input.document,
  stateRegistration: input.stateRegistration,
  categories: input.categories,
  contactName: input.contactName,
  whatsapp: input.whatsapp,
  phone: input.phone,
  email: input.email,
  website: input.website,
  cep: input.cep,
  street: input.street,
  number: input.number,
  complement: input.complement,
  district: input.district,
  city: input.city,
  state: input.state,
  deliveryDays: input.deliveryDays,
  minOrderCents: input.minOrder,
  paymentTerms: input.paymentTerms,
  paymentMethods: input.paymentMethods,
  pixKey: input.pixKey,
  bankDetails: input.bankDetails,
  rating: input.rating,
  notes: input.notes,
  networkShared: input.networkShared,
});

async function assertDocumentFree(tx: Tx, tenantId: string, document: string | null, exceptId?: string) {
  if (!document) return;
  const [other] = await tx
    .select({ name: suppliers.name })
    .from(suppliers)
    .where(
      and(
        eq(suppliers.tenantId, tenantId),
        eq(suppliers.document, document),
        eq(suppliers.status, true),
        exceptId ? ne(suppliers.id, exceptId) : undefined,
      ),
    );
  if (other) throw new DomainError(`Este CNPJ/CPF já está cadastrado: ${other.name}.`);
}

export async function createSupplier(tx: Tx, tenantId: string, input: SupplierInput, copiedFromId?: string) {
  await assertDocumentFree(tx, tenantId, input.document);
  const [row] = await tx
    .insert(suppliers)
    .values({ tenantId, ...values(input), copiedFromId: copiedFromId ?? null })
    .returning();
  return row!;
}

export async function updateSupplier(tx: Tx, tenantId: string, id: string, input: SupplierInput) {
  await assertDocumentFree(tx, tenantId, input.document, id);
  const [row] = await tx
    .update(suppliers)
    .set(values(input))
    .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.id, id)))
    .returning();
  if (!row) throw new DomainError('Fornecedor não encontrado.');
  return row;
}

export async function setSupplierStatus(tx: Tx, tenantId: string, id: string, status: boolean) {
  const [current] = await tx.select().from(suppliers).where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.id, id)));
  if (!current) throw new DomainError('Fornecedor não encontrado.');
  if (status) await assertDocumentFree(tx, tenantId, current.document, id);
  const [row] = await tx.update(suppliers).set({ status }).where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.id, id))).returning();
  return row!;
}

/** Copia um fornecedor da rede para o cadastro da unidade. Se já copiou, devolve a cópia existente. */
export async function copyNetworkSupplier(tx: Tx, tenantId: string, sourceId: string) {
  const source = await getSupplier(tx, tenantId, sourceId);
  if (!source || !source.fromNetwork) throw new DomainError('Fornecedor da rede não encontrado.');
  if (source.copyId) return { id: source.copyId, created: false };
  const [same] = source.document
    ? await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.document, source.document), eq(suppliers.status, true)))
    : [];
  if (same) return { id: same.id, created: false };
  const [row] = await tx
    .insert(suppliers)
    .values({
      tenantId,
      personKind: source.personKind,
      name: source.name,
      legalName: source.legalName,
      document: source.document,
      stateRegistration: source.stateRegistration,
      categories: source.categories,
      contactName: source.contactName,
      whatsapp: source.whatsapp,
      phone: source.phone,
      email: source.email,
      website: source.website,
      cep: source.cep,
      street: source.street,
      number: source.number,
      complement: source.complement,
      district: source.district,
      city: source.city,
      state: source.state,
      deliveryDays: source.deliveryDays,
      minOrderCents: source.minOrderCents,
      paymentTerms: source.paymentTerms,
      paymentMethods: source.paymentMethods,
      pixKey: source.pixKey,
      bankDetails: source.bankDetails,
      rating: source.rating,
      notes: source.notes,
      copiedFromId: source.id,
    })
    .returning({ id: suppliers.id });
  return { id: row!.id, created: true };
}

/** Cidades dos fornecedores visíveis à unidade (filtro da lista). */
export async function listSupplierCities(tx: Tx, tenantId: string) {
  const rows = await tx
    .selectDistinct({ city: suppliers.city })
    .from(suppliers)
    .innerJoin(tenants, eq(tenants.id, suppliers.tenantId))
    .where(and(isNotNull(suppliers.city), eq(suppliers.status, true), or(eq(suppliers.tenantId, tenantId), fromNetwork(tenantId))))
    .orderBy(asc(suppliers.city));
  return rows.map((r) => r.city!);
}
