export const ORDER_STAGES = [
  'NOVO',
  'CONFIRMADO',
  'EM_PREPARO',
  'PRONTO',
  'SAIU_PARA_ENTREGA',
  'ENTREGUE',
  'CANCELADO',
] as const;
export type OrderStage = (typeof ORDER_STAGES)[number];

export const STAGE_LABEL: Record<OrderStage, string> = {
  NOVO: 'Novo',
  CONFIRMADO: 'Confirmado',
  EM_PREPARO: 'Em preparo',
  PRONTO: 'Pronto',
  SAIU_PARA_ENTREGA: 'Saiu para entrega',
  ENTREGUE: 'Entregue',
  CANCELADO: 'Cancelado',
};

/** Fluxo normal do pedido (cancelamento pode acontecer em qualquer etapa não final). */
const FLOW: OrderStage[] = ['NOVO', 'CONFIRMADO', 'EM_PREPARO', 'PRONTO', 'SAIU_PARA_ENTREGA', 'ENTREGUE'];

export const isFinalStage = (stage: OrderStage) => stage === 'ENTREGUE' || stage === 'CANCELADO';

/** Próxima etapa do fluxo, ou null se o pedido já terminou. */
export function nextStage(stage: OrderStage): OrderStage | null {
  if (isFinalStage(stage)) return null;
  return FLOW[FLOW.indexOf(stage) + 1] ?? null;
}
