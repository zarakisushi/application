'use server';

import { customerSchema } from '@zaraki/core';
import { createCustomer, setCustomerStatus, updateCustomer, withContext } from '@zaraki/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { attempt, parseForm, type ActionResult } from '@/server/actions';
import { requireAdmin } from '@/server/admin';

export async function saveCustomer(id: string | null, form: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin('customers:write');
  const { data, result } = parseForm(customerSchema, form);
  if (!data) return result;

  return attempt(async () => {
    const customer = await withContext(ctx.db, (tx) =>
      id ? updateCustomer(tx, ctx.tenant.id, id, data) : createCustomer(tx, ctx.tenant.id, data),
    );
    if (!customer) return { error: 'Cliente não encontrado.' };
    revalidatePath('/admin/clientes');
    if (!id) redirect(`/admin/clientes/${customer.id}`);
    return { ok: true, message: 'Cliente salvo.' };
  });
}

export async function setCustomerStatusAction(id: string, status: boolean): Promise<ActionResult> {
  const ctx = await requireAdmin('customers:delete');
  return attempt(async () => {
    await withContext(ctx.db, (tx) => setCustomerStatus(tx, ctx.tenant.id, id, status));
    revalidatePath('/admin/clientes');
    revalidatePath(`/admin/clientes/${id}`);
    return { ok: true, message: status ? 'Cliente restaurado.' : 'Cliente excluído. O histórico de pedidos foi mantido.' };
  });
}
