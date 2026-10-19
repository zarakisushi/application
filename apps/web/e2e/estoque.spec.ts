import { expect, test, type Page } from '@playwright/test';
import { confirmDialog, createAndLoginAs, loginGestor, openDb } from './helpers';

const db = openDb();
test.afterAll(() => db.end());
test.describe.configure({ mode: 'serial' });

/** Saldo do item na Matriz (soma das movimentações ativas). */
async function balance(name: string) {
  const { rows } = await db.query(
    `select coalesce(sum(m.qty), 0)::float8 as qty from stock_items i
       left join stock_movements m on m.item_id = i.id and m.status
      where i.name = $1 and i.status and i.tenant_id = (select id from tenants where kind = 'MATRIZ' and status) group by i.id`,
    [name],
  );
  return Number(rows[0]?.qty ?? 0);
}

async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test('estoque: lista com saldos, situação e alerta de reposição; aviso na página inicial', async ({ page }) => {
  await loginGestor(page);
  await expect(page.getByTestId('home-stock')).toContainText('precisa');
  await page.goto('/admin/estoque');
  await expect(page.getByRole('heading', { name: 'Estoque' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Tubo Push Pop/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Camarão/ })).toContainText('Abaixo do mínimo');
  await page.screenshot({ path: 'test-results/estoque-lista.png', fullPage: true });

  await choose(page, 'Nível do estoque', 'Abaixo do mínimo');
  await expect(page).toHaveURL(/situacao=repor/);
  await expect(page.getByRole('row', { name: /Tubo Push Pop/ })).toHaveCount(0);
});

test('compra: entra no estoque, atualiza o custo e vira conta a pagar no Financeiro por categoria', async ({ page }) => {
  await loginGestor(page);
  const salmao = await balance('Salmão');
  const panfleto = await balance('Panfleto');
  await page.goto('/admin/estoque/compras/nova');
  // Ao clicar, aparecem os fornecedores cadastrados; digitar filtra a lista.
  const supplier = page.getByRole('combobox', { name: 'Fornecedor' });
  await supplier.click();
  const listbox = page.getByRole('listbox', { name: 'Fornecedores' });
  await expect(listbox.getByRole('option', { name: /^Atacado Oriental Mercearia/ })).toBeVisible(); // cadastrado
  await expect(listbox.getByRole('option', { name: 'Atacado Oriental (demonstração)' })).toBeVisible(); // usado em compra
  await supplier.fill('peixa');
  await expect(listbox.getByRole('option')).toHaveCount(1);
  await listbox.getByRole('option', { name: /Peixaria Goiás/ }).click();
  await expect(supplier).toHaveValue('Peixaria Goiás');
  await expect(page.getByText(/Fornecedor cadastrado · Peixes e frutos do mar · Marcos/)).toBeVisible();
  const lines = page.getByTestId('purchase-line');
  await choose(page, 'Item 1', 'Salmão');
  await lines.nth(0).getByLabel(/Quantidade/).fill('2');
  await lines.nth(0).getByLabel('Valor da linha').fill('180');
  await page.getByRole('button', { name: 'Adicionar item' }).click();
  await choose(page, 'Item 2', 'Panfleto');
  await lines.nth(1).getByLabel(/Quantidade/).fill('1.000');
  await lines.nth(1).getByLabel('Valor da linha').fill('150');
  await expect(page.getByTestId('purchase-total')).toHaveText('R$ 330,00');
  await page.screenshot({ path: 'test-results/estoque-compra.png', fullPage: true });
  await page.getByRole('button', { name: 'Registrar compra' }).click();

  await expect(page.getByRole('heading', { name: 'Compra · Peixaria Goiás' })).toBeVisible();
  expect(await balance('Salmão')).toBeCloseTo(salmao + 2, 3);
  expect(await balance('Panfleto')).toBeCloseTo(panfleto + 1000, 3);

  // Uma conta por categoria: peixe em Insumos, panfleto em Marketing.
  const { rows } = await db.query(
    `select c.name, e.amount_cents, e.origin from finance_entries e join finance_categories c on c.id = e.category_id
      where e.counterparty = 'Peixaria Goiás' and e.origin = 'ESTOQUE' and e.status order by c.name`,
  );
  expect(rows).toEqual([
    { name: 'Insumos: peixes e frutos do mar', amount_cents: 18000, origin: 'ESTOQUE' },
    { name: 'Marketing', amount_cents: 15000, origin: 'ESTOQUE' },
  ]);
  await page.goto('/admin/financeiro/lancamentos?q=Peixaria+Goi%C3%A1s&periodo=tudo&origem=ESTOQUE');
  await expect(page.getByRole('row', { name: /Compra · Peixaria Goiás/ })).toHaveCount(2);
});

test('compra com fornecedor ainda não cadastrado: fica só o nome, com atalho para cadastrar depois', async ({ page }) => {
  await loginGestor(page);
  await page.goto('/admin/estoque/compras/nova');
  const supplier = page.getByRole('combobox', { name: 'Fornecedor' });
  await supplier.fill('Distribuidora Nova Era');
  await expect(page.getByRole('listbox', { name: 'Fornecedores' })).toHaveCount(0);
  const hint = page.getByTestId('supplier-not-registered');
  await expect(hint).toContainText('Ainda não cadastrado');
  await expect(hint.getByRole('link', { name: 'Cadastrar depois' })).toHaveAttribute('href', '/admin/fornecedores/novo?nome=Distribuidora%20Nova%20Era');
  await page.getByRole('combobox', { name: 'Item 1' }).click();
  await page.getByRole('option', { name: 'Gergelim', exact: true }).click();
  await page.getByTestId('purchase-line').nth(0).getByLabel(/Quantidade/).fill('1');
  await page.getByTestId('purchase-line').nth(0).getByLabel('Valor da linha').fill('38');
  await page.getByRole('button', { name: 'Registrar compra' }).click();
  await expect(page.getByRole('heading', { name: 'Compra · Distribuidora Nova Era' })).toBeVisible();

  // Depois, o cadastro abre com o nome já preenchido.
  await page.goto('/admin/fornecedores/novo?nome=Distribuidora%20Nova%20Era');
  await expect(page.getByLabel('Nome do fornecedor')).toHaveValue('Distribuidora Nova Era');
});

test('saída por perda e contagem ajustam o saldo', async ({ page }) => {
  await loginGestor(page);
  const before = await balance('Salmão');
  await page.goto('/admin/estoque');
  await page.getByRole('button', { name: 'Saída ou perda' }).click();
  await choose(page, 'Item', 'Salmão');
  await page.getByLabel(/Quantidade/).fill('0,5');
  await page.getByLabel('Observação (opcional)').fill('Sobrou do fim de semana');
  await page.getByRole('button', { name: 'Registrar', exact: true }).click();
  await expect(page.getByText('Saída registrada.')).toBeVisible();
  expect(await balance('Salmão')).toBeCloseTo(before - 0.5, 3);

  await page.goto('/admin/estoque/contagem');
  await page.getByLabel('Contado: Tubo Push Pop').fill('400');
  await expect(page.getByRole('row', { name: /Tubo Push Pop/ })).toContainText(/[+−] .* un|confere/);
  await page.screenshot({ path: 'test-results/estoque-contagem.png', fullPage: true });
  await page.getByRole('button', { name: /Registrar contagem \(1 item\)/ }).click();
  await expect(page.getByText(/Contagem registrada/)).toBeVisible();
  expect(await balance('Tubo Push Pop')).toBe(400);
});

test('ficha técnica no sabor e baixa automática quando o pedido é entregue', async ({ page }) => {
  await loginGestor(page);
  await page.goto('/admin/cardapio');
  await page.getByRole('link', { name: 'Uramaki de Salmão e Manga' }).click();
  await expect(page.getByText('Ficha técnica (1 tubo)')).toBeVisible();
  await expect(page.getByTestId('recipe-line')).not.toHaveCount(0);
  await expect(page.getByTestId('recipe-cost')).toHaveText(/R\$ \d+,\d{2}/);
  await page.screenshot({ path: 'test-results/estoque-ficha.png', fullPage: true });
  await page.getByRole('button', { name: 'Salvar ficha técnica' }).click();
  await expect(page.getByText(/Ficha técnica salva/)).toBeVisible();

  const tubes = await balance('Tubo Push Pop');
  await page.goto('/admin/pedidos/novo');
  await page.getByLabel('Nome do cliente').fill('Cliente Estoque');
  await page.getByLabel('WhatsApp do cliente').fill('62 98444-5566');
  await page.getByLabel('Bairro').fill('Centro');
  await page.getByLabel('Endereço').fill('Rua 1, 10');
  await page.getByRole('button', { name: 'Adicionar Uramaki de Salmão e Manga' }).click();
  await page.getByRole('button', { name: 'Adicionar Uramaki de Salmão e Manga' }).click();
  await page.getByRole('button', { name: 'Lançar pedido' }).click();
  await expect(page.getByRole('heading', { name: /^Pedido ZK-/ })).toBeVisible();
  await page.getByRole('combobox', { name: 'Mudar etapa' }).click();
  await page.getByRole('option', { name: 'Entregue' }).click();
  await page.getByRole('button', { name: 'Ainda não (só entregar)' }).click();
  await expect(page.getByText('Pedido entregue. O pagamento fica em "A receber".')).toBeVisible();
  expect(await balance('Tubo Push Pop')).toBe(tubes - 2);

  // Cancelar devolve ao estoque.
  await page.getByRole('button', { name: 'Cancelar pedido' }).click();
  await confirmDialog(page, 'Cancelar pedido', 'Teste do estoque');
  await expect(page.getByText('Pedido cancelado.')).toBeVisible();
  expect(await balance('Tubo Push Pop')).toBe(tubes);
});

test('atendente vê o estoque e registra perdas, mas não compra nem cadastra itens', async ({ page }) => {
  await createAndLoginAs(page, { name: 'Lia Atendente', email: 'lia.estoque@zaraki.test', role: 'Atendente' });
  await page.locator('[data-sidebar="menu-button"]', { hasText: 'Estoque' }).click();
  await expect(page.getByRole('button', { name: 'Saída ou perda' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Contagem' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Registrar compra' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Novo item' })).toHaveCount(0);
  await page.goto('/admin/estoque/compras/nova');
  await expect(page).toHaveURL(/sem-permissao/);
});
