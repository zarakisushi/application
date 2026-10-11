import { DomainError, type UserInput } from '@zaraki/core';
import { and, asc, desc, eq, ilike, ne, or } from 'drizzle-orm';
import type { Tx } from '../client';
import { accounts, memberships, sessions, users } from '../schema';
import { createUserWithPassword } from '../users';
import { contains, paging, statusWhere, toPage, type ListParams } from './common';

const tenantUserFields = {
  userId: users.id,
  name: users.name,
  email: users.email,
  role: memberships.role,
  status: memberships.status,
  userStatus: users.status,
  isPlatformAdmin: users.isPlatformAdmin,
  mustChangePassword: users.mustChangePassword,
  createdAt: memberships.createdAt,
};

/** Usuários com vínculo na unidade (o status listado é o do vínculo com a unidade). */
export async function listTenantUsers(tx: Tx, tenantId: string, params: ListParams) {
  const { page, pageSize, offset } = paging(params);
  const where = and(
    eq(memberships.tenantId, tenantId),
    statusWhere(memberships.status, params.status),
    params.q ? or(ilike(users.name, contains(params.q)), ilike(users.email, contains(params.q))) : undefined,
  );
  const query = tx
    .select(tenantUserFields)
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(where);
  // Equipes são pequenas: pagina em memória.
  const all = await query.orderBy(asc(users.name));
  return toPage(all.slice(offset, offset + pageSize), all.length, page, pageSize);
}

export async function getTenantUser(tx: Tx, tenantId: string, userId: string) {
  const [row] = await tx
    .select(tenantUserFields)
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
    .orderBy(desc(memberships.status)) // prefere o vínculo ativo
    .limit(1);
  return row ?? null;
}

async function assertEmailFree(tx: Tx, email: string, exceptUserId?: string) {
  const [other] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), exceptUserId ? ne(users.id, exceptUserId) : undefined));
  if (other) throw new DomainError('Já existe um usuário com este e-mail.');
}

export type AddUserResult = { userId: string; created: boolean };

/**
 * Dá acesso à unidade. Se o e-mail já existe (ex.: funcionário de outra unidade), apenas cria
 * ou reativa o vínculo; senão cria o usuário com a senha provisória informada.
 */
export async function addUserToTenant(
  tx: Tx,
  tenantId: string,
  input: UserInput & { passwordHash: string; allowPlatformAdmin: boolean },
): Promise<AddUserResult> {
  const [existing] = await tx.select().from(users).where(eq(users.email, input.email));
  if (!existing) {
    const user = await createUserWithPassword(tx, {
      name: input.name,
      email: input.email,
      passwordHash: input.passwordHash,
      isPlatformAdmin: input.allowPlatformAdmin && input.isPlatformAdmin,
      mustChangePassword: true,
      memberships: [{ tenantId, role: input.role }],
    });
    return { userId: user.id, created: true };
  }

  const [membership] = await tx
    .select()
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, existing.id)))
    .orderBy(asc(memberships.status))
    .limit(1);
  const [active] = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, existing.id), eq(memberships.status, true)));
  if (active) throw new DomainError('Este e-mail já tem acesso a esta unidade.');

  if (membership) {
    await tx.update(memberships).set({ status: true, role: input.role }).where(eq(memberships.id, membership.id));
  } else {
    await tx.insert(memberships).values({ tenantId, userId: existing.id, role: input.role });
  }
  if (!existing.status) await tx.update(users).set({ status: true }).where(eq(users.id, existing.id));
  return { userId: existing.id, created: false };
}

export async function updateTenantUser(
  tx: Tx,
  tenantId: string,
  userId: string,
  input: UserInput & { allowPlatformAdmin: boolean },
) {
  await assertEmailFree(tx, input.email, userId);
  await tx
    .update(users)
    .set({
      name: input.name,
      email: input.email,
      ...(input.allowPlatformAdmin ? { isPlatformAdmin: input.isPlatformAdmin } : {}),
    })
    .where(eq(users.id, userId));
  await tx
    .update(memberships)
    .set({ role: input.role })
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId), eq(memberships.status, true)));
}

/** Encerra todas as sessões abertas do usuário (exclusão física permitida: tabela técnica). */
export function revokeUserSessions(tx: Tx, userId: string) {
  return tx.delete(sessions).where(eq(sessions.userId, userId));
}

/**
 * Remove (ou devolve) o acesso do usuário à unidade. Sem nenhum vínculo ativo restante,
 * o usuário inteiro fica inativo e suas sessões são encerradas.
 */
export async function setTenantUserStatus(tx: Tx, tenantId: string, userId: string, status: boolean) {
  const [membership] = await tx
    .select()
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
    .orderBy(asc(memberships.status))
    .limit(1);
  if (!membership) throw new DomainError('Usuário não encontrado nesta unidade.');
  if (membership.status === status) return;

  await tx.update(memberships).set({ status }).where(eq(memberships.id, membership.id));
  if (status) {
    await tx.update(users).set({ status: true }).where(eq(users.id, userId));
    return;
  }
  const [user] = await tx.select().from(users).where(eq(users.id, userId));
  const remaining = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.status, true)));
  if (!remaining.length && !user?.isPlatformAdmin) {
    await tx.update(users).set({ status: false }).where(eq(users.id, userId));
  }
  await revokeUserSessions(tx, userId);
}

/** Define uma senha provisória, obriga a troca no próximo acesso e encerra as sessões. */
export async function resetUserPassword(tx: Tx, userId: string, passwordHash: string) {
  await tx
    .update(accounts)
    .set({ password: passwordHash, updatedAt: new Date() })
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential')));
  await tx.update(users).set({ mustChangePassword: true }).where(eq(users.id, userId));
  await revokeUserSessions(tx, userId);
}
