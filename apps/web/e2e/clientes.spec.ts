import { expect, test } from '@playwright/test';
import { confirmDialog, loginGestor } from './helpers';

test('clientes: cadastra, impede telefone duplicado, edita, exclui e restaura', async ({ page }) => {
  await loginGestor(page);
  await page.goto('/admin/clientes/novo');
  await page.getByLabel('Nome').fill('Marina Duarte');
  await page.getByLabel('WhatsApp').fill('(62) 99123-4567');
  await page.getByLabel('Bairro').fill('Setor Marista');
  await page.getByRole('button', { name: 'Salvar cliente' }).click();
  await expect(page.getByRole('heading', { name: 'Marina Duarte' })).toBeVisible();
  await expect(page.getByText('Este cliente ainda não fez pedidos.')).toBeVisible();

  // Mesmo telefone em outro cadastro é recusado com mensagem clara.
  await page.goto('/admin/clientes/novo');
  await page.getByLabel('Nome').fill('Outra Pessoa');
  await page.getByLabel('WhatsApp').fill('62991234567');
  await page.getByRole('button', { name: 'Salvar cliente' }).click();
  await expect(page.getByText('O telefone (62) 99123-4567 já está cadastrado para Marina Duarte.')).toBeVisible();

  // Busca por telefone e edição
  await page.goto('/admin/clientes?q=91234');
  await page.getByRole('link', { name: 'Marina Duarte' }).click();
  await page.getByLabel('Observações').fill('Alérgica a camarão');
  await page.getByRole('button', { name: 'Salvar cliente' }).click();
  await expect(page.getByText('Cliente salvo.')).toBeVisible();

  await page.getByRole('button', { name: 'Excluir' }).click();
  await confirmDialog(page, 'Excluir cliente');
  await expect(page.getByText('Excluído', { exact: true })).toBeVisible();
  await page.goto('/admin/clientes?q=Marina');
  await expect(page.getByText('Nenhum cliente encontrado.')).toBeVisible();

  await page.goto('/admin/clientes?q=Marina&status=inativos');
  await page.getByRole('link', { name: 'Marina Duarte' }).click();
  await page.getByRole('button', { name: 'Restaurar' }).click();
  await confirmDialog(page, 'Restaurar cliente');
  await expect(page.getByText('Ativo', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Observações')).toHaveValue('Alérgica a camarão');
});
