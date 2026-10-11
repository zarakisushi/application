import type { Permission } from '@zaraki/core';
import {
  Building2,
  CalendarDays,
  ChartColumn,
  ClipboardList,
  House,
  ScrollText,
  UserCog,
  Users,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Sem permissão definida = visível para todos os usuários logados. */
  permission?: Permission;
};

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Operação',
    items: [
      { href: '/admin', label: 'Início', icon: House },
      { href: '/admin/pedidos', label: 'Pedidos', icon: ClipboardList, permission: 'orders:read' },
      { href: '/admin/encomendas', label: 'Encomendas', icon: CalendarDays, permission: 'orders:read' },
      { href: '/admin/clientes', label: 'Clientes', icon: Users, permission: 'customers:read' },
      { href: '/admin/cardapio', label: 'Cardápio', icon: UtensilsCrossed, permission: 'products:read' },
    ],
  },
  {
    label: 'Gestão',
    items: [
      { href: '/admin/relatorios', label: 'Relatórios', icon: ChartColumn, permission: 'reports:read' },
      { href: '/admin/usuarios', label: 'Usuários', icon: UserCog, permission: 'users:manage' },
      { href: '/admin/auditoria', label: 'Auditoria', icon: ScrollText, permission: 'audit:read' },
      { href: '/admin/unidades', label: 'Unidades', icon: Building2, permission: 'tenants:manage' },
    ],
  },
];

export const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);
