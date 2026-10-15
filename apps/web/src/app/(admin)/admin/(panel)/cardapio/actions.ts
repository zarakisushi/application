'use server';

import { productSchema } from '@zaraki/core';
import { createProduct, setProductStatus, updateProduct, withContext } from '@zaraki/db';
import { revalidatePath, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { attempt, parseForm, type ActionResult } from '@/server/actions';
import { requireAdmin } from '@/server/admin';
import { menuTag } from '@/server/site';
import { storeProductImage } from '@/server/uploads';

function refresh(tenantId: string) {
  updateTag(menuTag(tenantId)); // a landing passa a mostrar o cardápio novo no próximo acesso
  revalidatePath('/admin/cardapio');
}

export async function saveProduct(id: string | null, form: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin('products:write');
  const { data, result } = parseForm(productSchema, form);
  if (!data) return result;

  return attempt(async () => {
    const product = await withContext(ctx.db, (tx) =>
      id ? updateProduct(tx, ctx.tenant.id, id, data) : createProduct(tx, ctx.tenant.id, data),
    );
    if (!product) return { error: 'Sabor não encontrado.' };
    refresh(ctx.tenant.id);
    if (!id) redirect(`/admin/cardapio/${product.id}`);
    return { ok: true, message: 'Sabor salvo.' };
  });
}

export async function setProductStatusAction(id: string, status: boolean): Promise<ActionResult> {
  const ctx = await requireAdmin('products:delete');
  return attempt(async () => {
    await withContext(ctx.db, (tx) => setProductStatus(tx, ctx.tenant.id, id, status));
    refresh(ctx.tenant.id);
    revalidatePath(`/admin/cardapio/${id}`);
    return { ok: true, message: status ? 'Sabor restaurado.' : 'Sabor excluído. Ele saiu do site e pode ser restaurado.' };
  });
}

/** Envia uma foto para o cardápio; o endereço volta para o campo "Imagem" do formulário. */
export async function uploadProductImageAction(form: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin('products:write');
  const file = form.get('file');
  if (!(file instanceof File)) return { error: 'Escolha uma imagem.' };
  return attempt(async () => ({ ok: true, url: await storeProductImage(ctx.tenant.id, file), message: 'Foto enviada. Salve o sabor para usar.' }));
}
