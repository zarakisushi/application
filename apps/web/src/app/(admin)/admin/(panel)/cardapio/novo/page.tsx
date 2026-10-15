import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/PageHeader';
import { ProductForm } from '@/components/admin/ProductForm';
import { requireAdmin } from '@/server/admin';
import { saveProduct, uploadProductImageAction } from '../actions';

export const metadata: Metadata = { title: 'Novo sabor' };

export default async function NewProductPage() {
  await requireAdmin('products:write');
  return (
    <>
      <PageHeader title="Novo sabor" />
      <ProductForm action={saveProduct.bind(null, null)} uploadAction={uploadProductImageAction} />
    </>
  );
}
