import type { OrderStage, OrderType } from '@zaraki/core';
import { ORDER_TYPE_LABEL, STAGE_LABEL } from '@zaraki/core';
import type { StatusFilter } from '@zaraki/db';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type SearchParams = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Parâmetros comuns das listas: busca, situação (exclusão lógica) e página. */
export function readListParams(sp: SearchParams): { q?: string; status: StatusFilter; page: number } {
  const status = one(sp.status);
  return {
    q: one(sp.q)?.trim() || undefined,
    status: status === 'inativos' || status === 'todos' ? status : 'ativos',
    page: Number(one(sp.page)) || 1,
  };
}

export const param = one;

export function Pagination({
  page,
  pages,
  total,
  basePath,
  searchParams,
}: {
  page: number;
  pages: number;
  total: number;
  basePath: string;
  searchParams: SearchParams;
}) {
  const href = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      const value = one(v);
      if (value && k !== 'page') params.set(k, value);
    }
    if (p > 1) params.set('page', String(p));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  return (
    <div className="mt-4 flex items-center justify-between gap-4 text-sm text-muted-foreground">
      <span>
        {total} {total === 1 ? 'registro' : 'registros'}
      </span>
      {pages > 1 && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild disabled={page <= 1} className={cn(page <= 1 && 'pointer-events-none opacity-50')}>
            <Link href={href(page - 1)} aria-label="Página anterior">
              <ChevronLeft />
            </Link>
          </Button>
          <span>
            Página {page} de {pages}
          </span>
          <Button variant="outline" size="sm" asChild className={cn(page >= pages && 'pointer-events-none opacity-50')}>
            <Link href={href(page + 1)} aria-label="Próxima página">
              <ChevronRight />
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-12 text-center text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}

export function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge variant="outline" className="border-emerald-600/30 bg-emerald-50 text-emerald-800">
      Ativo
    </Badge>
  ) : (
    <Badge variant="outline" className="border-brand-red/30 bg-red-50 text-brand-red">
      Excluído
    </Badge>
  );
}

const STAGE_STYLE: Record<OrderStage, string> = {
  NOVO: 'border-amber-500/40 bg-amber-50 text-amber-800',
  CONFIRMADO: 'border-sky-500/40 bg-sky-50 text-sky-800',
  EM_PREPARO: 'border-violet-500/40 bg-violet-50 text-violet-800',
  PRONTO: 'border-teal-500/40 bg-teal-50 text-teal-800',
  SAIU_PARA_ENTREGA: 'border-indigo-500/40 bg-indigo-50 text-indigo-800',
  ENTREGUE: 'border-emerald-600/40 bg-emerald-50 text-emerald-800',
  CANCELADO: 'border-brand-red/40 bg-red-50 text-brand-red',
};

export function StageBadge({ stage }: { stage: OrderStage }) {
  return (
    <Badge variant="outline" className={STAGE_STYLE[stage]}>
      {STAGE_LABEL[stage]}
    </Badge>
  );
}

export function TypeBadge({ type }: { type: OrderType }) {
  return (
    <Badge variant="outline" className={type === 'FESTA' ? 'border-brand-gold bg-accent' : ''}>
      {ORDER_TYPE_LABEL[type]}
    </Badge>
  );
}

const SYNC_LABEL = {
  NAO_APLICA: null,
  PENDENTE: { text: 'Agenda: pendente', cls: 'border-amber-500/40 bg-amber-50 text-amber-800' },
  SINCRONIZADO: { text: 'Na agenda', cls: 'border-emerald-600/40 bg-emerald-50 text-emerald-800' },
  FALHA: { text: 'Agenda: falhou', cls: 'border-brand-red/40 bg-red-50 text-brand-red' },
} as const;

export function CalendarSyncBadge({ state }: { state: keyof typeof SYNC_LABEL }) {
  const info = SYNC_LABEL[state];
  if (!info) return null;
  return (
    <Badge variant="outline" className={info.cls}>
      {info.text}
    </Badge>
  );
}
