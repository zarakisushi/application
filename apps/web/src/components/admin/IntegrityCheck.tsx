'use client';

import { ShieldAlert, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { verifyIntegrityAction, type IntegrityResult } from '@/app/(admin)/admin/(panel)/auditoria/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/** Recalcula a cadeia de hash e diz se algum registro foi adulterado. */
export function IntegrityCheck({ scope }: { scope: 'unidade' | 'rede' }) {
  const [result, setResult] = useState<IntegrityResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Card className="mb-4">
      <CardContent className="flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-2xl text-sm">
          {!result && (
            <p className="text-muted-foreground">
              Cada registro guarda uma assinatura (hash) que depende do anterior. Se alguém alterar ou apagar um registro
              direto no banco, a verificação aponta exatamente onde.
            </p>
          )}
          {result && 'error' in result && <p className="text-destructive">{result.error}</p>}
          {result && 'ok' in result && result.ok && (
            <p className="flex items-center gap-2 font-medium text-emerald-700" role="status">
              <ShieldCheck className="size-5" /> Trilha íntegra: {result.checked.toLocaleString('pt-BR')} registros verificados.
            </p>
          )}
          {result && 'ok' in result && !result.ok && (
            <p className="flex items-center gap-2 font-medium text-destructive" role="alert">
              <ShieldAlert className="size-5" /> Inconsistência encontrada no{' '}
              <Link href={`/admin/auditoria/${result.brokenAt}`} className="underline">
                registro #{result.brokenAt}
              </Link>
              . Acione o responsável técnico.
            </p>
          )}
        </div>
        <Button variant="outline" disabled={pending} onClick={() => startTransition(async () => setResult(await verifyIntegrityAction(scope)))}>
          <ShieldCheck /> {pending ? 'Verificando…' : 'Verificar integridade'}
        </Button>
      </CardContent>
    </Card>
  );
}
