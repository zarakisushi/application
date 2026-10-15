import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/PageHeader';
import { UserForm } from '@/components/admin/UserForm';
import { requireAdmin } from '@/server/admin';
import { createUserAction } from '../actions';

export const metadata: Metadata = { title: 'Novo usuário' };

export default async function NewUserPage() {
  const ctx = await requireAdmin('users:manage');
  return (
    <>
      <PageHeader
        title="Novo usuário"
        description={`Acesso ao painel da ${ctx.tenant.name}. Uma senha provisória será gerada.`}
      />
      <UserForm action={createUserAction} canGrantNetwork={ctx.platformAdmin} />
    </>
  );
}
