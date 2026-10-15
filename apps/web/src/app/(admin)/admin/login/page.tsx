import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/admin/AuthShell';
import { LoginForm } from '@/components/admin/LoginForm';
import { getSessionUser } from '@/server/admin';

export const metadata: Metadata = { title: 'Entrar' };

export default async function LoginPage() {
  if (await getSessionUser()) redirect('/admin');
  return (
    <AuthShell title="Entrar" subtitle="Acesso restrito à equipe Zaraki Sushi.">
      <LoginForm />
    </AuthShell>
  );
}
