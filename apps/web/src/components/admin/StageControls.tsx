'use client';

import { ORDER_STAGES, STAGE_LABEL, nextStage, type OrderStage } from '@zaraki/core';
import { ArrowRight, Ban } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { changeStageAction } from '@/server/order-actions';
import { ConfirmAction } from './ConfirmAction';
import { OrderPaymentButton } from './finance/OrderPaymentButton';

type Payment = { paid: boolean; code: string; totalLabel: string; method: string | null };

export function StageControls({ orderId, stage, payment }: { orderId: string; stage: OrderStage; payment: Payment }) {
  const [pending, startTransition] = useTransition();
  const [askPayment, setAskPayment] = useState(false);
  const next = nextStage(stage);

  const go = (to: OrderStage) => {
    // Entregar um pedido ainda não pago: pergunta se o pagamento foi recebido (a venda entra no caixa).
    if (to === 'ENTREGUE' && !payment.paid) {
      setAskPayment(true);
      return;
    }
    startTransition(async () => {
      const r = await changeStageAction(orderId, to);
      if (r?.error) toast.error(r.error);
      else if (r?.message) toast.success(r.message);
    });
  };

  return (
    <div className="grid gap-3">
      <OrderPaymentButton
        orderId={orderId}
        code={payment.code}
        totalLabel={payment.totalLabel}
        method={payment.method}
        then="ENTREGUE"
        open={askPayment}
        onOpenChange={setAskPayment}
      />
      {next && (
        <Button onClick={() => go(next)} disabled={pending} className="justify-between">
          Avançar para “{STAGE_LABEL[next]}” <ArrowRight />
        </Button>
      )}
      <Select value={stage} onValueChange={(v) => go(v as OrderStage)} disabled={pending}>
        <SelectTrigger className="w-full" aria-label="Mudar etapa">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ORDER_STAGES.filter((s) => s !== 'CANCELADO').map((s) => (
            <SelectItem key={s} value={s}>
              {STAGE_LABEL[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {stage !== 'CANCELADO' && (
        <ConfirmAction
          label="Cancelar pedido"
          icon={<Ban />}
          variant="destructive"
          title="Cancelar este pedido?"
          description="O cancelamento fica registrado no histórico. Festas e eventos saem da Google Agenda."
          reasonLabel="Motivo do cancelamento"
          confirmLabel="Cancelar pedido"
          action={(reason) => changeStageAction(orderId, 'CANCELADO', reason)}
        />
      )}
    </div>
  );
}
