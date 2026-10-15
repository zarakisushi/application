import type { OrderType } from '@zaraki/core';

/** Delivery fica em Pedidos; encomendas e festas, em Encomendas. */
export const orderSection = (type: OrderType) => (type === 'DELIVERY' ? 'pedidos' : 'encomendas');

export const orderHref = (o: { id: string; type: OrderType }) => `/admin/${orderSection(o.type)}/${o.id}`;
