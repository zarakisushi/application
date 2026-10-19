import type { Permission } from '@zaraki/core';
import {
  Building2,
  CalendarDays,
  ChartColumn,
  ArrowLeftRight,
  BookOpen,
  Boxes,
  CalendarClock,
  ChartNoAxesCombined,
  ClipboardList,
  Gauge,
  HandCoins,
  Landmark,
  ListChecks,
  House,
  ScrollText,
  TicketPercent,
  Truck,
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
      { href: '/admin/tarefas', label: 'Tarefas', icon: ListChecks, permission: 'tasks:read' },
      { href: '/admin/pedidos', label: 'Pedidos', icon: ClipboardList, permission: 'orders:read' },
      { href: '/admin/encomendas', label: 'Festas e eventos', icon: CalendarDays, permission: 'orders:read' },
      { href: '/admin/clientes', label: 'Clientes', icon: Users, permission: 'customers:read' },
      { href: '/admin/cardapio', label: 'Cardápio', icon: UtensilsCrossed, permission: 'products:read' },
      { href: '/admin/cupons', label: 'Cupons', icon: TicketPercent, permission: 'coupons:read' },
      { href: '/admin/estoque', label: 'Estoque', icon: Boxes, permission: 'stock:read' },
      { href: '/admin/fornecedores', label: 'Fornecedores', icon: Truck, permission: 'suppliers:read' },
    ],
  },
  {
    label: 'Financeiro',
    items: [
      { href: '/admin/financeiro', label: 'Visão geral', icon: Gauge, permission: 'finance:read' },
      { href: '/admin/financeiro/lancamentos', label: 'Lançamentos', icon: ArrowLeftRight, permission: 'finance:read' },
      { href: '/admin/financeiro/agenda', label: 'A pagar e receber', icon: CalendarClock, permission: 'finance:read' },
      { href: '/admin/financeiro/fluxo', label: 'Fluxo de caixa e DRE', icon: ChartNoAxesCombined, permission: 'finance:read' },
      { href: '/admin/financeiro/royalties', label: 'Royalties', icon: HandCoins, permission: 'finance:read' },
      { href: '/admin/financeiro/contas', label: 'Contas e categorias', icon: Landmark, permission: 'finance:read' },
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
  {
    label: 'Ajuda',
    items: [{ href: '/admin/manual', label: 'Manual do sistema', icon: BookOpen }],
  },
];

export const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);
