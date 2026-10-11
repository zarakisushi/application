'use server';

import { tenantSchema } from '@zaraki/core';
import { createTenant, setTenantStatus, updateTenant, withContext } from '@zaraki/db';
import { revalidatePath, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { attempt, parseForm, type ActionResult } from '@/server/actions';
import { requireAdmin } from '@/server/admin';

/** Operações sobre a rede: só a Matriz, com contexto que enxerga todas as unidades. */
async function networkContext() {
  const ctx = await requireAdmin('tenants:manage');
  return { ctx, db: { ...ctx.db, platformAdmin: true } };
}

function refresh(id?: string) {
  updateTag('tenants'); // dados da unidade usados pelo site (WhatsApp, prefixo, fuso)
  revalidatePath('/admin', 'layout'); // seletor de unidade
  if (id) revalidatePath(`/admin/unidades/${id}`);
}

export async function saveTenant(id: string | null, form: FormData): Promise<ActionResult> {
  const { ctx, db } = await networkContext();
  const { data, result } = parseForm(tenantSchema, form);
  if (!data) return result;

  return attempt(async () => {
    const matriz = ctx.tenants.find((t) => t.kind === 'MATRIZ');
    const tenant = await withContext(db, (tx) => (id ? updateTenant(tx, id, data) : createTenant(tx, data, matriz!.id)));
    if (!tenant) return { error: 'Unidade não encontrada.' };
    refresh(tenant.id);
    if (!id) redirect(`/admin/unidades/${tenant.id}`);
    return { ok: true, message: 'Unidade salva.' };
  });
}

export async function setTenantStatusAction(id: string, status: boolean): Promise<ActionResult> {
  const { db } = await networkContext();
  return attempt(async () => {
    await withContext(db, (tx) => setTenantStatus(tx, id, status));
    refresh(id);
    return {
      ok: true,
      message: status ? 'Unidade reativada.' : 'Unidade desativada. Os dados continuam guardados e ela pode ser reativada.',
    };
  });
}
