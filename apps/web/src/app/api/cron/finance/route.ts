import { addMonths, todayInZone } from '@zaraki/core';
import { generateRoyalties, logEvent, withContext } from '@zaraki/db';
import { timingSafeEqual } from 'node:crypto';

export const dynamic = 'force-dynamic';

/** A Vercel envia "Authorization: Bearer <CRON_SECRET>" nas chamadas de cron. */
function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get('authorization') ?? '');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/**
 * Rotina diária do financeiro (agendada em vercel.json): gera os royalties do mês anterior de cada
 * franquia. Idempotente: franquia que já tem a cobrança do mês é pulada.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: 'não autorizado' }, { status: 401 });
  const month = addMonths(`${todayInZone().slice(0, 7)}-01`, -1);
  const result = await withContext({ platformAdmin: true, actorLabel: 'cron' }, (tx) => generateRoyalties(tx, month));
  if (result.failed.length) {
    await logEvent({ platformAdmin: true, actorLabel: 'cron' }, { action: 'ROYALTIES_FAILED', entity: 'royalty_charges', details: { month, failed: result.failed } });
  }
  return Response.json({ ok: true, month, ...result });
}
