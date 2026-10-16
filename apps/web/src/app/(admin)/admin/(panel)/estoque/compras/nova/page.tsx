import { todayInZone } from '@zaraki/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/admin/PageHeader';
import { PurchaseForm } from '@/components/admin/stock/PurchaseForm';
import { Card, CardContent } from '@/components/ui/card';
import { requireAdmin } from '@/server/admin';
import { loadStockOptions } from '@/server/stock';
import { uploadAttachmentAction } from '../../../financeiro/actions';
import { savePurchaseAction } from '../../actions';

export const metadata: Metadata = { title: 'Registrar compra' };

export default async function NewPurchasePage() {
  const ctx = await requireAdmin('stock:manage');
  const { items, accounts, suppliers } = await loadStockOptions(ctx);
  return (
    <>
      <PageHeader title="Registrar compra" description="Os itens entram no estoque e a conta a pagar vai para o Financeiro." />
      {items.length ? (
        <PurchaseForm items={items} accounts={accounts} suppliers={suppliers} today={todayInZone(ctx.tenant.timezone)} action={savePurchaseAction} upload={uploadAttachmentAction} />
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Cadastre os itens antes, em{' '}
            <Link href="/admin/estoque" className="underline">
              Estoque
            </Link>
            .
          </CardContent>
        </Card>
      )}
    </>
  );
}
