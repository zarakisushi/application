import type { Metadata } from 'next';
import { OrdersList } from '@/components/admin/OrdersList';
import { requireAdmin } from '@/server/admin';

export const metadata: Metadata = { title: 'Pedidos' };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const ctx = await requireAdmin('orders:read');
  return <OrdersList ctx={ctx} kind="pedidos" searchParams={await searchParams} />;
}
