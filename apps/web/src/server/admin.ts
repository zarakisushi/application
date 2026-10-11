import 'server-only';
import { can, type Permission, type Role } from '@zaraki/core';
import { listActiveTenants, listUserTenants, logEvent, withContext, getDb, type DbContext } from '@zaraki/db';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getAuth } from './auth';
import { requestMeta } from './request';

export const TENANT_COOKIE = 'zk_tenant';

export type AdminTenant = { id: string; name: string; kind: 'MATRIZ' | 'FRANQUIA'; timezone: string; role: Role };

export type AdminContext = {
  user: { id: string; name: string; email: string; mustChangePassword: boolean };
  platformAdmin: boolean;
  /** Unidade ativa e papel do usuário nela. */
  tenant: AdminTenant;
  /** Unidades que o usuário pode escolher no seletor. */
  tenants: AdminTenant[];
  /** Contexto de banco da unidade ativa (RLS restringe à unidade, mesmo para a Matriz). */
  db: DbContext;
  can: (permission: Permission) => boolean;
};

/** Sessão válida e usuário ativo, ou null. */
export const getSessionUser = cache(async () => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session || session.user.status === false) return null;
  return session.user;
});

/**
 * Contexto completo do admin para a requisição atual (memorizado por requisição).
 * null = não logado, inativo ou sem nenhuma unidade.
 */
export const getAdminContext = cache(async (): Promise<AdminContext | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  const platformAdmin = user.isPlatformAdmin === true;

  const tenants: AdminTenant[] = platformAdmin
    ? (await listActiveTenants(getDb())).map((t) => ({ ...t, role: 'ADMIN' as const }))
    : (await withContext({ userId: user.id }, (tx) => listUserTenants(tx, user.id))).map((t) => ({
        id: t.tenantId,
        name: t.tenantName,
        kind: t.tenantKind,
        timezone: t.timezone,
        role: t.role,
      }));
  if (!tenants.length) return null;

  const chosen = (await cookies()).get(TENANT_COOKIE)?.value;
  const tenant = tenants.find((t) => t.id === chosen) ?? tenants[0]!;
  const meta = await requestMeta();

  return {
    user: { id: user.id, name: user.name, email: user.email, mustChangePassword: user.mustChangePassword === true },
    platformAdmin,
    tenant,
    tenants,
    db: { tenantId: tenant.id, userId: user.id, ...meta },
    can: (permission) => can({ role: tenant.role, platformAdmin }, permission),
  };
});

/**
 * Exige login (e, opcionalmente, uma permissão) numa página ou Server Action do admin.
 * Acesso negado é registrado na auditoria.
 */
export async function requireAdmin(permission?: Permission): Promise<AdminContext> {
  const ctx = await getAdminContext();
  if (!ctx) redirect('/admin/login');
  if (ctx.user.mustChangePassword) redirect('/admin/trocar-senha');
  if (permission && !ctx.can(permission)) {
    await logEvent(ctx.db, { action: 'PERMISSION_DENIED', entity: 'permission', details: { permission } });
    redirect('/admin/sem-permissao');
  }
  return ctx;
}
