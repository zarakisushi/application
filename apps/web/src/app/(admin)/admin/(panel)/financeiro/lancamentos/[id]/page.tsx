import { FINANCE_ORIGIN_LABEL, todayInZone } from '@zaraki/core';
import { getEntry, listSeries, withContext } from '@zaraki/db';
import { RotateCcw, Trash2, Undo2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/admin/ConfirmAction';
import { FinanceEntryForm } from '@/components/admin/finance/FinanceEntryForm';
import { PayEntryButton } from '@/components/admin/finance/PayEntryButton';
import { Money, SituationBadge, formatDay } from '@/components/admin/finance/ui';
import { StatusBadge } from '@/components/admin/list';
import { PageHeader } from '@/components/admin/PageHeader';
import { RecordTabs } from '@/components/admin/RecordTabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { isUuid } from '@/lib/ids';
import { orderHref } from '@/lib/orders';
import { requireAdmin } from '@/server/admin';
import { loadFinanceOptions } from '@/server/finance';
import { recordHistory } from '@/server/history';
import { saveEntry, setEntryStatusAction, unpayEntryAction, uploadAttachmentAction } from '../../actions';

export const metadata: Metadata = { title: 'Lançamento' };

export default async function EntryPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin('finance:read');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await withContext(ctx.db, async (tx) => {
    const entry = await getEntry(tx, ctx.tenant.id, id);
    return entry && { entry, series: entry.seriesId ? await listSeries(tx, ctx.tenant.id, entry.seriesId) : [] };
  });
  if (!data) notFound();
  const { entry, series } = data;
  const [options, history] = await Promise.all([loadFinanceOptions(ctx), recordHistory(ctx, 'finance_entries', entry.id)]);
  const today = todayInZone(ctx.tenant.timezone);
  const automatic = entry.origin === 'PEDIDO' || entry.origin === 'TRANSFERENCIA';
  const canWrite = ctx.can('finance:write') && entry.status && !automatic;
  const activeAccounts = options.accounts.filter((a) => a.active).map((a) => ({ id: a.id, name: a.name }));

  return (
    <>
      <PageHeader
        title={entry.description}
        description={`${entry.direction === 'ENTRADA' ? 'Entrada' : 'Saída'} · ${FINANCE_ORIGIN_LABEL[entry.origin]}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Money cents={entry.amountCents} direction={entry.direction} className="mr-2 font-display text-2xl font-bold" />
            <SituationBadge entry={entry} today={today} />
            <StatusBadge active={entry.status} />
            {canWrite && !entry.paidOn && <PayEntryButton entry={entry} accounts={activeAccounts} today={today} size="default" />}
            {canWrite && entry.paidOn && (
              <ConfirmAction
                label="Desfazer pagamento"
                icon={<Undo2 />}
                title="Desfazer o pagamento?"
                description="O lançamento volta a ficar em aberto e sai do saldo da conta."
                confirmLabel="Desfazer pagamento"
                action={unpayEntryAction.bind(null, entry.id)}
              />
            )}
            {ctx.can('finance:manage') && entry.origin !== 'PEDIDO' &&
              (entry.status ? (
                <ConfirmAction
                  key="excluir"
                  label="Excluir"
                  icon={<Trash2 />}
                  variant="destructive"
                  title="Excluir este lançamento?"
                  description={
                    entry.origin === 'TRANSFERENCIA'
                      ? 'As duas pontas da transferência saem do saldo das contas. Fica registrado no histórico e pode ser restaurado.'
                      : 'O lançamento sai dos saldos e relatórios. Fica registrado no histórico e pode ser restaurado.'
                  }
                  confirmLabel="Excluir lançamento"
                  action={setEntryStatusAction.bind(null, entry.id, false)}
                />
              ) : (
                <ConfirmAction
                  key="restaurar"
                  label="Restaurar"
                  icon={<RotateCcw />}
                  title="Restaurar este lançamento?"
                  description="O lançamento volta aos saldos e relatórios."
                  confirmLabel="Restaurar"
                  action={setEntryStatusAction.bind(null, entry.id, true)}
                />
              ))}
          </div>
        }
      />

      {entry.origin === 'PEDIDO' && entry.orderId && entry.orderType && (
        <Alert className="mb-4">
          <AlertDescription>
            Venda do pedido{' '}
            <Link href={orderHref({ id: entry.orderId, type: entry.orderType })} className="font-medium underline">
              {entry.orderCode}
            </Link>
            . Este lançamento acompanha o pedido: para corrigir valor ou pagamento, altere o pedido. Cancelar o pedido estorna a entrada.
          </AlertDescription>
        </Alert>
      )}
      {entry.origin === 'TRANSFERENCIA' && (
        <Alert className="mb-4">
          <AlertDescription>Transferência entre contas: não conta como entrada nem saída da empresa, só move o saldo.</AlertDescription>
        </Alert>
      )}

      <RecordTabs history={history} timezone={ctx.tenant.timezone}>
        <div className="grid gap-6">
          <FinanceEntryForm
            entry={entry}
            categories={options.categories}
            accounts={options.accounts}
            counterparties={options.counterparties}
            today={today}
            action={saveEntry.bind(null, entry.id)}
            upload={uploadAttachmentAction}
            readOnly={!canWrite}
          />
          {series.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle>Série ({series.length} lançamentos)</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="grid gap-2 text-sm">
                  {series.map((s) => (
                    <li key={s.id} className={`flex flex-wrap items-center gap-3 ${s.status ? '' : 'opacity-50'}`}>
                      <span className="w-10 text-muted-foreground">{s.installment}º</span>
                      <Link href={`/admin/financeiro/lancamentos/${s.id}`} className={s.id === entry.id ? 'font-semibold' : 'hover:underline'}>
                        vence {formatDay(s.dueDate)}
                      </Link>
                      <Money cents={s.amountCents} />
                      <span className="text-muted-foreground">{s.paidOn ? `pago em ${formatDay(s.paidOn)}` : 'em aberto'}</span>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}
        </div>
      </RecordTabs>
    </>
  );
}
