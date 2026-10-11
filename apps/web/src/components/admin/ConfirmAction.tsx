'use client';

import { Copy } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
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
import { Textarea } from '@/components/ui/textarea';
import type { ActionResult } from './form';

type Props = {
  label: string;
  title: string;
  description: string;
  confirmLabel: string;
  /** Server Action (com os argumentos já vinculados); recebe o motivo quando `reasonLabel` é usado. */
  action: (reason?: string) => Promise<ActionResult>;
  variant?: 'default' | 'destructive' | 'outline' | 'secondary';
  reasonLabel?: string;
  icon?: React.ReactNode;
  size?: 'default' | 'sm';
};

/** Botão com confirmação para ações sensíveis (excluir, restaurar, cancelar, redefinir senha). */
export function ConfirmAction({ label, title, description, confirmLabel, action, variant = 'outline', reasonLabel, icon, size = 'default' }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = () =>
    startTransition(async () => {
      const result = await action(reasonLabel ? reason : undefined);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      if (result?.message) toast.success(result.message);
      if (result?.secret) setSecret(result.secret);
      else setOpen(false);
      setReason('');
    });

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setSecret(null);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant={variant} size={size}>
          {icon}
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        {secret ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Senha provisória</AlertDialogTitle>
              <AlertDialogDescription>
                Envie esta senha à pessoa por um canal seguro. Ela será mostrada só agora e precisará ser trocada no
                primeiro acesso.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <SecretBox value={secret} />
            <AlertDialogFooter>
              <AlertDialogAction>Fechar</AlertDialogAction>
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{title}</AlertDialogTitle>
              <AlertDialogDescription>{description}</AlertDialogDescription>
            </AlertDialogHeader>
            {reasonLabel && (
              <div className="grid gap-2">
                <Label htmlFor="confirm-reason">{reasonLabel}</Label>
                <Textarea id="confirm-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
              </div>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Voltar</AlertDialogCancel>
              <Button
                variant={variant === 'destructive' ? 'destructive' : 'default'}
                disabled={pending || (!!reasonLabel && !reason.trim())}
                onClick={run}
              >
                {pending ? 'Aguarde…' : confirmLabel}
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function SecretBox({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted p-3">
      <code className="flex-1 font-mono text-lg tracking-wider" data-testid="secret">
        {value}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => navigator.clipboard.writeText(value).then(() => toast.success('Copiada'))}
        aria-label="Copiar senha"
      >
        <Copy />
      </Button>
    </div>
  );
}
