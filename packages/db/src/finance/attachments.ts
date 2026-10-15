import { DomainError } from '@zaraki/core';
import { and, eq } from 'drizzle-orm';
import type { Tx } from '../client';
import { financeAttachments } from '../schema';

/** Guarda um comprovante (já validado pelo tipo real do arquivo) e devolve o id. */
export async function createAttachment(tx: Tx, tenantId: string, file: { fileName: string; contentType: string; content: Buffer }) {
  if (file.content.length > 4 * 1024 * 1024) throw new DomainError('O comprovante pode ter no máximo 4 MB.');
  const [row] = await tx
    .insert(financeAttachments)
    .values({ tenantId, fileName: file.fileName.slice(0, 200) || 'comprovante', contentType: file.contentType, sizeBytes: file.content.length, content: file.content })
    .returning({ id: financeAttachments.id });
  return row!.id;
}

/** Comprovante da unidade do contexto (o RLS impede ler o de outra unidade). */
export async function getAttachment(tx: Tx, tenantId: string, id: string) {
  const [row] = await tx
    .select()
    .from(financeAttachments)
    .where(and(eq(financeAttachments.tenantId, tenantId), eq(financeAttachments.id, id), eq(financeAttachments.status, true)));
  return row ?? null;
}
