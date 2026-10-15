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

/** Comprovantes aceitam, além das imagens, PDF (nota fiscal, boleto). */
function detectDocument(bytes: Uint8Array): { ext: string; type: string } | null {
  if (String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-') return { ext: 'pdf', type: 'application/pdf' };
  return detectImage(bytes);
}

/** Grava o arquivo no Vercel Blob (produção) ou em public/uploads (desenvolvimento) e devolve o endereço. */
async function store(name: string, bytes: Uint8Array, type: string): Promise<string> {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(name, Buffer.from(bytes), { access: 'public', contentType: type, addRandomSuffix: false });
    return blob.url;
  }
  if (process.env.NODE_ENV === 'production' && process.env.UPLOADS_LOCAL !== '1') {
    throw new DomainError('Envio de arquivos não configurado neste ambiente (falta BLOB_READ_WRITE_TOKEN).');
  }
  const path = join(process.cwd(), 'public', 'uploads', name);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, bytes);
  return `/uploads/${name}`;
}

/** Guarda uma foto do cardápio e devolve o endereço público. */
export async function storeProductImage(tenantId: string, file: File): Promise<string> {
  if (!file.size) throw new DomainError('Escolha uma imagem.');
  if (file.size > MAX_BYTES) throw new DomainError('A imagem pode ter no máximo 4 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const image = detectImage(bytes);
  if (!image) throw new DomainError('Formato não aceito: use JPG, PNG ou WebP.');
  return store(`cardapio/${tenantId}/${randomUUID()}.${image.ext}`, bytes, image.type);
}

/** Valida o comprovante de um lançamento financeiro (imagem ou PDF, pelo conteúdo real do arquivo). */
export async function readFinanceAttachment(file: File) {
  if (!file.size) throw new DomainError('Escolha o arquivo do comprovante.');
  if (file.size > MAX_BYTES) throw new DomainError('O comprovante pode ter no máximo 4 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = detectDocument(bytes);
  if (!doc) throw new DomainError('Formato não aceito: use PDF, JPG, PNG ou WebP.');
  return { fileName: file.name || `comprovante.${doc.ext}`, contentType: doc.type, content: Buffer.from(bytes) };
}
