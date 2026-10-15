export { formatBrPhone, formatCents } from '@zaraki/core';

/** "11/10/2026 19:30" no fuso da unidade. */
export function formatDateTime(date: Date | string | null | undefined, timeZone: string) {
  if (!date) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(date));
}

/** "11/10/2026" no fuso da unidade. */
export function formatDate(date: Date | string | null | undefined, timeZone: string) {
  if (!date) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone, dateStyle: 'short' }).format(new Date(date));
}

/** Data ("AAAA-MM-DD") e hora ("HH:MM") de um instante, no fuso da unidade — para preencher formulários. */
export function toDateTimeInputs(date: Date | string | null | undefined, timeZone: string) {
  if (!date) return { date: '', time: '' };
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(date));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}
