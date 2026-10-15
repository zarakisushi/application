/**
 * Normaliza um telefone brasileiro para E.164 (+55DDDNÚMERO).
 * Aceita com ou sem DDI, com ou sem máscara. Retorna null se não for um número válido.
 */
export function normalizeBrPhone(input: string): string | null {
  let digits = input.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) digits = digits.slice(2);
  if (digits.length !== 10 && digits.length !== 11) return null;
  const ddd = Number(digits.slice(0, 2));
  if (ddd < 11 || ddd > 99) return null;
  if (digits.length === 11 && digits[2] !== '9') return null; // celular com 9 dígitos começa com 9
  return `+55${digits}`;
}

/** Formata para exibição: "+5562981092799" ou "5562981092799" → "(62) 98109-2799". */
export function formatBrPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return phone;
}

/** Só os dígitos com DDI, no formato que o wa.me espera: "+5562..." → "5562...". */
export const waDigits = (phone: string) => phone.replace(/\D/g, '');
