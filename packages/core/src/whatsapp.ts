import { formatCents } from './money';
import { ORDER_TYPE_LABEL, isScheduled, type OrderLine, type OrderType } from './order';
import { formatBrPhone, waDigits } from './phone';
import { formatDateBr } from './time';

export type OrderMessage = {
  code?: string | null;
  type: OrderType;
  name: string;
  phone: string;
  date?: string;
  time?: string;
  neighborhood?: string;
  address?: string;
  guests?: number;
  notes?: string;
  lines: Pick<OrderLine, 'productName' | 'qty' | 'lineTotalCents'>[];
  totalCents: number;
};

/** Mensagem que o cliente envia para a Zaraki pelo WhatsApp. */
export function buildOrderMessage(o: OrderMessage): string {
  const kind = o.type === 'DELIVERY' ? 'um pedido' : 'uma encomenda';
  const lines: (string | null)[] = [
    `Olá, Zaraki Sushi! Quero fazer ${kind} de Push-Pop Sushi.`,
    o.code ? `Pedido: ${o.code}` : null,
    '',
    `Tipo: ${ORDER_TYPE_LABEL[o.type]}`,
    `Nome: ${o.name}`,
    `WhatsApp: ${formatBrPhone(o.phone)}`,
    isScheduled(o.type) && o.date ? `Data: ${formatDateBr(o.date)}${o.time ? ` às ${o.time}` : ''}` : null,
    o.neighborhood ? `Bairro: ${o.neighborhood}` : null,
    o.address ? `Endereço: ${o.address}` : null,
    o.type === 'FESTA' && o.guests ? `Convidados: ${o.guests}` : null,
    '',
    ...o.lines.map((l) => `• ${l.qty}x ${l.productName} (${formatCents(l.lineTotalCents)})`),
    `Total estimado: ${formatCents(o.totalCents)}`,
    o.notes ? `\nObs: ${o.notes}` : null,
  ];
  return lines.filter((l) => l !== null).join('\n');
}

/** Link de conversa do WhatsApp (wa.me) com a mensagem preenchida. */
export const whatsappUrl = (number: string, text?: string) =>
  `https://wa.me/${waDigits(number)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
