import { getTenantById, withContext } from '@zaraki/db';
import { Power, RotateCcw } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/admin/ConfirmAction';
import { StatusBadge } from '@/components/admin/list';
import { PageHeader } from '@/components/admin/PageHeader';
import { RecordTabs } from '@/components/admin/RecordTabs';
import { TenantForm } from '@/components/admin/TenantForm';
import { Badge } from '@/components/ui/badge';
import { isUuid } from '@/lib/ids';
import { requireAdmin } from '@/server/admin';
import { recordHistory } from '@/server/history';
import { saveTenant, setTenantStatusAction } from '../actions';

export const metadata: Metadata = { title: 'Unidade' };

export default async function TenantPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin('tenants:manage');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const tenant = await withContext({ ...ctx.db, platformAdmin: true }, (tx) => getTenantById(tx, id));
  if (!tenant) notFound();
  const history = await recordHistory(ctx, 'tenants', tenant.id);
  const matriz = tenant.kind === 'MATRIZ';

  return (
    <>
      <PageHeader
        title={tenant.name}
        description={matriz ? 'Unidade principal da rede.' : 'Franqueado.'}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {matriz && (
              <Badge variant="outline" className="border-brand-gold bg-accent">
                Matriz
              </Badge>
            )}
            <StatusBadge active={tenant.status} />
            {!matriz &&
              (tenant.status ? (
                <ConfirmAction
                  key="desativar"
                  label="Desativar"
                  icon={<Power />}
                  variant="destructive"
                  title={`Desativar ${tenant.name}?`}
                  description="A unidade some do seletor e deixa de operar. Pedidos, clientes, equipe e auditoria continuam guardados."
                  confirmLabel="Desativar unidade"
                  action={setTenantStatusAction.bind(null, tenant.id, false)}
                />
              ) : (
                <ConfirmAction
                  key="reativar"
                  label="Reativar"
                  icon={<RotateCcw />}
                  title={`Reativar ${tenant.name}?`}
                  description="A unidade volta ao seletor e pode operar normalmente."
                  confirmLabel="Reativar unidade"
                  action={setTenantStatusAction.bind(null, tenant.id, true)}
                />
              ))}
          </div>
        }
      />
      <RecordTabs history={history} timezone={ctx.tenant.timezone}>
        <TenantForm tenant={tenant} action={saveTenant.bind(null, tenant.id)} readOnly={!tenant.status} />
      </RecordTabs>
    </>
  );
}
