'use client';

import { Sparkles } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { generateRoyaltiesAction } from '@/app/(admin)/admin/(panel)/financeiro/actions';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** Gera agora os royalties de um mês (o cron já faz isso todo dia para o mês anterior). */
export function GenerateRoyalties({ months }: { months: { value: string; label: string }[] }) {
  const [month, setMonth] = useState(months[0]?.value ?? '');
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={month} onValueChange={setMonth}>
        <SelectTrigger className="w-44 bg-card" aria-label="Mês dos royalties">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {months.map((m) => (
            <SelectItem key={m.value} value={m.value}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        disabled={pending || !month}
        onClick={() =>
          start(async () => {
            const r = await generateRoyaltiesAction(month);
            if (r?.error) toast.error(r.error);
            else toast.success(r?.message);
          })
        }
      >
        <Sparkles /> {pending ? 'Gerando…' : 'Gerar royalties'}
      </Button>
    </div>
  );
}
