import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/PageHeader';
import { SupplierForm } from '@/components/admin/suppliers/SupplierForm';
import { requireAdmin } from '@/server/admin';
import { saveSupplier } from '../actions';

export const metadata: Metadata = { title: 'Novo fornecedor' };

export default async function NewSupplierPage() {
  const ctx = await requireAdmin('suppliers:write');
  return (
    <>
      <PageHeader title="Novo fornecedor" description="Só o nome e um contato são obrigatórios; o resto pode ser preenchido aos poucos." />
      <SupplierForm action={saveSupplier.bind(null, null)} canShare={ctx.tenant.kind === 'MATRIZ'} />
    </>
  );
}
