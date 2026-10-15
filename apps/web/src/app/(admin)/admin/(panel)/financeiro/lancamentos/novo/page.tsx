import { todayInZone } from '@zaraki/core';
import type { Metadata } from 'next';
import { FinanceEntryForm } from '@/components/admin/finance/FinanceEntryForm';
import { param } from '@/components/admin/list';
import { PageHeader } from '@/components/admin/PageHeader';
import { requireAdmin } from '@/server/admin';
import { loadFinanceOptions } from '@/server/finance';
import { saveEntry, uploadAttachmentAction } from '../../actions';

export const metadata: Metadata = { title: 'Novo lançamento' };

export default async function NewEntryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const ctx = await requireAdmin('finance:write');
  const direction = param((await searchParams).tipo) === 'ENTRADA' ? 'ENTRADA' : 'SAIDA';
  const { categories, accounts, counterparties } = await loadFinanceOptions(ctx);
  return (
    <>
      <PageHeader
        title={direction === 'ENTRADA' ? 'Nova entrada' : 'Nova saída'}
        description="Contas a pagar e a receber ficam em aberto até você registrar o pagamento."
      />
      <FinanceEntryForm
        direction={direction}
        categories={categories}
        accounts={accounts}
        counterparties={counterparties}
        today={todayInZone(ctx.tenant.timezone)}
        action={saveEntry.bind(null, null)}
        upload={uploadAttachmentAction}
      />
    </>
  );
}
