import type { Metadata } from 'next';
import { CustomerForm } from '@/components/admin/CustomerForm';
import { PageHeader } from '@/components/admin/PageHeader';
import { requireAdmin } from '@/server/admin';
import { saveCustomer } from '../actions';

export const metadata: Metadata = { title: 'Novo cliente' };

export default async function NewCustomerPage() {
  await requireAdmin('customers:write');
  return (
    <>
      <PageHeader title="Novo cliente" />
      <CustomerForm action={saveCustomer.bind(null, null)} />
    </>
  );
}
