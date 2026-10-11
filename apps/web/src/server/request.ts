import 'server-only';
import { headers } from 'next/headers';
import { randomUUID } from 'node:crypto';

/** IP, navegador e id da requisição atual, para a auditoria. */
export async function requestMeta() {
  const h = await headers();
  return {
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null,
    userAgent: h.get('user-agent'),
    requestId: h.get('x-vercel-id') ?? randomUUID(),
  };
}
