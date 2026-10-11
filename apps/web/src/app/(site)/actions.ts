'use server';

import {
  OrderError,
  buildOrderMessage,
  isScheduled,
  publicOrderSchema,
  whatsappUrl,
  type PublicOrderInput,
} from '@zaraki/core';
import { countRecentOrdersFromIp, createOrder, withContext } from '@zaraki/db';
import { scheduleCalendarSync } from '@/server/calendar';
import { requestMeta } from '@/server/request';
import { getSiteTenant, siteWhatsapp } from '@/server/site';

export type SubmitOrderResult =
  | { ok: true; code: string; whatsappUrl: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }
  | { ok: false; fallback: true };

/** Limite anti-abuso: pedidos do site por IP numa janela de tempo. */
const RATE_LIMIT = { max: 5, minutes: 10 };

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
    const result = await withContext(ctx, async (tx) => {
      if (ip && (await countRecentOrdersFromIp(tx, ip, RATE_LIMIT.minutes)) >= RATE_LIMIT.max) {
        throw new OrderError(
          'RATE_LIMITED',
          'Recebemos vários pedidos seguidos deste aparelho. Aguarde alguns minutos ou fale com a gente direto pelo WhatsApp.',
        );
      }
      return createOrder(tx, tenant, input, { source: 'SITE' });
    });

    if (isScheduled(input.type)) scheduleCalendarSync();

    const text = buildOrderMessage({
      ...input,
      code: result.order.code,
      lines: result.lines,
      totalCents: result.order.totalCents,
    });
    return { ok: true, code: result.order.code, whatsappUrl: whatsappUrl(siteWhatsapp(tenant).number, text) };
  } catch (error) {
    if (error instanceof OrderError) return { ok: false, error: error.message };
    console.error('[site] falha ao gravar pedido; cliente segue direto para o WhatsApp', error);
    return { ok: false, fallback: true };
  }
}
