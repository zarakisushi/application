'use client';

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import symbol from '@/assets/symbol.png';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import { ALL_NAV_ITEMS, NAV_GROUPS } from './nav';

function matches(pathname: string, href: string) {
  return href === '/admin' ? pathname === '/admin' : pathname === href || pathname.startsWith(`${href}/`);
}

/** Item do menu da página atual: o mais específico que casa (Financeiro › Lançamentos, não a Visão geral). */
function activeHref(pathname: string) {
  return ALL_NAV_ITEMS.map((i) => i.href)
    .filter((href) => matches(pathname, href))
    .sort((a, b) => b.length - a.length)[0];
}

/** Alterna entre "ícones + textos" e "apenas ícones" (a preferência fica salva em cookie). */
function CollapseToggle() {
  const { state, toggleSidebar, isMobile } = useSidebar();
  if (isMobile) return null;
  const collapsed = state === 'collapsed';
  const label = collapsed ? 'Mostrar textos do menu' : 'Mostrar apenas ícones';
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton onClick={toggleSidebar} tooltip={label} aria-label={label} aria-expanded={!collapsed}>
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          <span>{collapsed ? 'Expandir menu' : 'Apenas ícones'}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function AppSidebar({ allowed, tenantName }: { allowed: string[]; tenantName: string }) {
  const pathname = usePathname();
  const current = activeHref(pathname);
  const { setOpenMobile } = useSidebar();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="Zaraki Admin">
              <Link href="/admin">
                <Image src={symbol} alt="" width={32} height={30} className="size-8 shrink-0 object-contain" />
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="font-display text-sm font-bold tracking-[0.2em] text-brand-gold-light">ZARAKI</span>
                  <span className="truncate text-xs text-sidebar-foreground/70">{tenantName}</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((i) => allowed.includes(i.href));
          if (!items.length) return null;
          return (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel className="text-sidebar-foreground/50">{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => {
                    const active = item.href === current;
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          asChild
                          isActive={active}
                          tooltip={item.label}
                          className="data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground"
                        >
                          <Link href={item.href} onClick={() => setOpenMobile(false)}>
                            <item.icon />
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter>
        <CollapseToggle />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
