import { getTenantUser, withContext } from '@zaraki/db';
import { KeyRound, RotateCcw, UserX } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/admin/ConfirmAction';
import { StatusBadge } from '@/components/admin/list';
import { PageHeader } from '@/components/admin/PageHeader';
import { RecordTabs } from '@/components/admin/RecordTabs';
import { UserForm } from '@/components/admin/UserForm';
import { isUuid } from '@/lib/ids';
import { requireAdmin } from '@/server/admin';
import { recordHistory } from '@/server/history';
import { resetPasswordAction, setUserStatusAction, updateUserAction } from '../actions';

export const metadata: Metadata = { title: 'Usuário' };

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin('users:manage');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const user = await withContext(ctx.db, (tx) => getTenantUser(tx, ctx.tenant.id, id));
  if (!user) notFound();
  const history = await recordHistory(ctx, 'users', user.userId);

  const self = user.userId === ctx.user.id;
  // Administradores da rede só podem ser alterados pela Matriz.
  const editable = user.status && (!user.isPlatformAdmin || ctx.platformAdmin);

  return (
    <>
      <PageHeader
        title={user.name}
        description={user.email}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge active={user.status} />
            {editable && !self && (
              <ConfirmAction
                label="Redefinir senha"
                icon={<KeyRound />}
                title={`Redefinir a senha de ${user.name}?`}
                description="Uma senha provisória será gerada, as sessões abertas serão encerradas e a pessoa precisará trocá-la no próximo acesso."
                confirmLabel="Gerar senha provisória"
                action={resetPasswordAction.bind(null, user.userId)}
              />
            )}
            {!self &&
              (!user.isPlatformAdmin || ctx.platformAdmin) &&
              (user.status ? (
                <ConfirmAction
                  key="remover"
                  label="Remover acesso"
                  icon={<UserX />}
                  variant="destructive"
                  title={`Remover o acesso de ${user.name}?`}
                  description={`A pessoa deixa de acessar a ${ctx.tenant.name} e as sessões abertas são encerradas. O histórico de tudo o que ela fez continua na auditoria.`}
                  confirmLabel="Remover acesso"
                  action={setUserStatusAction.bind(null, user.userId, false)}
                />
              ) : (
                <ConfirmAction
                  key="devolver"
                  label="Devolver acesso"
                  icon={<RotateCcw />}
                  title={`Devolver o acesso de ${user.name}?`}
                  description="A pessoa volta a entrar com a senha que já tinha."
                  confirmLabel="Devolver acesso"
                  action={setUserStatusAction.bind(null, user.userId, true)}
                />
              ))}
          </div>
        }
      />
      <RecordTabs history={history} timezone={ctx.tenant.timezone}>
        <UserForm
          user={{ name: user.name, email: user.email, role: user.role, isPlatformAdmin: user.isPlatformAdmin }}
          action={updateUserAction.bind(null, user.userId)}
          canGrantNetwork={ctx.platformAdmin}
          lockRole={self}
          readOnly={!editable}
        />
      </RecordTabs>
    </>
  );
}
