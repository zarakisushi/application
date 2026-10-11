'use client';

import { KeyRound, LogOut } from 'lucide-react';
import Link from 'next/link';
import { logout } from '@/app/(admin)/admin/actions';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

export function UserMenu({ name, email, roleLabel }: { name: string; email: string; roleLabel: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-10 gap-2 px-2" aria-label="Menu do usuário">
          <Avatar className="size-8">
            <AvatarFallback className="bg-brand-ink text-xs font-bold text-brand-gold-light">{initials(name)}</AvatarFallback>
          </Avatar>
          <span className="hidden max-w-40 truncate text-sm font-medium sm:inline">{name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="text-sm font-medium">{name}</div>
          <div className="truncate text-xs text-muted-foreground">{email}</div>
          <div className="mt-1 text-xs text-muted-foreground">{roleLabel}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/admin/trocar-senha">
            <KeyRound />
            Trocar senha
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => logout()}>
          <LogOut />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
