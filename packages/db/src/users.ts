import { and, asc, count, eq, gt, sql } from 'drizzle-orm';
import type { Tx } from './client';
import { accounts, auditLogs, memberships, tenants, users } from './schema';

export type TenantAccess = {
  tenantId: string;
  tenantName: string;
  tenantKind: (typeof tenants.$inferSelect)['kind'];
  timezone: string;
  role: (typeof memberships.$inferSelect)['role'];
};

/** Unidades ativas às quais o usuário tem vínculo ativo (RLS: o usuário enxerga os próprios vínculos). */
export function listUserTenants(tx: Tx, userId: string): Promise<TenantAccess[]> {
  return tx
    .select({
      tenantId: tenants.id,
      tenantName: tenants.name,
      tenantKind: tenants.kind,
      timezone: tenants.timezone,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(and(eq(memberships.userId, userId), eq(memberships.status, true), eq(tenants.status, true)))
    .orderBy(asc(tenants.kind), asc(tenants.name));
}

/** Todas as unidades ativas, Matriz primeiro. */
export function listActiveTenants(tx: Pick<Tx, 'select'>) {
  return tx
    .select({ id: tenants.id, name: tenants.name, kind: tenants.kind, timezone: tenants.timezone })
    .from(tenants)
    .where(eq(tenants.status, true))
    .orderBy(asc(tenants.kind), asc(tenants.name));
}

/** Falhas de login para um e-mail na janela de tempo (eventos globais da auditoria; exige contexto da Matriz). */
export async function countRecentLoginFailures(tx: Tx, email: string, minutes: number) {
  const [row] = await tx
    .select({ n: count() })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.action, 'LOGIN_FAILED'),
        sql`${auditLogs.after} ->> 'email' = ${email.toLowerCase()}`,
        gt(auditLogs.createdAt, sql`now() - make_interval(mins => ${minutes})`),
      ),
    );
  return row?.n ?? 0;
}

/** Falhas de login vindas de um IP na janela de tempo (qualquer e-mail). */
export async function countRecentLoginFailuresFromIp(tx: Tx, ip: string, minutes: number) {
  const [row] = await tx
    .select({ n: count() })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.action, 'LOGIN_FAILED'),
        eq(auditLogs.ip, ip),
        gt(auditLogs.createdAt, sql`now() - make_interval(mins => ${minutes})`),
      ),
    );
  return row?.n ?? 0;
}

export type NewUser = {
  name: string;
  email: string;
  /** Hash já calculado pelo Better Auth (`hashPassword`). */
  passwordHash: string;
  isPlatformAdmin?: boolean;
  mustChangePassword?: boolean;
  memberships: { tenantId: string; role: TenantAccess['role'] }[];
};

/** Cria usuário com login por e-mail e senha e seus vínculos. Rode dentro de `withContext`. */
export async function createUserWithPassword(tx: Tx, input: NewUser) {
  const [user] = await tx
    .insert(users)
    .values({
      name: input.name,
      email: input.email.toLowerCase(),
      emailVerified: true,
      isPlatformAdmin: input.isPlatformAdmin ?? false,
      mustChangePassword: input.mustChangePassword ?? true,
    })
    .returning();
  await tx.insert(accounts).values({
    userId: user!.id,
    accountId: user!.id,
    providerId: 'credential',
    password: input.passwordHash,
  });
  if (input.memberships.length) {
    await tx.insert(memberships).values(input.memberships.map((m) => ({ ...m, userId: user!.id })));
  }
  return user!;
}

/** true se o usuário existe e está ativo (status = true). Tabela sem RLS: dispensa contexto. */
export async function isUserActive(db: Pick<Tx, 'select'>, userId: string) {
  const [user] = await db.select({ status: users.status }).from(users).where(eq(users.id, userId));
  return user?.status === true;
}

/** Marca que o usuário já definiu a própria senha. Rode dentro de `withContext`. */
export function clearMustChangePassword(tx: Tx, userId: string) {
  return tx.update(users).set({ mustChangePassword: false }).where(eq(users.id, userId));
}
