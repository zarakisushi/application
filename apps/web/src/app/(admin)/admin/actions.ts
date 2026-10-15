'use server';

import {
  clearMustChangePassword,
  countRecentLoginFailures,
  countRecentLoginFailuresFromIp,
  logEvent,
  withContext,
} from '@zaraki/db';
import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAdminContext, getSessionUser, requireAdmin, TENANT_COOKIE } from '@/server/admin';
import { getAuth } from '@/server/auth';
import { requestMeta } from '@/server/request';

export type FormState = { error?: string } | undefined;

/** Bloqueio após falhas seguidas de login: por e-mail e por IP (tentativas em vários e-mails). */
const LOCKOUT = { max: 5, maxPerIp: 20, minutes: 15 };

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const password = String(form.get('password') ?? '');
  if (!email || !password) return { error: 'Informe e-mail e senha.' };

  const meta = await requestMeta();
  const anonymous = { actorLabel: email, ...meta };

  // Falhas de login são eventos globais (sem unidade): só o contexto da Matriz as lê.
  const [failures, ipFailures] = await withContext({ ...anonymous, platformAdmin: true }, async (tx) => [
    await countRecentLoginFailures(tx, email, LOCKOUT.minutes),
    meta.ip ? await countRecentLoginFailuresFromIp(tx, meta.ip, LOCKOUT.minutes) : 0,
  ]);
  if (failures >= LOCKOUT.max || ipFailures >= LOCKOUT.maxPerIp) {
    await logEvent(anonymous, { action: 'LOGIN_BLOCKED', entity: 'users', details: { email } });
    return {
      error: `Muitas tentativas sem sucesso. Aguarde ${LOCKOUT.minutes} minutos ou peça ao administrador para redefinir sua senha.`,
    };
  }

  let userId: string;
  try {
    const result = await getAuth().api.signInEmail({ body: { email, password }, headers: await headers() });
    userId = result.user.id;
  } catch {
    await logEvent(anonymous, { action: 'LOGIN_FAILED', entity: 'users', details: { email } });
    return { error: 'E-mail ou senha inválidos.' };
  }

  await logEvent({ ...anonymous, userId }, { action: 'LOGIN', entity: 'users', entityId: userId, details: { email } });
  redirect('/admin');
}

export async function logout() {
  const ctx = await getAdminContext();
  await getAuth().api.signOut({ headers: await headers() });
  if (ctx) {
    await logEvent({ ...ctx.db, tenantId: null }, { action: 'LOGOUT', entity: 'users', entityId: ctx.user.id });
  }
  redirect('/admin/login');
}

export async function changePassword(_: FormState, form: FormData): Promise<FormState> {
  const user = await getSessionUser();
  if (!user) redirect('/admin/login');

  const currentPassword = String(form.get('currentPassword') ?? '');
  const newPassword = String(form.get('newPassword') ?? '');
  const confirm = String(form.get('confirm') ?? '');
  if (newPassword.length < 8) return { error: 'A nova senha precisa ter pelo menos 8 caracteres.' };
  if (newPassword !== confirm) return { error: 'A confirmação não confere com a nova senha.' };
  if (newPassword === currentPassword) return { error: 'A nova senha precisa ser diferente da atual.' };

  try {
    await getAuth().api.changePassword({
      body: { currentPassword, newPassword, revokeOtherSessions: true },
      headers: await headers(),
    });
  } catch {
    return { error: 'Senha atual incorreta.' };
  }

  const ctx = { userId: user.id, ...(await requestMeta()) };
  await withContext(ctx, (tx) => clearMustChangePassword(tx, user.id));
  await logEvent(ctx, { action: 'PASSWORD_CHANGED', entity: 'users', entityId: user.id });
  redirect('/admin');
}

export async function switchTenant(tenantId: string) {
  const ctx = await requireAdmin();
  if (!ctx.tenants.some((t) => t.id === tenantId)) return;
  (await cookies()).set(TENANT_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/admin',
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath('/admin', 'layout');
}
