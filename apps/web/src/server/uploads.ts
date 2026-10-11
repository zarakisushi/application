import 'server-only';
import { DomainError } from '@zaraki/core';
import { put } from '@vercel/blob';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const MAX_BYTES = 4 * 1024 * 1024;

/** Identifica a imagem pelos primeiros bytes (não confia na extensão nem no tipo informado pelo navegador). */
function detectImage(bytes: Uint8Array): { ext: string; type: string } | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0xff, 0xd8, 0xff)) return { ext: 'jpg', type: 'image/jpeg' };
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { ext: 'png', type: 'image/png' };
  if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  return null;
}

/**
 * Guarda uma foto do cardápio e devolve o endereço público.
 * Produção: Vercel Blob (BLOB_READ_WRITE_TOKEN). Desenvolvimento: pasta public/uploads.
 */
export async function storeProductImage(tenantId: string, file: File): Promise<string> {
  if (!file.size) throw new DomainError('Escolha uma imagem.');
  if (file.size > MAX_BYTES) throw new DomainError('A imagem pode ter no máximo 4 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const image = detectImage(bytes);
  if (!image) throw new DomainError('Formato não aceito: use JPG, PNG ou WebP.');
  const name = `cardapio/${tenantId}/${randomUUID()}.${image.ext}`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(name, Buffer.from(bytes), { access: 'public', contentType: image.type, addRandomSuffix: false });
    return blob.url;
  }
  if (process.env.NODE_ENV === 'production' && process.env.UPLOADS_LOCAL !== '1') {
    throw new DomainError('Envio de fotos não configurado neste ambiente (falta BLOB_READ_WRITE_TOKEN).');
  }
  const dir = join(process.cwd(), 'public', 'uploads', 'cardapio', tenantId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(process.cwd(), 'public', 'uploads', name), bytes);
  return `/uploads/${name}`;
}
