import { expect, test } from '@playwright/test';
import { confirmDialog, loginGestor } from './helpers';

test('unidades: cria franqueado com o cardápio da Matriz, alterna no seletor e desativa', async ({ page }) => {
  await loginGestor(page);
  await page.goto('/admin/unidades');
  await page.getByRole('link', { name: 'Zaraki Sushi — Matriz', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Desativar' })).toHaveCount(0); // a Matriz não pode ser desativada

  await page.goto('/admin/unidades/nova');
  await page.getByLabel('Nome da unidade').fill('Zaraki Sushi — Setor Bueno');
  await expect(page.getByLabel('Identificador')).toHaveValue('setor-bueno');
  await page.getByLabel('Cidade').fill('Goiânia');
  await page.getByLabel('Prefixo dos pedidos').fill('ZKB');
  await page.getByLabel('Royalties (%)').fill('6,5');
  await page.getByRole('button', { name: 'Criar unidade' }).click();
  await expect(page.getByRole('heading', { name: 'Zaraki Sushi — Setor Bueno' })).toBeVisible();

  // Seletor de unidade: troca para o franqueado e vê o cardápio copiado.
  await page.getByRole('button', { name: 'Trocar de unidade' }).click();
  await page.getByRole('menuitem', { name: /Setor Bueno/ }).click();
  await expect(page.getByRole('button', { name: 'Trocar de unidade' })).toContainText('Setor Bueno');
  await page.goto('/admin/cardapio');
  await expect(page.getByRole('link', { name: 'Uramaki Especial Salmão e Camarão' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Hot Roll Teste' })).toBeVisible(); // criado no teste do cardápio da Matriz

  // Pedidos da Matriz não aparecem no franqueado.
  await page.goto('/admin/pedidos?status=todos');
  await expect(page.getByText('Nenhum pedido neste filtro.')).toBeVisible();

  await page.goto('/admin/unidades?q=Bueno');
  await page.getByRole('link', { name: 'Zaraki Sushi — Setor Bueno', exact: true }).click();
  await page.getByRole('button', { name: 'Desativar' }).click();
  await confirmDialog(page, 'Desativar unidade');
  await expect(page.getByText('Excluído', { exact: true })).toBeVisible();
  await page.goto('/admin');
  await expect(page.getByRole('button', { name: 'Trocar de unidade' })).toHaveCount(0); // só restou a Matriz
});
