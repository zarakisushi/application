'use server';

import {
  OrderError,
  buildOrderMessage,
  isScheduled,
  normalizeBrPhone,
  normalizeCouponCode,
  publicOrderSchema,
  whatsappUrl,
  type PublicOrderInput,
} from '@zaraki/core';
import {
  checkCouponCode,
  countRecentCouponRejections,
  countRecentOrdersFromIp,
  createOrder,
  logEvent,
  priceItems,
  withContext,
} from '@zaraki/db';
import { scheduleCalendarSync } from '@/server/calendar';
import { requestMeta } from '@/server/request';
import { getSiteTenant, siteWhatsapp } from '@/server/site';

export type SubmitOrderResult =
  | { ok: true; code: string; whatsappUrl: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }
  | { ok: false; fallback: true };

/** Limite anti-abuso: pedidos do site por IP numa janela de tempo. */
const RATE_LIMIT = { max: 5, minutes: 10 };
/** Limite de cupons recusados por IP (impede ficar testando códigos). */
const COUPON_LIMIT = { max: 10, minutes: 10 };

type RequestMeta = Awaited<ReturnType<typeof requestMeta>>;

/** Registra a recusa na auditoria; ela conta para o bloqueio de tentativas. */
function logCouponRejected(tenantId: string, meta: RequestMeta, code: string, reason: string) {
  return logEvent({ tenantId, actorLabel: 'site', ...meta }, { action: 'COUPON_REJECTED', entity: 'coupons', details: { code, reason } });
}

export type CouponPreview = { ok: true; code: string; discountCents: number } | { ok: false; error: string };

/** Prévia do cupom no formulário do site (não grava nada; a validação final é no envio do pedido). */
export async function checkCoupon(raw: { code: string; phone: string; items: { productId: string; qty: number }[] }): Promise<CouponPreview> {
  const code = normalizeCouponCode(String(raw.code ?? '')).slice(0, 40);
  if (!code) return { ok: false, error: 'Informe o código do cupom.' };
  const items = Array.isArray(raw.items) ? raw.items.filter((i) => typeof i?.productId === 'string' && Number.isInteger(i.qty) && i.qty > 0) : [];
  if (!items.length) return { ok: false, error: 'Adicione os tubos antes de aplicar o cupom.' };

  const meta = await requestMeta();
  try {
    const tenant = await getSiteTenant();
    const result = await withContext({ tenantId: tenant.id, actorLabel: 'site', ...meta }, async (tx) => {
      if (meta.ip && (await countRecentCouponRejections(tx, meta.ip, COUPON_LIMIT.minutes)) >= COUPON_LIMIT.max) {
        return { ok: false as const, error: 'Muitas tentativas de cupom. Aguarde alguns minutos e tente de novo.', blocked: true };
      }
      const priced = await priceItems(tx, tenant.id, items);
      return checkCouponCode(tx, tenant, code, { subtotalCents: priced.subtotalCents, tubes: priced.tubes, phone: normalizeBrPhone(raw.phone ?? '') });
    });
    if (result.ok) return { ok: true, code: result.code, discountCents: result.discountCents };
    if ('blocked' in result) return { ok: false, error: result.error };
    await logCouponRejected(tenant.id, meta, code, result.reason);
    return { ok: false, error: result.message };
  } catch (error) {
    if (error instanceof OrderError) return { ok: false, error: error.message };
    console.error('[site] falha ao validar cupom', error);
    return { ok: false, error: 'Não foi possível validar o cupom agora. Você pode enviar o pedido e informar o cupom pelo WhatsApp.' };
  }
}

/**
 * Grava o pedido do site e devolve o link do WhatsApp com o código do pedido.
 * Se o banco falhar, devolve `fallback` e o navegador abre o WhatsApp com a mensagem montada
 * localmente: nenhuma venda se perde.
 */
export async function submitOrder(raw: PublicOrderInput): Promise<SubmitOrderResult> {
  const parsed = publicOrderSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0] ?? 'form')] ??= issue.message;
    return { ok: false, error: 'Confira os campos destacados.', fieldErrors };
  }
  const input = parsed.data;
  if (input.website) return { ok: false, error: 'Não foi possível enviar o pedido.' };

  const meta = await requestMeta();
  const { ip } = meta;

  try {
    const tenant = await getSiteTenant();
    const ctx = { tenantId: tenant.id, actorLabel: 'site', ...meta };
    let result;
    try {
      result = await withContext(ctx, async (tx) => {
        if (ip && (await countRecentOrdersFromIp(tx, ip, RATE_LIMIT.minutes)) >= RATE_LIMIT.max) {
          throw new OrderError(
            'RATE_LIMITED',
            'Recebemos vários pedidos seguidos deste aparelho. Aguarde alguns minutos ou fale com a gente direto pelo WhatsApp.',
          );
        }
        return createOrder(tx, tenant, input, { source: 'SITE', paymentMethod: input.paymentMethod });
      });
    } catch (error) {
      // Cupom que deixou de valer entre a prévia e o envio: o pedido não é gravado e o cliente vê o motivo.
      if (error instanceof OrderError && error.code === 'COUPON_REJECTED') {
        await logCouponRejected(tenant.id, meta, input.couponCode, 'ON_SUBMIT');
        return { ok: false, error: error.message, fieldErrors: { couponCode: error.message } };
      }
      throw error;
    }

    if (isScheduled(input.type)) scheduleCalendarSync();

    const text = buildOrderMessage({
      ...input,
      code: result.order.code,
      lines: result.lines,
      couponCode: result.order.couponCode,
      discountCents: result.order.discountCents,
      totalCents: result.order.totalCents,
    });
    return { ok: true, code: result.order.code, whatsappUrl: whatsappUrl(siteWhatsapp(tenant).number, text) };
  } catch (error) {
    if (error instanceof OrderError) return { ok: false, error: error.message };
    console.error('[site] falha ao gravar pedido; cliente segue direto para o WhatsApp', error);
    return { ok: false, fallback: true };
  }
}
