// Datas no fuso da unidade (padrão America/Sao_Paulo), sem dependências externas.

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

function offsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Converte data "AAAA-MM-DD" + hora "HH:MM" no fuso informado para um instante UTC. */
export function zonedTimeToUtc(date: string, time: string, timeZone = DEFAULT_TIMEZONE): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const wallClock = Date.UTC(y, m - 1, d, hh, mm);
  let utc = wallClock - offsetMs(new Date(wallClock), timeZone);
  const corrected = wallClock - offsetMs(new Date(utc), timeZone); // ajuste em virada de horário de verão
  if (corrected !== utc) utc = corrected;
  return new Date(utc);
}

/** Data de hoje ("AAAA-MM-DD") no fuso informado. */
export function todayInZone(timeZone = DEFAULT_TIMEZONE, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** "2026-10-20" → "20/10/2026". */
export const formatDateBr = (date: string) => date.split('-').reverse().join('/');
