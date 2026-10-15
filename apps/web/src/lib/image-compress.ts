/**
 * Reduz fotos grandes no navegador antes do envio (foto de celular costuma ter 3–5 MB).
 * Só mexe em imagens maiores que `maxSide` pixels ou `maxBytes`; PDFs e imagens pequenas passam intactos.
 * Gera WebP (mantém transparência) e cai para JPEG no navegador que não codifica WebP.
 */
export async function compressImage(file: File, { maxSide = 1600, maxBytes = 1.5 * 1024 * 1024, quality = 0.85 } = {}): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // o servidor valida o formato e responde com a mensagem certa
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= maxBytes) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const toBlob = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  let blob = await toBlob('image/webp');
  if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg');
  if (!blob || blob.size >= file.size) return file;
  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + `.${ext}`, { type: blob.type });
}
