'use client';

import { ORDER_STAGES, STAGE_LABEL, nextStage, type OrderStage } from '@zaraki/core';
import { ArrowRight, Ban } from 'lucide-react';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { changeStageAction } from '@/server/order-actions';
import { ConfirmAction } from './ConfirmAction';

export function StageControls({ orderId, stage }: { orderId: string; stage: OrderStage }) {
  const [pending, startTransition] = useTransition();
  const next = nextStage(stage);

  const go = (to: OrderStage) =>
    startTransition(async () => {
      const r = await changeStageAction(orderId, to);
      if (r?.error) toast.error(r.error);
      else if (r?.message) toast.success(r.message);
    });

  return (
    <div className="grid gap-3">
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
          description="O cancelamento fica registrado no histórico. Encomendas e festas saem da Google Agenda."
          reasonLabel="Motivo do cancelamento"
          confirmLabel="Cancelar pedido"
          action={(reason) => changeStageAction(orderId, 'CANCELADO', reason)}
        />
      )}
    </div>
  );
}
