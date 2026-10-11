import { expect, test } from '@playwright/test';
import { confirmDialog, login, loginGestor } from './helpers';

test.describe.configure({ mode: 'serial' });

let tempPassword = '';
const EMAIL = 'novo.gerente@zaraki.test';

test('cria usuário com senha provisória que exige troca no primeiro acesso', async ({ page, browser }) => {
  await loginGestor(page);
  await page.goto('/admin/usuarios/novo');
  await page.getByLabel('Nome').fill('Paulo Gerente');
  await page.getByLabel('E-mail (login)').fill(EMAIL);
  await page.getByRole('combobox', { name: 'Papel nesta unidade' }).click();
  await page.getByRole('option', { name: /^Gerente/ }).click();
  await page.getByRole('button', { name: 'Criar usuário' }).click();

  tempPassword = (await page.getByTestId('secret').textContent())!.trim();
  expect(tempPassword).toHaveLength(12);

  const other = await browser.newPage();
  await login(other, EMAIL, tempPassword);
  await expect(other).toHaveURL(/\/admin\/trocar-senha$/);
  await other.close();

  await page.goto('/admin/usuarios');
  await expect(page.getByRole('row', { name: /Paulo Gerente/ })).toContainText('Aguardando 1º acesso');
});

test('não deixa o usuário alterar o próprio papel nem remover o próprio acesso', async ({ page }) => {
  await loginGestor(page);
  await page.goto('/admin/usuarios');
  await page.getByRole('link', { name: 'Gestora Matriz' }).click();
  await expect(page.getByRole('combobox', { name: 'Papel nesta unidade' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Remover acesso' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Redefinir senha' })).toHaveCount(0);
});

test('remover acesso bloqueia o login; redefinir senha gera nova senha provisória', async ({ page, browser }) => {
  await loginGestor(page);
  await page.goto(`/admin/usuarios?q=${EMAIL}`);
  await page.getByRole('link', { name: 'Paulo Gerente' }).click();

  await page.getByRole('button', { name: 'Remover acesso' }).click();
  await confirmDialog(page, 'Remover acesso');
  await expect(page.getByText('Excluído', { exact: true })).toBeVisible();

  const other = await browser.newPage();
  await login(other, EMAIL, tempPassword);
  await expect(other.getByRole('alert').filter({ hasText: 'inválidos' })).toBeVisible();

  await page.getByRole('button', { name: 'Devolver acesso' }).click();
  await confirmDialog(page, 'Devolver acesso');
  await expect(page.getByText('Ativo', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Redefinir senha' }).click();
  await confirmDialog(page, 'Gerar senha provisória');
  const newPassword = (await page.getByTestId('secret').textContent())!.trim();
  expect(newPassword).not.toBe(tempPassword);

  await login(other, EMAIL, newPassword);
  await expect(other).toHaveURL(/\/admin\/trocar-senha$/);
  await other.close();
});
