import { expect, test } from '@playwright/test';
import { createAndLoginAs, loginGestor, openDb } from './helpers';

const db = openDb();
test.afterAll(() => db.end());
test.describe.configure({ mode: 'serial' });

test('alteração de preço aparece na auditoria com antes e depois, e na aba Histórico do sabor', async ({ page }) => {
  await loginGestor(page);
  await page.goto('/admin/cardapio/novo');
  await page.getByLabel('Nome do sabor').fill('Joe Auditoria');
  await page.getByLabel('Preço de venda (R$)').fill('55');
  await page.getByRole('button', { name: 'Salvar sabor' }).click();
  await expect(page.getByRole('heading', { name: 'Joe Auditoria' })).toBeVisible();
  await page.getByLabel('Preço de venda (R$)').fill('57,50');
  await page.getByRole('button', { name: 'Salvar sabor' }).click();
  await expect(page.getByText('Sabor salvo.')).toBeVisible();

  // Aba Histórico na própria ficha
  await page.getByRole('tab', { name: 'Histórico' }).click();
  const history = page.getByRole('tabpanel');
  await expect(history.getByText('Criação')).toBeVisible();
  await expect(history.getByText('Alteração')).toBeVisible();
  await expect(history.getByRole('cell', { name: 'R$ 57,50' })).toBeVisible();

  // Tela de auditoria filtrada por tipo de registro
  await page.goto('/admin/auditoria?registro=products&acao=UPDATE');
  const row = page.getByRole('row', { name: /Joe Auditoria/ });
  await expect(row).toContainText('Gestora Matriz');
  await expect(row).toContainText('Preço');
  await row.getByRole('link', { name: 'Detalhes' }).click();

  await expect(page.getByRole('heading', { name: /^Registro #\d+$/ })).toBeVisible();
  const priceRow = page.getByRole('row', { name: /Preço/ });
  await expect(priceRow).toContainText('R$ 55,00');
  await expect(priceRow).toContainText('R$ 57,50');
  await page.screenshot({ path: 'test-results/admin-auditoria-detalhe.png', fullPage: true });
});

test('histórico do pedido mostra itens e mudanças de etapa', async ({ page }) => {
  await loginGestor(page);
  await page.goto('/admin/pedidos/novo');
  await page.getByLabel('Nome do cliente').fill('Cliente Histórico');
  await page.getByLabel('WhatsApp do cliente').fill('62 98000-4545');
  await page.getByLabel('Bairro').fill('Centro');
  await page.getByLabel('Endereço').fill('Av. Anhanguera, 10');
  await page.getByRole('button', { name: 'Adicionar Uramaki de Salmão e Manga' }).click();
  await page.getByRole('button', { name: 'Lançar pedido' }).click();
  await page.getByRole('button', { name: 'Avançar para “Confirmado”' }).click();
  await expect(page.getByRole('button', { name: 'Avançar para “Em preparo”' })).toBeVisible();

  await page.getByRole('tab', { name: 'Histórico' }).click();
  await expect(page.getByRole('tabpanel').getByText('Item do pedido').first()).toBeVisible();
  await expect(page.getByRole('tabpanel').getByText('Etapa do pedido').first()).toBeVisible();
});

test('a Matriz vê os logins da rede; a verificação de integridade passa', async ({ page }) => {
  await loginGestor(page);
  await page.goto('/admin/auditoria?escopo=rede&acao=LOGIN');
  await expect(page.getByRole('row', { name: /Gestora Matriz/ }).first()).toContainText('Login');

  await page.goto('/admin/auditoria');
  await page.getByRole('button', { name: 'Verificar integridade' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Trilha íntegra' })).toBeVisible();
  await page.screenshot({ path: 'test-results/admin-auditoria-lista.png', fullPage: true });
});

test('adulteração feita direto no banco é apontada no registro exato', async ({ page }) => {
  // Simula alguém com acesso de dono do banco desligando a proteção para "maquiar" um preço.
  const { rows } = await db.query(
    `select id, after from audit_logs where entity = 'products' and action = 'UPDATE'
       and after ->> 'name' = 'Joe Auditoria' order by id desc limit 1`,
  );
  const { id, after } = rows[0];
  await db.query('alter table audit_logs disable trigger audit_logs_immutable');
  await db.query(`update audit_logs set after = jsonb_set(after, '{price_cents}', '9999') where id = $1`, [id]);
  await db.query('alter table audit_logs enable trigger audit_logs_immutable');

  try {
    await loginGestor(page);
    await page.goto('/admin/auditoria');
    await page.getByRole('button', { name: 'Verificar integridade' }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'Inconsistência' });
    await expect(alert).toContainText(`registro #${id}`);
  } finally {
    // Desfaz a adulteração para não afetar os outros testes.
    await db.query('alter table audit_logs disable trigger audit_logs_immutable');
    await db.query('update audit_logs set after = $2 where id = $1', [id, after]);
    await db.query('alter table audit_logs enable trigger audit_logs_immutable');
  }
});

test('atendente não acessa a auditoria nem vê a aba Histórico', async ({ page }) => {
  await createAndLoginAs(page, { name: 'Atendente Auditoria', email: 'atendente.auditoria@zaraki.test' });

  await page.goto('/admin/auditoria');
  await expect(page).toHaveURL(/\/admin\/sem-permissao$/);

  await page.goto('/admin/clientes/novo');
  await page.getByLabel('Nome').fill('Cliente do Atendente');
  await page.getByLabel('WhatsApp').fill('62 98000-6767');
  await page.getByRole('button', { name: 'Salvar cliente' }).click();
  await expect(page.getByRole('heading', { name: 'Cliente do Atendente' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Histórico' })).toHaveCount(0);
});
