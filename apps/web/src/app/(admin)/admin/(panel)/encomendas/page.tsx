import type { Metadata } from 'next';
import { OrdersList } from '@/components/admin/OrdersList';
import { requireAdmin } from '@/server/admin';

export const metadata: Metadata = { title: 'Festas e eventos' };

export default async function ScheduledOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const ctx = await requireAdmin('orders:read');
  return <OrdersList ctx={ctx} kind="encomendas" searchParams={await searchParams} />;
}
