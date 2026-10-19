import { expect, test, type Page } from '@playwright/test';
import { confirmDialog, createAndLoginAs, loginGestor } from './helpers';

test.describe.configure({ mode: 'serial' });

const row = (page: Page, name: string) => page.getByTestId('supplier-row').filter({ has: page.getByRole('link', { name, exact: true }) });

async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test('grade com WhatsApp e ligação a um clique; busca por CNPJ e filtros', async ({ page }) => {
  await loginGestor(page);
  await page.locator('[data-sidebar="menu-button"]', { hasText: 'Fornecedores' }).click();
  await expect(page.getByRole('heading', { name: 'Fornecedores', level: 1 })).toBeVisible();

  const peixaria = row(page, 'Peixaria Goiás');
  const wa = peixaria.getByRole('link', { name: /Conversar no WhatsApp/ });
  await expect(wa).toHaveAttribute('href', /^https:\/\/wa\.me\/5562981234567\?text=/);
  await expect(wa).toHaveAttribute('target', '_blank');
  await expect(wa).toContainText('(62) 98123-4567');
  await expect(peixaria.getByRole('link', { name: /Ligar/ })).toHaveAttribute('href', 'tel:+556232410001');
  await expect(peixaria).toContainText('Compartilhado');

  await page.getByRole('textbox', { name: /Buscar por nome/ }).fill('12.345.678/0001-95');
  await page.getByRole('textbox', { name: /Buscar por nome/ }).press('Enter');
  await expect(page.getByTestId('supplier-row')).toHaveCount(1);
  await expect(row(page, 'Peixaria Goiás')).toBeVisible();

  await page.goto('/admin/fornecedores');
  await choose(page, 'Categoria', 'Embalagens');
  await expect(page).toHaveURL(/categoria=EMBALAGENS/);
  await expect(page.getByTestId('supplier-row')).toHaveCount(2);
  await expect(row(page, 'Atacado Oriental')).toBeVisible();
  await expect(row(page, 'Embalagens Cerrado')).toBeVisible();
  await choose(page, 'Dia de entrega', 'Entrega qua');
  await expect(page.getByTestId('supplier-row')).toHaveCount(1);
  await expect(row(page, 'Embalagens Cerrado')).toBeVisible();
});

test('cadastro completo com máscaras, validação, exclusão e restauração', async ({ page }) => {
  await loginGestor(page);
  await page.goto('/admin/fornecedores/novo');
  await page.getByLabel('Nome do fornecedor').fill('Laticínios Serra Dourada');
  await page.getByLabel('CNPJ (opcional)').fill('11222333000182');
  await expect(page.getByLabel('CNPJ (opcional)')).toHaveValue('11.222.333/0001-82');
  await page.getByRole('button', { name: 'Salvar fornecedor' }).click();
  await expect(page.getByText('CNPJ inválido')).toBeVisible();
  await expect(page.getByText('Informe ao menos um contato: WhatsApp, telefone ou e-mail')).toBeVisible();

  await page.getByLabel('CNPJ (opcional)').fill('11222333000181');
  await page.getByRole('group', { name: 'Categorias' }).getByRole('button', { name: 'Laticínios' }).click();
  await page.getByLabel('Nome do contato (vendedor)').fill('Patrícia');
  await page.getByLabel('WhatsApp').fill('62 99876-5432');
  await page.getByLabel('CEP').fill('74000-000');
  await page.getByLabel('Cidade').fill('Goiânia');
  await choose(page, 'UF', 'GO');
  await page.getByRole('group', { name: 'Dias de entrega' }).getByRole('button', { name: 'Ter' }).click();
  await page.getByRole('group', { name: 'Dias de entrega' }).getByRole('button', { name: 'Sex' }).click();
  await page.getByLabel('Pedido mínimo (R$)').fill('250');
  await page.getByRole('group', { name: 'Formas de pagamento' }).getByRole('button', { name: 'Pix' }).click();
  await page.getByRole('radio', { name: '4 estrelas' }).click();
  await page.getByRole('button', { name: 'Salvar fornecedor' }).click();

  await expect(page.getByRole('heading', { name: 'Laticínios Serra Dourada' })).toBeVisible();
  await expect(page.getByText('11.222.333/0001-81')).toBeVisible();
  await expect(page.getByLabel('Pedido mínimo (R$)')).toHaveValue('250,00');
  await expect(page.getByRole('group', { name: 'Dias de entrega' }).getByRole('button', { name: 'Sex' })).toHaveAttribute('aria-pressed', 'true');

  // Mesmo CNPJ não pode repetir na unidade.
  await page.goto('/admin/fornecedores/novo');
  await page.getByLabel('Nome do fornecedor').fill('Duplicado');
  await page.getByLabel('CNPJ (opcional)').fill('11222333000181');
  await page.getByLabel('E-mail (opcional)').fill('dup@teste.com');
  await page.getByRole('button', { name: 'Salvar fornecedor' }).click();
  await expect(page.getByText('Este CNPJ/CPF já está cadastrado: Laticínios Serra Dourada.')).toBeVisible();

  // Excluir e restaurar (Administrador).
  await page.goto('/admin/fornecedores?q=Serra+Dourada');
  await page.getByRole('link', { name: 'Laticínios Serra Dourada', exact: true }).click();
  await page.getByRole('button', { name: 'Excluir' }).click();
  await confirmDialog(page, 'Excluir fornecedor');
  await expect(page.getByText('Excluído', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Restaurar' }).click();
  await confirmDialog(page, 'Restaurar fornecedor');
  await expect(page.getByText('Ativo', { exact: true })).toBeVisible();
});

test('franquia vê os fornecedores da rede só para consulta e pode copiar', async ({ page }) => {
  await loginGestor(page);
  await page.goto('/admin/unidades/nova');
  await page.getByLabel('Nome da unidade').fill('Zaraki Sushi — Fornecedores Teste');
  await page.getByLabel('Cidade').fill('Goiânia');
  await page.getByLabel('Prefixo dos pedidos').fill('ZKF');
  await page.getByRole('button', { name: 'Criar unidade' }).click();
  await expect(page.getByRole('heading', { name: 'Zaraki Sushi — Fornecedores Teste' })).toBeVisible();

  await page.goto('/admin/fornecedores');
  await page.getByRole('button', { name: 'Trocar de unidade' }).click();
  await page.getByRole('menuitem', { name: /Fornecedores Teste/ }).click();
  await expect(page.getByRole('button', { name: 'Trocar de unidade' })).toContainText('Fornecedores Teste');

  // Só o compartilhado pela Matriz aparece, com o selo "Da rede".
  await expect(page.getByTestId('supplier-row')).toHaveCount(1);
  const peixaria = row(page, 'Peixaria Goiás');
  await expect(peixaria).toContainText('Da rede');
  await expect(peixaria.getByRole('link', { name: /Conversar no WhatsApp/ })).toHaveAttribute('href', /Fornecedores%20Teste/);

  await peixaria.getByRole('link', { name: 'Peixaria Goiás', exact: true }).click();
  await expect(page.getByText('Fornecedor indicado pela Matriz')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salvar fornecedor' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Copiar para meus fornecedores' }).click();
  await confirmDialog(page, 'Copiar');
  await expect(page.getByText('Fornecedor copiado para o seu cadastro.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salvar fornecedor' })).toBeVisible();
  await page.getByLabel('Observações').fill('Combinado: entrega às 9h.');
  await page.getByRole('button', { name: 'Salvar fornecedor' }).click();
  await expect(page.getByText('Fornecedor salvo.')).toBeVisible();

  await page.goto('/admin/fornecedores?origem=meus');
  await expect(page.getByTestId('supplier-row')).toHaveCount(1);
  await expect(row(page, 'Peixaria Goiás')).not.toContainText('Da rede');

  // De volta à Matriz e desativa a unidade de teste.
  await page.getByRole('button', { name: 'Trocar de unidade' }).click();
  await page.getByRole('menuitem', { name: /Matriz/ }).click();
  await expect(page.getByRole('button', { name: 'Trocar de unidade' })).toContainText('Matriz');
  await page.goto('/admin/unidades');
  await page.getByRole('link', { name: 'Zaraki Sushi — Fornecedores Teste' }).click();
  await page.getByRole('button', { name: 'Desativar' }).click();
  await confirmDialog(page, 'Desativar unidade');
});

test('atendente não acessa fornecedores', async ({ page }) => {
  await createAndLoginAs(page, { name: 'Bia Atendente', email: 'bia.fornecedores@zaraki.test', role: 'Atendente' });
  await expect(page.locator('[data-sidebar="menu-button"]', { hasText: 'Fornecedores' })).toHaveCount(0);
  await page.goto('/admin/fornecedores');
  await expect(page).toHaveURL(/sem-permissao/);
});
