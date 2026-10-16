import { todayInZone } from '@zaraki/core';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/PageHeader';
import { CountForm } from '@/components/admin/stock/CountForm';
import { requireAdmin } from '@/server/admin';
import { loadStockOptions } from '@/server/stock';
import { stockCountAction } from '../actions';

export const metadata: Metadata = { title: 'Contagem de estoque' };

export default async function CountPage() {
  const ctx = await requireAdmin('stock:write');
  const { items } = await loadStockOptions(ctx);
  return (
    <>
      <PageHeader
        title="Contagem de estoque"
        description="Conte o que há de fato e informe abaixo. Só os itens preenchidos entram; a diferença para o sistema vira um ajuste (sobra ou falta), registrado com a data e quem contou."
      />
      <CountForm items={items} today={todayInZone(ctx.tenant.timezone)} action={stockCountAction} />
    </>
  );
}
