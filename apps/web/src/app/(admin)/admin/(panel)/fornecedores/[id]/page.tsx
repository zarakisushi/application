import { formatDocument } from '@zaraki/core';
import { getSupplier, withContext } from '@zaraki/db';
import { Copy, Mail, Network, RotateCcw, Trash2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/admin/ConfirmAction';
import { StatusBadge } from '@/components/admin/list';
import { PageHeader } from '@/components/admin/PageHeader';
import { RecordTabs } from '@/components/admin/RecordTabs';
import { CallButton, WhatsappButton } from '@/components/admin/suppliers/ContactButtons';
import { SupplierForm } from '@/components/admin/suppliers/SupplierForm';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { isUuid } from '@/lib/ids';
import { requireAdmin } from '@/server/admin';
import { recordHistory } from '@/server/history';
import { copyNetworkSupplierAction, saveSupplier, setSupplierStatusAction } from '../actions';

export const metadata: Metadata = { title: 'Fornecedor' };

export default async function SupplierPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const ctx = await requireAdmin('suppliers:read');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supplier = await withContext(ctx.db, (tx) => getSupplier(tx, ctx.tenant.id, id));
  if (!supplier) notFound();

  const description = [supplier.legalName, supplier.document && formatDocument(supplier.document)].filter(Boolean).join(' · ') || undefined;
  const contacts = (
    <div className="flex flex-wrap items-center gap-2">
      {supplier.whatsapp && <WhatsappButton number={supplier.whatsapp} unitName={ctx.tenant.name} />}
      {supplier.phone && <CallButton number={supplier.phone} />}
      {supplier.email && (
        <Button variant="outline" size="sm" asChild>
          <a href={`mailto:${supplier.email}`}>
            <Mail /> {supplier.email}
          </a>
        </Button>
      )}
    </div>
  );

  // Fornecedor da rede visto por uma franquia: só leitura, com a opção de copiar.
  if (supplier.fromNetwork) {
    return (
      <>
        <PageHeader title={supplier.name} description={description} actions={contacts} />
        <Alert className="mb-6 border-brand-gold/50 bg-brand-gold/10">
          <Network />
          <AlertTitle>Fornecedor indicado pela Matriz</AlertTitle>
          <AlertDescription>
            <p>Este cadastro é da {supplier.ownerName} e aparece para toda a rede só para consulta. Para anotar os seus combinados, copie para os seus fornecedores.</p>
            <div className="mt-3">
              {supplier.copyId ? (
                <Button variant="outline" asChild>
                  <Link href={`/admin/fornecedores/${supplier.copyId}`}>Abrir a minha cópia</Link>
                </Button>
              ) : (
                ctx.can('suppliers:write') && (
                  <ConfirmAction
                    label="Copiar para meus fornecedores"
                    icon={<Copy />}
                    variant="default"
                    title="Copiar este fornecedor?"
                    description="Uma cópia entra no cadastro da sua unidade, para você editar à vontade. O cadastro da Matriz não muda."
                    confirmLabel="Copiar"
                    action={copyNetworkSupplierAction.bind(null, supplier.id)}
                  />
                )
              )}
            </div>
          </AlertDescription>
        </Alert>
        <SupplierForm supplier={supplier} action={saveSupplier.bind(null, null)} readOnly />
      </>
    );
  }

  const history = await recordHistory(ctx, 'suppliers', supplier.id);
  const { copiado } = await searchParams;
  return (
    <>
      <PageHeader
        title={supplier.name}
        description={description}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge active={supplier.status} />
            {supplier.networkShared && (
              <span className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs">
                <Network className="size-3.5" /> Compartilhado com a rede
              </span>
            )}
            {ctx.can('suppliers:delete') &&
              (supplier.status ? (
                <ConfirmAction
                  key="excluir"
                  label="Excluir"
                  icon={<Trash2 />}
                  variant="destructive"
                  title="Excluir este fornecedor?"
                  description="O cadastro fica inativo (e sai da rede, se estava compartilhado). O histórico continua guardado e é possível restaurar depois."
                  confirmLabel="Excluir fornecedor"
                  action={setSupplierStatusAction.bind(null, supplier.id, false)}
                />
              ) : (
                <ConfirmAction
                  key="restaurar"
                  label="Restaurar"
                  icon={<RotateCcw />}
                  title="Restaurar este fornecedor?"
                  description="O cadastro volta a ficar ativo."
                  confirmLabel="Restaurar fornecedor"
                  action={setSupplierStatusAction.bind(null, supplier.id, true)}
                />
              ))}
          </div>
        }
      />
      {copiado && (
        <Alert className="mb-6 border-emerald-300 bg-emerald-50">
          <Copy />
          <AlertTitle>{copiado === '1' ? 'Fornecedor copiado para o seu cadastro.' : 'Este fornecedor já estava no seu cadastro.'}</AlertTitle>
          <AlertDescription>Agora ele é da sua unidade: ajuste contatos, combinados e observações à vontade.</AlertDescription>
        </Alert>
      )}
      <div className="mb-6">{contacts}</div>
      <RecordTabs history={history} timezone={ctx.tenant.timezone}>
        <SupplierForm
          supplier={supplier}
          action={saveSupplier.bind(null, supplier.id)}
          readOnly={!ctx.can('suppliers:write') || !supplier.status}
          canShare={ctx.tenant.kind === 'MATRIZ'}
        />
      </RecordTabs>
    </>
  );
}
