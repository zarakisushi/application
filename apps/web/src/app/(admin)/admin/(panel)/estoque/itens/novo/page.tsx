import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/PageHeader';
import { StockItemForm } from '@/components/admin/stock/StockItemForm';
import { requireAdmin } from '@/server/admin';
import { loadStockOptions } from '@/server/stock';
import { saveStockItem } from '../../actions';

export const metadata: Metadata = { title: 'Novo item de estoque' };

export default async function NewStockItemPage() {
  const ctx = await requireAdmin('stock:manage');
  const { categories, suppliers } = await loadStockOptions(ctx);
  return (
    <>
      <PageHeader title="Novo item de estoque" description="Insumo, embalagem, material de marketing ou operacional." />
      <StockItemForm categories={categories} suppliers={suppliers.map((s) => s.name)} action={saveStockItem.bind(null, null)} />
    </>
  );
}
