'use client';

import { Search } from 'lucide-react';
import Form from 'next/form';
import { usePathname } from 'next/navigation';
import { useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ToolbarFilter } from './filters';

/** Busca e filtros da lista, guardados na URL (dá para compartilhar o link e voltar ao mesmo filtro). */
export function ListToolbar({
  q,
  placeholder,
  filters = [],
  hidden = {},
}: {
  q?: string;
  placeholder: string;
  filters?: ToolbarFilter[];
  /** Parâmetros preservados que não aparecem como campo (ex.: visão de calendário). */
  hidden?: Record<string, string>;
}) {
  const pathname = usePathname();
  const form = useRef<HTMLFormElement>(null);

  return (
    <Form ref={form} action={pathname} className="mb-4 flex flex-wrap items-center gap-2" role="search">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="relative min-w-56 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input name="q" defaultValue={q} placeholder={placeholder} className="bg-card pl-9" aria-label={placeholder} />
      </div>
      {filters.map((f) => (
        <Select key={f.name} name={f.name} defaultValue={f.value} onValueChange={() => setTimeout(() => form.current?.requestSubmit())}>
          <SelectTrigger className="w-44 bg-card" aria-label={f.label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {f.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}
    </Form>
  );
}
