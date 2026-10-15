import type { HealthIndicator, HealthTone } from '@zaraki/core';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const TONE: Record<HealthTone, { dot: string; label: string }> = {
  good: { dot: 'bg-emerald-600', label: 'Bom' },
  warn: { dot: 'bg-amber-500', label: 'Atenção' },
  bad: { dot: 'bg-brand-red', label: 'Crítico' },
  neutral: { dot: 'bg-muted-foreground/40', label: 'Sem dados' },
};

/** Semáforo de saúde financeira: cada indicador com cor, valor e a explicação em português. */
export function HealthPanel({ indicators }: { indicators: HealthIndicator[] }) {
  const bad = indicators.filter((i) => i.tone === 'bad').length;
  const warn = indicators.filter((i) => i.tone === 'warn').length;
  const verdict = bad ? 'Pede atenção agora' : warn ? 'Saudável, com pontos de atenção' : 'Saudável';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Saúde financeira
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-medium',
              bad ? 'bg-red-50 text-brand-red' : warn ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800',
            )}
            data-testid="health-verdict"
          >
            {verdict}
          </span>
        </CardTitle>
        <CardDescription>Verde: tudo bem. Amarelo: atenção. Vermelho: agir logo.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-4 md:grid-cols-2">
          {indicators.map((i) => (
            <li key={i.key} className="flex gap-3" data-testid={`health-${i.key}`} data-tone={i.tone}>
              <span className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', TONE[i.tone].dot)} aria-label={TONE[i.tone].label} role="img" />
              <div className="grid gap-0.5">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium">{i.label}</span>
                  <span className="font-display text-lg font-bold tabular-nums">{i.value}</span>
                </div>
                <p className="text-sm text-muted-foreground">{i.message}</p>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
