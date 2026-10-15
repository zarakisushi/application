'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export type ActionResult =
  | {
      ok?: boolean;
      error?: string;
      fieldErrors?: Record<string, string>;
      message?: string;
      secret?: string;
      redirectTo?: string;
      id?: string;
      url?: string;
    }
  | undefined;

/**
 * Envia o formulário para uma Server Action sem limpar os campos em caso de erro
 * (o reset automático de <form action> apagaria o que o usuário digitou).
 */
export function useServerForm(
  action: (form: FormData) => Promise<ActionResult>,
  options: { successMessage?: string; onSuccess?: (result: ActionResult) => void } = {},
) {
  const [result, setResult] = useState<ActionResult>();
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const r = await action(form);
      setResult(r);
      if (r?.ok) {
        if (r.message ?? options.successMessage) toast.success(r.message ?? options.successMessage);
        options.onSuccess?.(r);
        if (r.redirectTo && r.redirectTo !== pathname) router.push(r.redirectTo);
      } else if (r?.error && !r.fieldErrors) {
        toast.error(r.error);
      }
    });
  };

  return { result, pending, onSubmit, errors: result?.fieldErrors ?? {} };
}

/** Rótulo + controle + mensagem de erro do campo. */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('grid gap-2', className)} data-invalid={error ? true : undefined}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-sm text-destructive" id={`${htmlFor}-error`}>
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** Resumo de erros do formulário (quando há erros por campo, mostra o aviso geral). */
export function FormError({ result }: { result: ActionResult }) {
  if (!result?.error || !result.fieldErrors) return null;
  return (
    <Alert variant="destructive">
      <AlertDescription>{result.error}</AlertDescription>
    </Alert>
  );
}
