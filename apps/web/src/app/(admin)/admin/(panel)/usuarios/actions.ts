'use server';

import { DomainError, userSchema } from '@zaraki/core';
import {
  addUserToTenant,
  getTenantUser,
  logEvent,
  resetUserPassword,
  setTenantUserStatus,
  updateTenantUser,
  withContext,
  type Tx,
} from '@zaraki/db';
import { hashPassword } from 'better-auth/crypto';
import { revalidatePath } from 'next/cache';
import { randomBytes } from 'node:crypto';
import { attempt, parseForm, type ActionResult } from '@/server/actions';
import { requireAdmin, type AdminContext } from '@/server/admin';

/** Senha provisória legível (12 caracteres), trocada obrigatoriamente no primeiro acesso. */
const temporaryPassword = () => randomBytes(9).toString('base64url');

/** O alvo precisa ter vínculo com a unidade ativa; administradores da rede só a Matriz altera. */
async function loadTarget(tx: Tx, ctx: AdminContext, userId: string) {
  const target = await getTenantUser(tx, ctx.tenant.id, userId);
  if (!target) throw new DomainError('Usuário não encontrado nesta unidade.');
  if (target.isPlatformAdmin && !ctx.platformAdmin) {
    throw new DomainError('Somente a Matriz pode alterar administradores da rede.');
  }
  return target;
}

function refresh(userId?: string) {
  revalidatePath('/admin/usuarios');
  if (userId) revalidatePath(`/admin/usuarios/${userId}`);
}

export async function createUserAction(form: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin('users:manage');
  const { data, result } = parseForm(userSchema, form);
  if (!data) return result;
  const password = temporaryPassword();
  const passwordHash = await hashPassword(password);

  return attempt(async () => {
    const added = await withContext(ctx.db, (tx) =>
      addUserToTenant(tx, ctx.tenant.id, { ...data, passwordHash, allowPlatformAdmin: ctx.platformAdmin }),
    );
    refresh();
    return added.created
      ? { ok: true, message: 'Usuário criado.', secret: password, id: added.userId }
      : { ok: true, message: 'Este e-mail já tinha cadastro: o acesso a esta unidade foi liberado.', redirectTo: `/admin/usuarios/${added.userId}` };
  });
}

export async function updateUserAction(userId: string, form: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin('users:manage');
  const { data, result } = parseForm(userSchema, form);
  if (!data) return result;

  return attempt(async () => {
    await withContext(ctx.db, async (tx) => {
      const target = await loadTarget(tx, ctx, userId);
      if (userId === ctx.user.id && (data.role !== target.role || (ctx.platformAdmin && !data.isPlatformAdmin))) {
        throw new DomainError('Você não pode alterar o próprio papel nem o próprio acesso à rede.');
      }
      await updateTenantUser(tx, ctx.tenant.id, userId, { ...data, allowPlatformAdmin: ctx.platformAdmin });
    });
    refresh(userId);
    return { ok: true, message: 'Usuário salvo.' };
  });
}

export async function setUserStatusAction(userId: string, status: boolean): Promise<ActionResult> {
  const ctx = await requireAdmin('users:manage');
  if (userId === ctx.user.id) return { error: 'Você não pode remover o próprio acesso.' };
  return attempt(async () => {
    await withContext(ctx.db, async (tx) => {
      await loadTarget(tx, ctx, userId);
      await setTenantUserStatus(tx, ctx.tenant.id, userId, status);
    });
    refresh(userId);
    return {
      ok: true,
      message: status ? 'Acesso devolvido.' : 'Acesso removido. As sessões abertas dessa pessoa foram encerradas.',
    };
  });
}

export async function resetPasswordAction(userId: string): Promise<ActionResult> {
  const ctx = await requireAdmin('users:manage');
  if (userId === ctx.user.id) return { error: 'Para a sua própria senha, use “Trocar senha” no menu do usuário.' };
  const password = temporaryPassword();
  const passwordHash = await hashPassword(password);

  return attempt(async () => {
    await withContext(ctx.db, async (tx) => {
      await loadTarget(tx, ctx, userId);
      await resetUserPassword(tx, userId, passwordHash);
    });
    await logEvent(ctx.db, { action: 'PASSWORD_RESET', entity: 'users', entityId: userId });
    refresh(userId);
    return { ok: true, secret: password };
  });
}
