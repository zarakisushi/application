import { pingDatabase } from '@zaraki/db';

export const dynamic = 'force-dynamic';

/** Saúde do sistema para monitoramento externo (sem dados sensíveis). */
export async function GET() {
  const started = Date.now();
  try {
    await pingDatabase();
    return Response.json({ ok: true, db: 'ok', latencyMs: Date.now() - started }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ ok: false, db: 'indisponível' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
