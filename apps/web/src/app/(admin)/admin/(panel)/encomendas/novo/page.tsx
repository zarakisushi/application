import { listActiveMenu, withContext } from '@zaraki/db';
import type { Metadata } from 'next';
import { OrderEditor } from '@/components/admin/OrderEditor';
import { PageHeader } from '@/components/admin/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { requireAdmin } from '@/server/admin';
import { createOrderAction } from '@/server/order-actions';

export const metadata: Metadata = { title: 'Nova encomenda' };

export default async function NewOrderPage() {
  const ctx = await requireAdmin('orders:write');
  const menu = await withContext(ctx.db, (tx) => listActiveMenu(tx));
  return (
    <>
      <PageHeader title="Nova encomenda" description="Lance pedidos recebidos pelo WhatsApp, telefone ou balcão." />
      <Card>
        <CardContent className="pt-6">
          <OrderEditor mode="create" defaultType="ENCOMENDA" products={menu} action={createOrderAction} />
        </CardContent>
      </Card>
    </>
  );
}
