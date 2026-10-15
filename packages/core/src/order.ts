import { z } from 'zod';
import { DomainError } from './domain';
import { normalizeBrPhone } from './phone';
import { normalizeCouponCode, parseMoneyToCents } from './text';

export const ORDER_TYPES = ['DELIVERY', 'ENCOMENDA', 'FESTA'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  DELIVERY: 'Delivery',
  ENCOMENDA: 'Encomenda',
  FESTA: 'Festa',
};

/** Encomendas e festas têm data/horário marcados e vão para a Google Agenda. */
export const isScheduled = (type: OrderType) => type !== 'DELIVERY';

/** Erro de regra de negócio do pedido, com mensagem pronta para mostrar ao cliente. */
export class OrderError extends DomainError {
  constructor(
    public readonly code: 'PRODUCT_UNAVAILABLE' | 'SCHEDULE_IN_PAST' | 'RATE_LIMITED' | 'INVALID' | 'COUPON_REJECTED',
    message: string,
  ) {
    super(message);
    this.name = 'OrderError';
  }
}

export const PAYMENT_METHODS = ['PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'DINHEIRO', 'OUTRO'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  PIX: 'Pix',
  CARTAO_CREDITO: 'Cartão de crédito',
  CARTAO_DEBITO: 'Cartão de débito',
  DINHEIRO: 'Dinheiro',
  OUTRO: 'Outro',
};

export const ORDER_SOURCES = ['SITE', 'ADMIN', 'WHATSAPP', 'BALCAO'] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];
export const ORDER_SOURCE_LABEL: Record<OrderSource, string> = {
  SITE: 'Site',
  ADMIN: 'Painel',
  WHATSAPP: 'WhatsApp',
  BALCAO: 'Balcão / telefone',
};
/** Origens que podem ser escolhidas ao lançar um pedido pelo painel. */
export const ADMIN_ORDER_SOURCES = ['WHATSAPP', 'BALCAO', 'ADMIN'] as const;

const optionalText = (max: number) => z.string().trim().max(max).default('');

export const phoneField = z.string().transform((value, ctx) => {
  const phone = normalizeBrPhone(value);
  if (!phone) {
    ctx.addIssue({ code: 'custom', message: 'Informe um WhatsApp válido com DDD' });
    return z.NEVER;
  }
  return phone;
});

/** Valor em reais digitado ("50,00"); vazio = 0. */
export const moneyField = z
  .string()
  .default('')
  .transform((value, ctx) => {
    if (!value.trim()) return 0;
    const cents = parseMoneyToCents(value);
    if (cents === null) {
      ctx.addIssue({ code: 'custom', message: 'Valor inválido (ex.: 50,00)' });
      return z.NEVER;
    }
    return cents;
  });

/** Checkbox de formulário HTML ("on") ou booleano. */
export const checkboxField = z.preprocess((v) => v === true || v === 'on' || v === 'true', z.boolean());

/** Campos de um pedido comuns ao site e ao painel. */
const orderDetails = {
  type: z.enum(ORDER_TYPES),
  date: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')]).default(''),
  time: z.union([z.literal(''), z.string().regex(/^\d{2}:\d{2}$/, 'Horário inválido')]).default(''),
  neighborhood: optionalText(120),
  address: optionalText(300),
  addressReference: optionalText(200),
  guests: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
    z.number('Número de convidados inválido').int().min(1, 'Informe o número de convidados').max(10_000).optional(),
  ),
  notes: optionalText(1000),
  /** Cupom de desconto (opcional); validado no servidor dentro da transação do pedido. */
  couponCode: z.string().max(40).default('').transform(normalizeCouponCode),
  items: z
    .array(z.object({ productId: z.uuid(), qty: z.number().int().min(1).max(500) }))
    .min(1, 'Adicione pelo menos um tubo ao pedido.')
    .max(50),
};

/** Regras por tipo: delivery exige endereço; encomenda/festa exigem data e horário; festa exige convidados. */
function refineOrder(
  v: { type: OrderType; neighborhood: string; address: string; date: string; time: string; guests?: number },
  ctx: z.RefinementCtx,
) {
  const require = (path: string, ok: unknown, message: string) => {
    if (!ok) ctx.addIssue({ code: 'custom', path: [path], message });
  };
  if (v.type === 'DELIVERY') {
    require('neighborhood', v.neighborhood, 'Informe o bairro para entrega');
    require('address', v.address, 'Informe o endereço para entrega');
  } else {
    require('date', v.date, 'Informe a data');
    require('time', v.time, 'Informe o horário');
  }
  if (v.type === 'FESTA') require('guests', v.guests, 'Informe o número de convidados');
}

/** Formas de pagamento que o cliente escolhe no site (dinheiro só pelo painel). */
export const SITE_PAYMENT_METHODS = ['PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO'] as const;
export type SitePaymentMethod = (typeof SITE_PAYMENT_METHODS)[number];

/** Pedido enviado pelo formulário do site. Preços nunca vêm do navegador. */
export const publicOrderSchema = z
  .object({
    ...orderDetails,
    name: z.string().trim().min(2, 'Informe seu nome').max(120),
    phone: phoneField,
    paymentMethod: z.enum(SITE_PAYMENT_METHODS, 'Escolha a forma de pagamento.'),
    /** Campo isca invisível: só robôs preenchem. */
    website: z.string().default(''),
  })
  .superRefine(refineOrder);

export type PublicOrderInput = z.input<typeof publicOrderSchema>;
export type PublicOrder = z.output<typeof publicOrderSchema>;

const adminExtras = {
  discount: moneyField,
  deliveryFee: moneyField,
  paymentMethod: z
    .union([z.literal(''), z.enum(PAYMENT_METHODS)])
    .default('')
    .transform((v) => v || null),
  paid: checkboxField,
};

/** Edição de pedido pelo painel (o cliente não muda: edite-o em Clientes). */
/** No painel, o desconto vem do cupom ou é digitado — não os dois. */
function refineAdminDiscount(v: { couponCode: string; discount: number }, ctx: z.RefinementCtx) {
  if (v.couponCode && v.discount > 0) {
    ctx.addIssue({ code: 'custom', path: ['discount'], message: 'Com cupom aplicado, deixe o desconto manual em branco.' });
  }
}

export const orderUpdateSchema = z
  .object({ ...orderDetails, ...adminExtras })
  .superRefine(refineOrder)
  .superRefine(refineAdminDiscount);
export type OrderUpdate = z.output<typeof orderUpdateSchema>;

/** Pedido lançado pelo painel (WhatsApp, balcão/telefone). */
export const adminOrderSchema = z
  .object({
    ...orderDetails,
    ...adminExtras,
    name: z.string().trim().min(2, 'Informe o nome do cliente').max(120),
    phone: phoneField,
    source: z.enum(ADMIN_ORDER_SOURCES),
  })
  .superRefine(refineOrder)
  .superRefine(refineAdminDiscount);
export type AdminOrder = z.output<typeof adminOrderSchema>;

/** Campos do pedido usados na criação (site e painel). */
export type OrderInput = Pick<
  PublicOrder,
  'type' | 'name' | 'phone' | 'date' | 'time' | 'neighborhood' | 'address' | 'addressReference' | 'guests' | 'notes' | 'items' | 'couponCode'
>;

export type PricedProduct = { id: string; name: string; priceCents: number; costCents?: number };

export type OrderLine = {
  productId: string;
  productName: string;
  unitPriceCents: number;
  unitCostCents: number;
  qty: number;
  lineTotalCents: number;
};

/**
 * Calcula as linhas e o total a partir do cardápio ativo. Itens repetidos são somados.
 * Lança OrderError se algum produto não estiver disponível.
 */
export function priceOrder(products: PricedProduct[], items: { productId: string; qty: number }[]) {
  const catalog = new Map(products.map((p) => [p.id, p]));
  const qtyById = new Map<string, number>();
  for (const item of items) qtyById.set(item.productId, (qtyById.get(item.productId) ?? 0) + item.qty);

  const lines: OrderLine[] = [];
  for (const [productId, qty] of qtyById) {
    const product = catalog.get(productId);
    if (!product) throw new OrderError('PRODUCT_UNAVAILABLE', 'Um dos sabores escolhidos não está mais disponível. Atualize a página.');
    lines.push({
      productId,
      productName: product.name,
      unitPriceCents: product.priceCents,
      unitCostCents: product.costCents ?? 0,
      qty,
      lineTotalCents: product.priceCents * qty,
    });
  }
  const subtotalCents = lines.reduce((sum, l) => sum + l.lineTotalCents, 0);
  const tubes = lines.reduce((sum, l) => sum + l.qty, 0);
  return { lines, subtotalCents, totalCents: subtotalCents, tubes };
}
