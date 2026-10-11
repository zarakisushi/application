/** Formata centavos como moeda brasileira: 5000 → "R$ 50,00". */
export const formatCents = (cents: number) =>
  'R$ ' + (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
