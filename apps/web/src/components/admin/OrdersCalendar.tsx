import { todayInZone, zonedTimeToUtc } from '@zaraki/core';
import { listScheduledBetween, withContext } from '@zaraki/db';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { toDateTimeInputs } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { AdminContext } from '@/server/admin';

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** "2026-10" → { year: 2026, month: 10 }; inválido → mês atual no fuso da unidade. */
function parseMonth(value: string | undefined, timezone: string) {
  const match = value?.match(/^(\d{4})-(\d{2})$/);
  if (match) return { year: Number(match[1]), month: Number(match[2]) };
  const [y, m] = todayInZone(timezone).split('-').map(Number) as [number, number];
  return { year: y, month: m };
}

const ym = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;
const shift = (year: number, month: number, delta: number) => {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return ym(d.getUTCFullYear(), d.getUTCMonth() + 1);
};

/** Calendário mensal das encomendas e festas (canceladas e excluídas não aparecem). */
export async function OrdersCalendar({ ctx, month }: { ctx: AdminContext; month?: string }) {
  const tz = ctx.tenant.timezone;
  const { year, month: m } = parseMonth(month, tz);
  const from = zonedTimeToUtc(`${ym(year, m)}-01`, '00:00', tz);
  const to = zonedTimeToUtc(`${shift(year, m, 1)}-01`, '00:00', tz);
  const events = await withContext(ctx.db, (tx) => listScheduledBetween(tx, ctx.tenant.id, from, to));

  const byDay = new Map<string, typeof events>();
  for (const e of events) {
    const { date } = toDateTimeInputs(e.scheduledAt, tz);
    byDay.set(date, [...(byDay.get(date) ?? []), e]);
  }

  const daysInMonth = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const leading = new Date(Date.UTC(year, m - 1, 1)).getUTCDay();
  const cells: (number | null)[] = [...Array(leading).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const today = todayInZone(tz);
  const title = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, m - 1, 15)),
  );

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/admin/encomendas?visao=calendario&mes=${shift(year, m, -1)}`} aria-label="Mês anterior">
            <ChevronLeft />
          </Link>
        </Button>
        <h2 className="font-display text-lg font-bold first-letter:uppercase">{title}</h2>
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/admin/encomendas?visao=calendario&mes=${shift(year, m, 1)}`} aria-label="Próximo mês">
            <ChevronRight />
          </Link>
        </Button>
      </div>
      <div className="grid grid-cols-7 border-b bg-muted/50 text-center text-xs font-medium text-muted-foreground uppercase">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-2">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day, i) => {
          const date = day ? `${ym(year, m)}-${String(day).padStart(2, '0')}` : null;
          const list = (date && byDay.get(date)) || [];
          return (
            <div key={i} className={cn('min-h-28 border-r border-b p-1.5 text-sm [&:nth-child(7n)]:border-r-0', !day && 'bg-muted/30')}>
              {day && (
                <div className={cn('mb-1 inline-flex size-6 items-center justify-center rounded-full text-xs', date === today && 'bg-brand-ink font-bold text-brand-gold-light')}>
                  {day}
                </div>
              )}
              <div className="grid gap-1">
                {list.map((e) => (
                  <Link
                    key={e.id}
                    href={`/admin/encomendas/${e.id}`}
                    className={cn(
                      'truncate rounded px-1.5 py-0.5 text-xs hover:opacity-80',
                      e.type === 'FESTA' ? 'bg-brand-gold/25 text-foreground' : 'bg-sky-100 text-sky-900',
                    )}
                    title={`${e.code} · ${e.customerName}`}
                  >
                    <span className="font-semibold">{toDateTimeInputs(e.scheduledAt, tz).time}</span> {e.customerName}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
