'use client';

import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type OrderStage } from '@zaraki/core';
import { HandCoins } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { changeStageAction, setOrderPaymentAction } from '@/server/order-actions';

type Props = {
  orderId: string;
  code: string;
  totalLabel: string;
  method: string | null;
  /** Etapa para a qual o pedido vai junto com o pagamento (pergunta ao entregar). */
  then?: OrderStage;
  /** Controle externo (pergunta ao entregar); sem ele, mostra o botão "Registrar pagamento". */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  size?: 'sm' | 'default';
};

/** Registra o pagamento de um pedido: a venda entra no caixa, na conta da forma escolhida. */
export function OrderPaymentButton({ orderId, code, totalLabel, method, then, open: controlled, onOpenChange, size = 'default' }: Props) {
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
  const setOpen = onOpenChange ?? setOwn;
  const [choice, setChoice] = useState(method ?? '');
  const [pending, startTransition] = useTransition();

  const run = (paid: boolean) =>
    startTransition(async () => {
      // "Ainda não": só muda a etapa; o pedido entregue e não pago aparece em "A receber".
      const r = paid ? await setOrderPaymentAction(orderId, true, choice, then) : await changeStageAction(orderId, then!);
      if (r?.error) {
        toast.error(r.error);
        return;
      }
      toast.success(paid ? r?.message : 'Pedido entregue. O pagamento fica em "A receber".');
      setOpen(false);
    });

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {controlled === undefined && (
        <AlertDialogTrigger asChild>
          <Button size={size} variant="outline">
            <HandCoins /> Registrar pagamento
          </Button>
        </AlertDialogTrigger>
      )}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{then ? 'Pagamento recebido?' : 'Registrar pagamento'}</AlertDialogTitle>
          <AlertDialogDescription>
            Pedido {code} · {totalLabel}. Ao confirmar, a venda entra no caixa na conta da forma de pagamento.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-2">
          <Label htmlFor={`pm-${orderId}`}>Forma de pagamento</Label>
          <Select value={choice} onValueChange={setChoice}>
            <SelectTrigger id={`pm-${orderId}`} className="w-full">
              <SelectValue placeholder="Escolha a forma" />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_METHODS.map((m) => (
                <SelectItem key={m} value={m}>
                  {PAYMENT_METHOD_LABEL[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <AlertDialogFooter>
          {then ? (
            <Button variant="outline" disabled={pending} onClick={() => run(false)}>
              Ainda não (só entregar)
            </Button>
          ) : (
            <AlertDialogCancel disabled={pending}>Voltar</AlertDialogCancel>
          )}
          <Button disabled={pending || !choice} onClick={() => run(true)}>
            {pending ? 'Salvando…' : then ? 'Sim, pagamento recebido' : 'Confirmar pagamento'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
