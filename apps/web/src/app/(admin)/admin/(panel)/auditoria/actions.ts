'use server';

import { logEvent, verifyAuditChain } from '@zaraki/db';
import { requireAdmin } from '@/server/admin';

export type IntegrityResult =
  | { ok: true; checked: number }
  | { ok: false; checked: number; brokenAt: number }
  | { error: string };

/**
 * Recalcula a cadeia de hash da auditoria da unidade (ou dos eventos globais, só na Matriz) e
 * registra a verificação na própria auditoria.
 */
export async function verifyIntegrityAction(scope: 'unidade' | 'rede'): Promise<IntegrityResult> {
  const ctx = await requireAdmin('audit:read');
  if (scope === 'rede' && !ctx.platformAdmin) return { error: 'Somente a Matriz verifica os eventos da rede.' };

  const tenantId = scope === 'rede' ? null : ctx.tenant.id;
  // A permissão é checada acima; a função do banco recalcula a cadeia com privilégio de dono.
  const check = await verifyAuditChain(tenantId);
  await logEvent(
    { ...ctx.db, tenantId },
    { action: 'AUDIT_VERIFIED', entity: 'audit_logs', details: { ok: check.ok, checked: check.checked, broken_at: check.brokenAt } },
  );
  return check.ok ? { ok: true, checked: check.checked } : { ok: false, checked: check.checked, brokenAt: check.brokenAt! };
}
