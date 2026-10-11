'use client';

import { PERIOD_PRESETS } from '@zaraki/core';
import { Download } from 'lucide-react';
import Form from 'next/form';
import { usePathname } from 'next/navigation';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type Option = { value: string; label: string };
type Filter = { name: string; label: string; value: string; options: Option[] };

/** Filtros do relatório (na URL) e botão de exportação. */
export function ReportFilters({
  period,
  filters,
  exportHref,
}: {
  /** null = relatório sem filtro de período. */
  period: { preset: string; from: string; to: string } | null;
  filters: Filter[];
  exportHref: string;
}) {
  const pathname = usePathname();
  const form = useRef<HTMLFormElement>(null);
  const [preset, setPreset] = useState(period?.preset ?? '30d');
  const submit = () => setTimeout(() => form.current?.requestSubmit());

  const select = (f: Filter, onChange?: (v: string) => void) => (
    <Select
      key={f.name}
      name={f.name}
      defaultValue={f.value}
      onValueChange={(v) => {
        onChange?.(v);
        if (f.name !== 'periodo' || v !== 'personalizado') submit();
      }}
    >
      <SelectTrigger className="w-48 bg-card" aria-label={f.label}>
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
  );

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <Form ref={form} action={pathname} className="flex flex-wrap items-center gap-2">
        {period &&
          select(
            {
              name: 'periodo',
              label: 'Período',
              value: period.preset,
              options: Object.entries(PERIOD_PRESETS).map(([value, label]) => ({ value, label })),
            },
            setPreset,
          )}
        {period && preset === 'personalizado' && (
          <>
            <Input type="date" name="de" defaultValue={period.from} className="w-40 bg-card" aria-label="De" />
            <Input type="date" name="ate" defaultValue={period.to} className="w-40 bg-card" aria-label="Até" />
            <Button type="submit" variant="secondary">
              Aplicar
            </Button>
          </>
        )}
        {filters.map((f) => select(f))}
      </Form>
      <Button variant="outline" asChild>
        <a href={exportHref} download>
          <Download /> Exportar CSV
        </a>
      </Button>
    </div>
  );
}
