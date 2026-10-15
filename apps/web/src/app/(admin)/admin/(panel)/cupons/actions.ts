'use server';

import { couponSchema } from '@zaraki/core';
import { createCoupon, setCouponActive, setCouponStatus, updateCoupon, withContext } from '@zaraki/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { attempt, parseForm, type ActionResult } from '@/server/actions';
import { requireAdmin } from '@/server/admin';

function refresh(id?: string) {
  revalidatePath('/admin/cupons');
  if (id) revalidatePath(`/admin/cupons/${id}`);
}

export async function saveCoupon(id: string | null, form: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin('coupons:write');
  const { data, result } = parseForm(couponSchema, form);
  if (!data) return result;
  return attempt(async () => {
    const coupon = await withContext(ctx.db, (tx) => (id ? updateCoupon(tx, ctx.tenant.id, id, data) : createCoupon(tx, ctx.tenant.id, data)));
    if (!coupon) return { error: 'Cupom não encontrado.' };
    refresh(coupon.id);
    if (!id) redirect(`/admin/cupons/${coupon.id}`);
    return { ok: true, message: 'Cupom salvo.' };
  });
}

/** Chave "Ativo" da lista e da ficha. */
export async function setCouponActiveAction(id: string, active: boolean): Promise<ActionResult> {
  const ctx = await requireAdmin('coupons:write');
  return attempt(async () => {
    const coupon = await withContext(ctx.db, (tx) => setCouponActive(tx, ctx.tenant.id, id, active));
    refresh(id);
    return { ok: true, message: active ? `Cupom ${coupon.code} ativado.` : `Cupom ${coupon.code} desativado: deixa de valer no site e no painel.` };
  });
}

export async function setCouponStatusAction(id: string, status: boolean): Promise<ActionResult> {
  const ctx = await requireAdmin('coupons:delete');
  return attempt(async () => {
    await withContext(ctx.db, (tx) => setCouponStatus(tx, ctx.tenant.id, id, status));
    refresh(id);
    return { ok: true, message: status ? 'Cupom restaurado.' : 'Cupom excluído. Os pedidos que o usaram continuam com o desconto.' };
  });
}
