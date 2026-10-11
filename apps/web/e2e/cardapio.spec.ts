import { expect, test } from '@playwright/test';
import { confirmDialog, loginGestor, openDb } from './helpers';

const db = openDb();
test.afterAll(() => db.end());

test('cardápio: cria, edita, exclui e restaura um sabor — e o site acompanha', async ({ page }) => {
  await loginGestor(page);
  await page.goto('/admin/cardapio');
  await expect(page.getByRole('link', { name: 'Uramaki Especial Salmão e Camarão' })).toBeVisible(); // sabores do seed

  // Criar
  await page.getByRole('link', { name: 'Novo sabor' }).click();
  await page.getByLabel('Nome do sabor').fill('Hot Roll Teste');
  await page.getByLabel('Descrição').fill('Empanado e crocante.');
  await page.getByLabel('Preço de venda (R$)').fill('55');
  await page.getByLabel('Custo (R$)').fill('22,00');
  await expect(page.getByText('R$ 33,00 (60%)')).toBeVisible(); // margem calculada na hora
  await page.getByRole('button', { name: 'Salvar sabor' }).click();
  await expect(page.getByRole('heading', { name: 'Hot Roll Teste' })).toBeVisible();

  // Validação no servidor sem perder o que foi digitado
  await page.getByLabel('Preço de venda (R$)').fill('abc');
  await page.getByRole('button', { name: 'Salvar sabor' }).click();
  await expect(page.getByText('Valor inválido (ex.: 50,00)')).toBeVisible();
  await expect(page.getByLabel('Descrição')).toHaveValue('Empanado e crocante.');

  // Editar
  await page.getByLabel('Preço de venda (R$)').fill('58,90');
  await page.getByRole('button', { name: 'Salvar sabor' }).click();
  await expect(page.getByText('Sabor salvo.')).toBeVisible();

  await page.goto('/');
  await expect(page.locator('#cardapio')).toContainText('Hot Roll Teste');
  await expect(page.locator('form.form')).toContainText('Hot Roll Teste · R$ 58,90');

  // Excluir (lógico) → some do site; restaurar → volta
  await page.goto('/admin/cardapio');
  await page.getByRole('link', { name: 'Hot Roll Teste' }).click();
  await page.getByRole('button', { name: 'Excluir' }).click();
  await confirmDialog(page, 'Excluir sabor');
  await expect(page.getByText('Excluído', { exact: true })).toBeVisible();
  await page.goto('/');
  await expect(page.locator('#cardapio')).not.toContainText('Hot Roll Teste');

  await page.goto('/admin/cardapio?status=inativos');
  await page.getByRole('link', { name: 'Hot Roll Teste' }).click();
  await page.getByRole('button', { name: 'Restaurar' }).click();
  await confirmDialog(page, 'Restaurar sabor');
  await expect(page.getByText('Ativo', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/admin-cardapio-sabor.png', fullPage: true });

  const { rows } = await db.query(
    `select action from audit_logs where entity = 'products'
       and entity_id = (select id::text from products where name = 'Hot Roll Teste') order by id`,
  );
  expect(rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE', 'SOFT_DELETE', 'RESTORE']);

  await page.goto('/admin/cardapio');
  await page.screenshot({ path: 'test-results/admin-cardapio-lista.png', fullPage: true });
});

// PNG 1×1 válido.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('foto do sabor: aceita imagem de verdade e recusa arquivo disfarçado', async ({ page }) => {
  await loginGestor(page);
  await page.goto('/admin/cardapio/novo');
  const upload = page.getByLabel('Enviar foto do sabor');

  await upload.setInputFiles({ name: 'foto.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('não sou uma imagem') });
  await expect(page.getByText('Formato não aceito: use JPG, PNG ou WebP.')).toBeVisible();

  await upload.setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByLabel('Imagem')).toHaveValue(/^\/uploads\/cardapio\/[0-9a-f-]+\/[0-9a-f-]+\.png$/);
  const { existsSync } = await import('node:fs');
  const path = await page.getByLabel('Imagem').inputValue();
  expect(existsSync(`public${path}`)).toBe(true);
});
