import { getAttachment, withContext } from '@zaraki/db';
import { isUuid } from '@/lib/ids';
import { getAdminContext } from '@/server/admin';

/**
 * Abre um comprovante do financeiro. Só para quem está logado e pode ver o financeiro da unidade ativa;
 * o RLS do banco garante que o arquivo é da unidade.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAdminContext();
  if (!ctx || ctx.user.mustChangePassword) return new Response('Faça login para ver o comprovante.', { status: 401 });
  if (!ctx.can('finance:read')) return new Response('Sem permissão.', { status: 403 });
  const { id } = await params;
  if (!isUuid(id)) return new Response('Comprovante não encontrado.', { status: 404 });

  const file = await withContext(ctx.db, (tx) => getAttachment(tx, ctx.tenant.id, id));
  if (!file) return new Response('Comprovante não encontrado.', { status: 404 });
  return new Response(new Uint8Array(file.content), {
    headers: {
      'Content-Type': file.contentType,
      'Content-Length': String(file.sizeBytes),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      // Imagens abrem isoladas (nada roda com a sessão do painel). PDFs ficam fora do sandbox porque o
      // leitor de PDF do navegador não abre em documento isolado; o tipo real foi conferido no envio.
      ...(file.contentType.startsWith('image/') ? { 'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self'" } : {}),
    },
  });
}
