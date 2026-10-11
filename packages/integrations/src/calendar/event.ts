import { ORDER_TYPE_LABEL, formatBrPhone, formatCents, type OrderType } from '@zaraki/core';
import type { CalendarEvent } from './types';

/** Ids de evento do Google aceitam só 0-9 e a-v: o uuid do pedido sem hífens serve. */
export const eventIdForOrder = (orderId: string) => orderId.replace(/-/g, '').toLowerCase();

/** Duração padrão do evento na agenda. */
const DURATION_MINUTES: Record<Exclude<OrderType, 'DELIVERY'>, number> = { FESTA: 120, ENCOMENDA: 30 };
/** Cores do Google Agenda: 5 = amarelo (festa), 9 = azul (encomenda). */
const COLOR: Record<Exclude<OrderType, 'DELIVERY'>, string> = { FESTA: '5', ENCOMENDA: '9' };

export type CalendarOrder = {
  order: {
    id: string;
    code: string;
    type: OrderType;
    scheduledAt: Date;
    guests: number | null;
    neighborhood: string | null;
    address: string | null;
    notes: string | null;
    totalCents: number;
    paid: boolean;
  };
  customer: { name: string; phone: string };
  items: { productName: string; qty: number }[];
  timezone: string;
  /** Endereço do painel, para o link "abrir no painel" (opcional). */
  adminBaseUrl?: string;
};

export function buildCalendarEvent({ order, customer, items, timezone, adminBaseUrl }: CalendarOrder): CalendarEvent {
  const type = order.type === 'FESTA' ? 'FESTA' : 'ENCOMENDA';
  const tubes = items.reduce((s, i) => s + i.qty, 0);
  const end = new Date(order.scheduledAt.getTime() + DURATION_MINUTES[type] * 60_000);
  const location = [order.address, order.neighborhood].filter(Boolean).join(' · ');

  const description = [
    `Pedido ${order.code} · ${ORDER_TYPE_LABEL[type]}`,
    `Cliente: ${customer.name} · ${formatBrPhone(customer.phone)}`,
    order.guests ? `Convidados: ${order.guests}` : null,
    '',
    ...items.map((i) => `• ${i.qty}x ${i.productName}`),
    `Total: ${formatCents(order.totalCents)}${order.paid ? ' (pago)' : ''}`,
    order.notes ? `\nObs: ${order.notes}` : null,
    adminBaseUrl ? `\nAbrir no painel: ${adminBaseUrl.replace(/\/$/, '')}/admin/encomendas/${order.id}` : null,
  ]
    .filter((l) => l !== null)
    .join('\n');

  return {
    id: eventIdForOrder(order.id),
    summary: `${ORDER_TYPE_LABEL[type]} · ${customer.name} · ${tubes} ${tubes === 1 ? 'tubo' : 'tubos'}`,
    description,
    ...(location ? { location } : {}),
    start: { dateTime: order.scheduledAt.toISOString(), timeZone: timezone },
    end: { dateTime: end.toISOString(), timeZone: timezone },
    colorId: COLOR[type],
    extendedProperties: { private: { zarakiOrderId: order.id, zarakiOrderCode: order.code } },
  };
}
