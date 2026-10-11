import { timingSafeEqual } from 'node:crypto';
import { runCalendarSync } from '@/server/calendar';

export const dynamic = 'force-dynamic';

/** A Vercel envia "Authorization: Bearer <CRON_SECRET>" nas chamadas de cron. */
function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get('authorization') ?? '');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/** Reprocessa a fila da Google Agenda (pendências e novas tentativas). Agendado em vercel.json. */
export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: 'não autorizado' }, { status: 401 });
  const summary = await runCalendarSync();
  return Response.json(summary ? { ok: true, ...summary } : { ok: false, reason: 'Google Agenda não configurada' });
}
