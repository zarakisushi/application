import { expect, type Page } from '@playwright/test';
import pg from 'pg';

/** Banco de teste com o papel dono, para conferir o que foi gravado. */
export const openDb = () => new pg.Pool({ connectionString: process.env.E2E_OWNER_URL });

export const GESTOR = { email: 'gestor@zaraki.test', password: 'SenhaInicial123' };

export async function login(page: Page, email: string, password: string) {
  await page.goto('/admin/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

/** Entra como a gestora da Matriz (sem troca de senha pendente). */
export async function loginGestor(page: Page) {
  await login(page, GESTOR.email, GESTOR.password);
  await expect(page).toHaveURL(/\/admin$/);
}

/** Confirma a ação no diálogo de confirmação aberto. */
export async function confirmDialog(page: Page, confirmLabel: string, reason?: string) {
  const dialog = page.getByRole('alertdialog');
  if (reason) await dialog.getByRole('textbox').fill(reason);
  await dialog.getByRole('button', { name: confirmLabel }).click();
}

/** Recarrega a página até o texto aparecer (para efeitos assíncronos, como a sincronização da agenda). */
export async function expectEventually(page: Page, text: string, timeout = 15_000) {
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(text, { exact: true }).first()).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout });
}

/**
 * Cria um usuário pelo painel (logado como a gestora da Matriz) e faz o primeiro acesso dele,
 * trocando a senha provisória. Termina logado como o novo usuário.
 */
export async function createAndLoginAs(page: Page, user: { name: string; email: string; role?: 'Gerente' | 'Atendente' | 'Administrador' }) {
  await loginGestor(page);
  await page.goto('/admin/usuarios/novo');
  await page.getByLabel('Nome').fill(user.name);
  await page.getByLabel('E-mail (login)').fill(user.email);
  if (user.role) {
    await page.getByRole('combobox', { name: 'Papel nesta unidade' }).click();
    await page.getByRole('option', { name: new RegExp(`^${user.role}`) }).click();
  }
  await page.getByRole('button', { name: 'Criar usuário' }).click();
  const temp = (await page.getByTestId('secret').textContent())!.trim();
  await page.context().clearCookies();

  await login(page, user.email, temp);
  await page.getByLabel('Senha atual').fill(temp);
  await page.getByLabel('Nova senha', { exact: true }).fill('SenhaNova#2026');
  await page.getByLabel('Confirme a nova senha').fill('SenhaNova#2026');
  await page.getByRole('button', { name: 'Salvar nova senha' }).click();
  await expect(page).toHaveURL(/\/admin$/);
}
