import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/PageHeader';
import { TenantForm } from '@/components/admin/TenantForm';
import { requireAdmin } from '@/server/admin';
import { saveTenant } from '../actions';

export const metadata: Metadata = { title: 'Nova unidade' };

export default async function NewTenantPage() {
  await requireAdmin('tenants:manage');
  return (
    <>
      <PageHeader title="Nova unidade" description="O franqueado nasce com uma cópia do cardápio atual da Matriz, que pode ser ajustada depois." />
      <TenantForm action={saveTenant.bind(null, null)} />
    </>
  );
}
