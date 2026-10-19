export const ROLES = ['ADMIN', 'GERENTE', 'ATENDENTE'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Administrador',
  GERENTE: 'Gerente',
  ATENDENTE: 'Atendente',
};

export const PERMISSIONS = [
  'orders:read',
  'orders:write',
  'orders:delete',
  'customers:read',
  'customers:write',
  'customers:delete',
  'products:read',
  'products:write',
  'products:delete',
  'coupons:read',
  'coupons:write',
  'coupons:delete',
  'finance:read',
  'finance:write',
  'finance:manage',
  'stock:read',
  'stock:write',
  'stock:manage',
  'stock:delete',
  'tasks:read',
  'tasks:write',
  'tasks:manage',
  'suppliers:read',
  'suppliers:write',
  'suppliers:delete',
  'users:manage',
  'reports:read',
  'audit:read',
  'tenants:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const GRANTS: Record<Role, readonly Permission[]> = {
  ADMIN: PERMISSIONS.filter((p) => p !== 'tenants:manage'),
  GERENTE: [
    'orders:read',
    'orders:write',
    'orders:delete',
    'customers:read',
    'customers:write',
    'customers:delete',
    'products:read',
    'products:write',
    'coupons:read',
    'coupons:write',
    'finance:read',
    'finance:write',
    'stock:read',
    'stock:write',
    'stock:manage',
    'tasks:read',
    'tasks:write',
    'tasks:manage',
    'suppliers:read',
    'suppliers:write',
    'reports:read',
  ],
  ATENDENTE: [
    'orders:read',
    'orders:write',
    'customers:read',
    'customers:write',
    'products:read',
    'stock:read',
    'stock:write',
    'tasks:read',
    'tasks:write',
  ],
};

export type Actor = {
  /** Papel na unidade ativa (null = sem vínculo). */
  role: Role | null;
  /** Usuário da Matriz com acesso total a todas as unidades. */
  platformAdmin: boolean;
};

export function can(actor: Actor, permission: Permission): boolean {
  if (actor.platformAdmin) return true;
  return actor.role ? GRANTS[actor.role].includes(permission) : false;
}
