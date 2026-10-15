import { formatCents } from './money';
import { ORDER_TYPE_LABEL, PAYMENT_METHOD_LABEL, isScheduled, type OrderLine, type OrderType, type PaymentMethod } from './order';
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
  addressReference?: string;
  guests?: number;
  paymentMethod?: PaymentMethod | null;
  notes?: string;
  lines: Pick<OrderLine, 'productName' | 'qty' | 'lineTotalCents'>[];
  /** Cupom aplicado e o desconto que ele deu. */
  couponCode?: string | null;
  discountCents?: number;
  totalCents: number;
};

/** Mensagem que o cliente envia para a Zaraki pelo WhatsApp. */
export function buildOrderMessage(o: OrderMessage): string {
  const para = o.type === 'FESTA' ? ' para uma festa' : o.type === 'ENCOMENDA' ? ' para um evento' : '';
  const lines: (string | null)[] = [
    `Olá, Zaraki Sushi! Quero fazer um pedido de Push Pop Sushi${para}.`,
    o.code ? `Pedido: ${o.code}` : null,
    '',
    `Tipo: ${ORDER_TYPE_LABEL[o.type]}`,
    `Nome: ${o.name}`,
    `WhatsApp: ${formatBrPhone(o.phone)}`,
    isScheduled(o.type) && o.date ? `Data: ${formatDateBr(o.date)}${o.time ? ` às ${o.time}` : ''}` : null,
    o.neighborhood ? `Bairro: ${o.neighborhood}` : null,
    o.address ? `Endereço: ${o.address}` : null,
    o.addressReference ? `Ponto de referência: ${o.addressReference}` : null,
    isScheduled(o.type) && o.guests ? `Convidados: ${o.guests}` : null,
    '',
    ...o.lines.map((l) => `• ${l.qty}x ${l.productName} (${formatCents(l.lineTotalCents)})`),
    o.couponCode && o.discountCents ? `Cupom ${o.couponCode}: − ${formatCents(o.discountCents)}` : null,
    `Total estimado: ${formatCents(o.totalCents)}`,
    o.paymentMethod ? `Pagamento: ${PAYMENT_METHOD_LABEL[o.paymentMethod]}` : null,
    o.notes ? `\nObs: ${o.notes}` : null,
  ];
  return lines.filter((l) => l !== null).join('\n');
}

/** Link de conversa do WhatsApp (wa.me) com a mensagem preenchida. */
export const whatsappUrl = (number: string, text?: string) =>
  `https://wa.me/${waDigits(number)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
