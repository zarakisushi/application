'use client';

import { useOptimistic, useTransition } from 'react';
import { toast } from 'sonner';
import { setCouponActiveAction } from '@/app/(admin)/admin/(panel)/cupons/actions';
import { Switch } from '@/components/ui/switch';

/** Liga/desliga o cupom direto da lista ou da ficha. */
export function CouponActiveSwitch({ id, code, active, disabled }: { id: string; code: string; active: boolean; disabled?: boolean }) {
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(active);
  return (
    <Switch
      checked={optimistic}
      disabled={disabled || pending}
      aria-label={`Cupom ${code} ativo`}
      onCheckedChange={(next) =>
        startTransition(async () => {
          setOptimistic(next);
          const r = await setCouponActiveAction(id, next);
          if (r?.error) toast.error(r.error);
          else if (r?.message) toast.success(r.message);
        })
      }
    />
  );
}
