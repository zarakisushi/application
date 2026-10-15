'use server';

import {
  adminOrderSchema,
  normalizeBrPhone,
  normalizeCouponCode,
  orderUpdateSchema,
  PAYMENT_METHODS,
  type OrderStage,
  type PaymentMethod,
} from '@zaraki/core';
import {
  changeOrderStage,
  checkCouponCode,
  createOrder,
  enqueueCalendarSync,
  getDb,
  getOrderDetail,
  getTenantById,
  setOrderPayment,
  setOrderStatus,
  updateOrder,
  withContext,
} from '@zaraki/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { orderHref } from '@/lib/orders';
import { attempt, formToObject, parseForm, type ActionResult } from './actions';
import { runCalendarSync, scheduleCalendarSync } from './calendar';
import { requireAdmin } from './admin';

/** Campos do formulário + itens (enviados como JSON pelo editor). */
function orderForm(form: FormData) {
  const raw: Record<string, unknown> = formToObject(form);
  try {
    raw.items = JSON.parse(String(raw.items || '[]'));
  } catch {
    raw.items = [];
  }
  return raw;
}

async function tenantRef(tenantId: string) {
  const tenant = await getTenantById(getDb(), tenantId);
  if (!tenant) throw new Error('Unidade ativa não encontrada');
  return tenant;
}

/** Atualiza as telas e envia à agenda o que tiver mudado (sem atrasar a resposta). */
function refresh(id?: string) {
  scheduleCalendarSync();
  revalidatePath('/admin/pedidos');
  revalidatePath('/admin/encomendas');
  revalidatePath('/admin');
  // Pedido pago vira entrada no caixa: as telas do financeiro também mudam.
  revalidatePath('/admin/financeiro', 'layout');
  if (id) {
    revalidatePath(`/admin/pedidos/${id}`);
    revalidatePath(`/admin/encomendas/${id}`);
  }
}

export async function createOrderAction(form: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin('orders:write');
  const { data, result } = parseForm(adminOrderSchema, orderForm(form));
  if (!data) return result;
  const tenant = await tenantRef(ctx.tenant.id);

  return attempt(async () => {
    const { order } = await withContext(ctx.db, (tx) =>
      createOrder(tx, tenant, data, {
        source: data.source,
        allowPast: true,
        discountCents: data.discount,
        deliveryFeeCents: data.deliveryFee,
        paymentMethod: data.paymentMethod,
        paid: data.paid,
      }),
    );
    refresh();
    redirect(orderHref(order));
  });
}

export async function updateOrderAction(id: string, form: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin('orders:write');
  const { data, result } = parseForm(orderUpdateSchema, orderForm(form));
  if (!data) return result;
  const tenant = await tenantRef(ctx.tenant.id);

  return attempt(async () => {
    const order = await withContext(ctx.db, (tx) => updateOrder(tx, tenant, id, data));
    refresh(id);
    // Se o tipo mudou entre delivery e encomenda, o pedido troca de seção.
    return { ok: true, message: 'Pedido salvo.', redirectTo: orderHref(order) };
  });
}

export async function changeStageAction(id: string, to: OrderStage, note?: string): Promise<ActionResult> {
  const ctx = await requireAdmin('orders:write');
  return attempt(async () => {
    await withContext(ctx.db, (tx) => changeOrderStage(tx, ctx.tenant.id, id, to, note));
    refresh(id);
    return { ok: true, message: to === 'CANCELADO' ? 'Pedido cancelado.' : 'Etapa atualizada.' };
  });
}

export async function setOrderStatusAction(id: string, status: boolean): Promise<ActionResult> {
  const ctx = await requireAdmin('orders:delete');
  return attempt(async () => {
    await withContext(ctx.db, (tx) => setOrderStatus(tx, ctx.tenant.id, id, status));
    refresh(id);
    return { ok: true, message: status ? 'Pedido restaurado.' : 'Pedido excluído. Ele pode ser restaurado depois.' };
  });
}

/**
 * Registra (ou desfaz) o pagamento do pedido. Pago, a venda entra no caixa da unidade; desfeito, é estornada.
 * Também usada ao avançar para "Entregue" (pergunta "Pagamento recebido?").
 */
export async function setOrderPaymentAction(id: string, paid: boolean, method?: string | null, then?: OrderStage): Promise<ActionResult> {
  const ctx = await requireAdmin('orders:write');
  const pm = method && (PAYMENT_METHODS as readonly string[]).includes(method) ? (method as PaymentMethod) : null;
  if (paid && !pm) return { error: 'Escolha a forma de pagamento.' };
  return attempt(async () => {
    await withContext(ctx.db, async (tx) => {
      if (then) await changeOrderStage(tx, ctx.tenant.id, id, then);
      await setOrderPayment(tx, ctx.tenant.id, id, { paid, method: pm });
    });
    refresh(id);
    return { ok: true, message: paid ? 'Pagamento registrado: a venda entrou no caixa.' : 'Pagamento desfeito: a entrada no caixa foi estornada.' };
  });
}

/** Reenvia o pedido à Google Agenda agora (botão "Sincronizar agora" na ficha). */
export async function retryCalendarSyncAction(id: string): Promise<ActionResult> {
  const ctx = await requireAdmin('orders:write');
  const order = await withContext(ctx.db, async (tx) => {
    const found = await getOrderDetail(tx, ctx.tenant.id, id);
    if (found) await enqueueCalendarSync(tx, found, 'UPSERT');
    return found;
  });
  if (!order) return { error: 'Pedido não encontrado.' };
  const summary = await runCalendarSync();
  revalidatePath(orderHref(order));
  if (!summary) return { error: 'A Google Agenda ainda não está configurada neste ambiente.' };
  return summary.failed
    ? { error: 'O Google recusou a sincronização. Veja o erro na ficha; uma nova tentativa será feita automaticamente.' }
    : { ok: true, message: 'Agenda sincronizada.' };
}

export type CouponPreview = { ok: true; code: string; discountCents: number } | { ok: false; error: string };

/**
 * Prévia do cupom no editor do painel (não grava nada; o desconto definitivo é calculado ao salvar).
 * Em pedido existente, o telefone é o do cliente do pedido e o próprio pedido não conta como uso.
 */
export async function previewCouponAction(input: {
  code: string;
  phone?: string;
  orderId?: string;
  subtotalCents: number;
  tubes: number;
}): Promise<CouponPreview> {
  const ctx = await requireAdmin('orders:write');
  const code = normalizeCouponCode(String(input.code ?? '')).slice(0, 40);
  if (!code) return { ok: false, error: 'Informe o código do cupom.' };
  const tenant = await tenantRef(ctx.tenant.id);
  const check = await withContext(ctx.db, async (tx) => {
    const order = input.orderId ? await getOrderDetail(tx, ctx.tenant.id, input.orderId) : null;
    const phone = order ? order.customer.phone : normalizeBrPhone(input.phone ?? '');
    return checkCouponCode(tx, tenant, code, {
      subtotalCents: Math.max(0, Math.round(Number(input.subtotalCents) || 0)),
      tubes: Math.max(0, Math.round(Number(input.tubes) || 0)),
      phone,
      excludeOrderId: order?.id,
    });
  });
  return check.ok ? { ok: true, code: check.code, discountCents: check.discountCents } : { ok: false, error: check.message };
}
