import { readFile } from 'node:fs/promises';
import { getAdminContext } from '@/server/admin';
import { manualFile } from '@/server/manual';

/**
 * Arquivos do manual do sistema (PDF e imagens). Só para quem está logado no painel.
 * /api/manual/pdf abre o PDF; com ?download=1, baixa.
 */
export async function GET(req: Request, { params }: { params: Promise<{ arquivo: string }> }) {
  const ctx = await getAdminContext();
  if (!ctx || ctx.user.mustChangePassword) return new Response('Faça login para ver o manual.', { status: 401 });
  const file = manualFile((await params).arquivo);
  if (!file) return new Response('Arquivo não encontrado.', { status: 404 });

  let content: Buffer;
  try {
    content = await readFile(file.path);
  } catch {
    return new Response('Arquivo não encontrado.', { status: 404 });
  }
  const download = new URL(req.url).searchParams.has('download');
  return new Response(new Uint8Array(content), {
    headers: {
      'Content-Type': file.contentType,
      'Content-Length': String(content.byteLength),
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
