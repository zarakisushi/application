'use client';

import { Building2, Check, ChevronsUpDown } from 'lucide-react';
import { useTransition } from 'react';
import { switchTenant } from '@/app/(admin)/admin/actions';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type Tenant = { id: string; name: string; kind: 'MATRIZ' | 'FRANQUIA' };

export function TenantSwitcher({ tenants, activeId }: { tenants: Tenant[]; activeId: string }) {
  const [pending, startTransition] = useTransition();
  const active = tenants.find((t) => t.id === activeId)!;

  if (tenants.length === 1) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Building2 className="size-4" />
        <span className="max-w-48 truncate">{active.name}</span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={pending} className="max-w-64 gap-2" aria-label="Trocar de unidade">
          <Building2 className="size-4" />
          <span className="truncate">{active.name}</span>
          <ChevronsUpDown className="size-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Unidade</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {tenants.map((t) => (
          <DropdownMenuItem
            key={t.id}
            onSelect={() => t.id !== activeId && startTransition(() => switchTenant(t.id))}
            className="gap-2"
          >
            <Check className={t.id === activeId ? 'size-4' : 'size-4 opacity-0'} />
            <span className="flex-1 truncate">{t.name}</span>
            {t.kind === 'MATRIZ' && <span className="text-xs text-muted-foreground">Matriz</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
