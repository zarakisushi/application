'use client';

import { RefreshCw } from 'lucide-react';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { retryCalendarSyncAction } from '@/server/order-actions';

export function CalendarRetryButton({ orderId }: { orderId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      className="w-fit"
      onClick={() =>
        startTransition(async () => {
          const r = await retryCalendarSyncAction(orderId);
          if (r?.error) toast.error(r.error);
          else if (r?.message) toast.success(r.message);
        })
      }
    >
      <RefreshCw className={pending ? 'animate-spin' : ''} /> Sincronizar agora
    </Button>
  );
}
