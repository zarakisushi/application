/** "Uramaki de Salmão & Manga" → "uramaki-de-salmao-manga". */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Converte valor digitado em reais para centavos: "50", "50,5", "1.234,56", "1.200", "R$ 60,00".
 * Retorna null se não for um valor válido.
 */
export function parseMoneyToCents(input: string): number | null {
  const clean = input.replace(/R\$\s?/i, '').replace(/\s/g, '');
  if (!clean) return null;
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$|^\d+(\.\d{1,2})?$/.test(clean)) return null;
  // "1.200" (ponto seguido de três dígitos, sem vírgula) é milhar em pt-BR: mil e duzentos, não 1,20.
  const thousands = !clean.includes(',') && /^\d{1,3}(\.\d{3})+$/.test(clean);
  const normalized = clean.includes(',') || thousands ? clean.replace(/\./g, '').replace(',', '.') : clean;
  const value = Math.round(Number(normalized) * 100);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** Centavos para o valor de um campo de formulário: 5000 → "50,00". */
export const centsToInput = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

/** Código de cupom como o sistema guarda: maiúsculas, sem espaços. */
export const normalizeCouponCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, '');
