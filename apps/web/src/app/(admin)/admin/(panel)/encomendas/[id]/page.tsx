import type { Metadata } from 'next';
import { OrderDetail } from '@/components/admin/OrderDetail';
import { requireAdmin } from '@/server/admin';

export const metadata: Metadata = { title: 'Pedido' };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin('orders:read');
  return <OrderDetail ctx={ctx} id={(await params).id} section="encomendas" />;
}
