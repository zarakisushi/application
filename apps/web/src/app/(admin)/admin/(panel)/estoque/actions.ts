'use server';

import { recipeSchema, stockCountSchema, stockItemSchema, stockMovementSchema, stockPurchaseSchema } from '@zaraki/core';
import {
  applyRecipeCost,
  applyStockCount,
  cancelStockPurchase,
  createStockItem,
  createStockMovement,
  createStockPurchase,
  createSuggestedStockItems,
  saveRecipe,
  setStockItemStatus,
  setStockMovementStatus,
  updateStockItem,
  withContext,
} from '@zaraki/db';
import { revalidatePath } from 'next/cache';
import { attempt, formToObject, parseForm, type ActionResult } from '@/server/actions';
import { requireAdmin } from '@/server/admin';

function refresh() {
  revalidatePath('/admin/estoque', 'layout');
  revalidatePath('/admin/financeiro', 'layout');
  revalidatePath('/admin/cardapio', 'layout');
  revalidatePath('/admin');
}

/** Campo do formulário com JSON (linhas de compra, contagem, ficha técnica). */
function jsonField(form: FormData, name: string): unknown[] {
  try {
    const v = JSON.parse(String(form.get(name) ?? '[]'));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function saveStockItem(id: string | null, form: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin('stock:manage');
  const { data, result } = parseForm(stockItemSchema, form);
  if (!data) return result;
  return attempt(async () => {
    const item = await withContext(ctx.db, (tx) => (id ? updateStockItem(tx, ctx.tenant.id, id, data) : createStockItem(tx, ctx.tenant.id, data)));
    if (!item) return { error: 'Item não encontrado.' };
    refresh();
    return { ok: true, message: id ? 'Item salvo.' : 'Item criado.', redirectTo: id ? undefined : `/admin/estoque/itens/${item.id}` };
  });
}

export async function setStockItemStatusAction(id: string, status: boolean): Promise<ActionResult> {
  const ctx = await requireAdmin('stock:delete');
  return attempt(async () => {
    await withContext(ctx.db, (tx) => setStockItemStatus(tx, ctx.tenant.id, id, status));
    refresh();
    return { ok: true, message: status ? 'Item restaurado.' : 'Item excluído. O histórico de movimentações continua guardado.' };
  });
}

export async function createSuggestedItemsAction(): Promise<ActionResult> {
  const ctx = await requireAdmin('stock:manage');
  return attempt(async () => {
    const n = await withContext(ctx.db, (tx) => createSuggestedStockItems(tx, ctx.tenant.id));
    refresh();
    return { ok: true, message: n ? `${n} itens criados. Ajuste o estoque mínimo e registre as compras.` : 'A lista sugerida já estava cadastrada.' };
  });
}

/** Perda, consumo interno ou outra entrada. */
export async function stockMovementAction(form: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin('stock:write');
  const { data, result } = parseForm(stockMovementSchema, form);
  if (!data) return result;
  return attempt(async () => {
    await withContext(ctx.db, (tx) => createStockMovement(tx, ctx.tenant.id, data));
    refresh();
    return { ok: true, message: data.kind === 'ENTRADA' ? 'Entrada registrada.' : 'Saída registrada.' };
  });
}

export async function undoStockMovementAction(id: string): Promise<ActionResult> {
  const ctx = await requireAdmin('stock:manage');
  return attempt(async () => {
    await withContext(ctx.db, (tx) => setStockMovementStatus(tx, ctx.tenant.id, id, false));
    refresh();
    return { ok: true, message: 'Movimentação desfeita. Ela continua no histórico.' };
  });
}

export async function stockCountAction(form: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin('stock:write');
  const { data, result } = parseForm(stockCountSchema, { ...formToObject(form), counts: jsonField(form, 'counts') });
  if (!data) return result;
  return attempt(async () => {
    const r = await withContext(ctx.db, (tx) => applyStockCount(tx, ctx.tenant.id, data));
    refresh();
    return {
      ok: true,
      message: r.adjusted ? `Contagem registrada: ${r.adjusted} de ${r.counted} itens ajustados.` : `Contagem registrada: os ${r.counted} itens conferem.`,
      redirectTo: '/admin/estoque',
    };
  });
}

export async function savePurchaseAction(form: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin('stock:manage');
  const { data, result } = parseForm(stockPurchaseSchema, { ...formToObject(form), lines: jsonField(form, 'lines') });
  if (!data) return result;
  return attempt(async () => {
    const purchase = await withContext(ctx.db, (tx) => createStockPurchase(tx, ctx.tenant.id, data));
    refresh();
    return { ok: true, message: 'Compra registrada: entrou no estoque e no Financeiro.', redirectTo: `/admin/estoque/compras/${purchase.id}` };
  });
}

export async function cancelPurchaseAction(id: string): Promise<ActionResult> {
  const ctx = await requireAdmin('stock:delete');
  return attempt(async () => {
    await withContext(ctx.db, (tx) => cancelStockPurchase(tx, ctx.tenant.id, id));
    refresh();
    return { ok: true, message: 'Compra cancelada: saiu do estoque e as contas do Financeiro foram estornadas.' };
  });
}

export async function saveRecipeAction(productId: string, form: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin('stock:manage');
  const { data, result } = parseForm(recipeSchema, { lines: jsonField(form, 'lines') });
  if (!data) return result;
  return attempt(async () => {
    await withContext(ctx.db, (tx) => saveRecipe(tx, ctx.tenant.id, productId, data));
    refresh();
    return { ok: true, message: 'Ficha técnica salva. Os próximos pedidos entregues já baixam o estoque por ela.' };
  });
}

export async function applyRecipeCostAction(productId: string): Promise<ActionResult> {
  const ctx = await requireAdmin('products:write');
  if (!ctx.can('stock:manage')) return { error: 'Sem permissão para fichas técnicas.' };
  return attempt(async () => {
    await withContext(ctx.db, (tx) => applyRecipeCost(tx, ctx.tenant.id, productId));
    refresh();
    return { ok: true, message: 'Custo do sabor atualizado pela ficha técnica.' };
  });
}

