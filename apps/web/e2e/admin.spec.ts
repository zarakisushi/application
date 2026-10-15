import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

const db = new pg.Pool({ connectionString: process.env.E2E_OWNER_URL });
test.afterAll(() => db.end());
test.describe.configure({ mode: 'serial' });

const INITIAL = 'SenhaInicial123';
const NEW_PASSWORD = 'NovaSenha#2026';

async function login(page: Page, email: string, password: string) {
  await page.goto('/admin/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

async function firstAccess(page: Page, email: string) {
  await login(page, email, INITIAL);
  await expect(page).toHaveURL(/\/admin\/trocar-senha$/);
  await page.getByLabel('Senha atual').fill(INITIAL);
  await page.getByLabel('Nova senha', { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel('Confirme a nova senha').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Salvar nova senha' }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

async function auditCount(action: string, email: string) {
  const { rows } = await db.query(
    `select count(*)::int as n from audit_logs where action = $1 and (after ->> 'email' = $2 or actor_label = $2
       or actor_user_id = (select id from users where email = $2))`,
    [action, email],
  );
  return rows[0].n as number;
}

test('sem login, o admin redireciona para a tela de entrada', async ({ page }) => {
  await page.goto('/admin/pedidos');
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
});

test('senha errada é recusada e registrada na auditoria', async ({ page }) => {
  await login(page, 'admin@zaraki.test', 'senha-errada');
  await expect(page.getByRole('alert').filter({ hasText: 'inválidos' })).toHaveText('E-mail ou senha inválidos.');
  expect(await auditCount('LOGIN_FAILED', 'admin@zaraki.test')).toBe(1);
});

test('primeiro acesso exige troca de senha e leva às boas-vindas', async ({ page }) => {
  await login(page, 'admin@zaraki.test', INITIAL);
  await expect(page).toHaveURL(/\/admin\/trocar-senha$/);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/trocar-senha$/); // não escapa da troca obrigatória

  await page.getByLabel('Senha atual').fill(INITIAL);
  await page.getByLabel('Nova senha', { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel('Confirme a nova senha').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Salvar nova senha' }).click();

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Tiago!');
  await expect(page.getByText('Bem-vindo ao painel da')).toContainText('Zaraki Sushi — Matriz');
  await expect(page.getByText('Aguardando confirmação', { exact: true })).toBeVisible();

  expect(await auditCount('LOGIN', 'admin@zaraki.test')).toBe(1);
  expect(await auditCount('PASSWORD_CHANGED', 'admin@zaraki.test')).toBe(1);
  const { rows } = await db.query(`select must_change_password from users where email = 'admin@zaraki.test'`);
  expect(rows[0].must_change_password).toBe(false);
});

test('menu lateral alterna entre "ícones + textos" e "apenas ícones" e lembra a escolha', async ({ page }) => {
  await login(page, 'admin@zaraki.test', NEW_PASSWORD);
  await expect(page).toHaveURL(/\/admin$/);
  const sidebar = page.locator('[data-slot="sidebar"][data-state]');
  const menu = page.locator('[data-slot="sidebar"]').getByRole('link', { name: 'Pedidos', exact: true });

  await expect(sidebar).toHaveAttribute('data-state', 'expanded');
  await expect(menu).toContainText('Pedidos');
  await page.screenshot({ path: 'test-results/admin-menu-expandido.png', fullPage: true });

  await page.getByRole('button', { name: 'Mostrar apenas ícones' }).click();
  await expect(sidebar).toHaveAttribute('data-state', 'collapsed');
  await page.reload();
  await expect(sidebar).toHaveAttribute('data-state', 'collapsed');
  await menu.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Pedidos'); // no modo só ícones, o nome aparece no tooltip
  await page.screenshot({ path: 'test-results/admin-menu-icones.png', fullPage: true });

  await page.getByRole('button', { name: 'Mostrar textos do menu' }).click();
  await expect(sidebar).toHaveAttribute('data-state', 'expanded');
});

test('atendente não vê a gestão e é barrado ao acessar pela URL', async ({ page }) => {
  await firstAccess(page, 'atendente@zaraki.test');
  const nav = page.locator('[data-slot="sidebar"]');
  for (const visible of ['Início', 'Pedidos', 'Festas e eventos', 'Clientes', 'Cardápio']) {
    await expect(nav.getByRole('link', { name: visible })).toBeVisible();
  }
  for (const hidden of ['Relatórios', 'Usuários', 'Auditoria', 'Unidades']) {
    await expect(nav.getByRole('link', { name: hidden })).toHaveCount(0);
  }

  await page.goto('/admin/usuarios');
  await expect(page).toHaveURL(/\/admin\/sem-permissao$/);
  await expect(page.getByRole('heading', { name: 'Sem permissão' })).toBeVisible();
  expect(await auditCount('PERMISSION_DENIED', 'atendente@zaraki.test')).toBe(1);
});

test('usuário desativado (status = false) não consegue entrar', async ({ page }) => {
  await db.query(`update users set status = false where email = 'inativo@zaraki.test'`);
  await login(page, 'inativo@zaraki.test', INITIAL);
  await expect(page.getByRole('alert').filter({ hasText: 'inválidos' })).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/login$/);
});

test('sair encerra a sessão e fica registrado', async ({ page }) => {
  await login(page, 'admin@zaraki.test', NEW_PASSWORD);
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole('button', { name: 'Menu do usuário' }).click();
  await page.getByRole('menuitem', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login$/);
  expect(await auditCount('LOGOUT', 'admin@zaraki.test')).toBe(1);
});

test('após 5 senhas erradas, o e-mail é bloqueado por 15 minutos', async ({ page }) => {
  for (let i = 0; i < 5; i++) {
    await login(page, 'atendente@zaraki.test', `errada-${i}`);
    await expect(page.getByRole('alert').filter({ hasText: 'inválidos' })).toBeVisible();
  }
  // Mesmo com a senha certa, o acesso fica bloqueado.
  await login(page, 'atendente@zaraki.test', NEW_PASSWORD);
  await expect(page.getByRole('alert').filter({ hasText: 'Muitas tentativas' })).toBeVisible();
  expect(await auditCount('LOGIN_BLOCKED', 'atendente@zaraki.test')).toBe(1);
});
