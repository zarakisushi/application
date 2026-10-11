import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/admin/AuthShell';
import { ChangePasswordForm } from '@/components/admin/ChangePasswordForm';
import { getSessionUser } from '@/server/admin';

export const metadata: Metadata = { title: 'Trocar senha' };

export default async function ChangePasswordPage() {
  const user = await getSessionUser();
  if (!user) redirect('/admin/login');
  return (
    <AuthShell
      title="Trocar senha"
      subtitle={
        user.mustChangePassword
          ? 'Por segurança, defina uma nova senha antes do primeiro acesso.'
          : 'Defina uma nova senha. As outras sessões abertas serão encerradas.'
      }
    >
      <ChangePasswordForm />
    </AuthShell>
  );
}
