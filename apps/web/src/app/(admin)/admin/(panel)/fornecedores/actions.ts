'use server';

import { supplierSchema } from '@zaraki/core';
import { copyNetworkSupplier, createSupplier, setSupplierStatus, updateSupplier, withContext } from '@zaraki/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { attempt, parseForm, type ActionResult } from '@/server/actions';
import { requireAdmin } from '@/server/admin';

export async function saveSupplier(id: string | null, form: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin('suppliers:write');
  const { data, result } = parseForm(supplierSchema, form);
  if (!data) return result;
  // Só a Matriz compartilha fornecedores com a rede (o banco também garante).
  if (ctx.tenant.kind !== 'MATRIZ') data.networkShared = false;

  return attempt(async () => {
    const supplier = await withContext(ctx.db, (tx) => (id ? updateSupplier(tx, ctx.tenant.id, id, data) : createSupplier(tx, ctx.tenant.id, data)));
    revalidatePath('/admin/fornecedores', 'layout');
    return id
      ? { ok: true, message: 'Fornecedor salvo.' }
      : { ok: true, message: 'Fornecedor cadastrado.', redirectTo: `/admin/fornecedores/${supplier.id}` };
  });
}

export async function setSupplierStatusAction(id: string, status: boolean): Promise<ActionResult> {
  const ctx = await requireAdmin('suppliers:delete');
  return attempt(async () => {
    await withContext(ctx.db, (tx) => setSupplierStatus(tx, ctx.tenant.id, id, status));
    revalidatePath('/admin/fornecedores', 'layout');
    return { ok: true, message: status ? 'Fornecedor restaurado.' : 'Fornecedor excluído. O histórico continua guardado.' };
  });
}

/** Copia um fornecedor indicado pela Matriz para o cadastro da unidade. */
export async function copyNetworkSupplierAction(sourceId: string): Promise<ActionResult> {
  const ctx = await requireAdmin('suppliers:write');
  return attempt(async () => {
    const copy = await withContext(ctx.db, (tx) => copyNetworkSupplier(tx, ctx.tenant.id, sourceId));
    revalidatePath('/admin/fornecedores', 'layout');
    // Abre a cópia (da unidade), pronta para editar.
    redirect(`/admin/fornecedores/${copy.id}?copiado=${copy.created ? '1' : '0'}`);
  });
}
