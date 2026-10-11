import { expect, test } from '@playwright/test';
import { createAndLoginAs, loginGestor, openDb } from './helpers';

const db = openDb();
test.afterAll(() => db.end());

test('dashboard mostra indicadores do mês e gráficos', async ({ page }) => {
  await loginGestor(page);
  await expect(page.getByRole('heading', { name: 'Indicadores do mês' })).toBeVisible();
  for (const label of ['Faturamento', 'Pedidos entregues', 'Ticket médio', 'Clientes novos']) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await expect(page.locator('.recharts-surface').first()).toBeVisible();
  await expect(page.getByText('Próximas encomendas e festas')).toBeVisible();
  await page.screenshot({ path: 'test-results/admin-dashboard.png', fullPage: true });

  await page.getByRole('link', { name: 'Ver toda a rede' }).click();
  await expect(page.getByText(/Todas as unidades · mês até hoje/)).toBeVisible();
});

test('relatório de faturamento: filtros, rede e exportação CSV auditada', async ({ page }) => {
  await loginGestor(page);
  await page.goto('/admin/relatorios');
  for (const group of ['Vendas', 'Cardápio', 'Clientes', 'Operação', 'Franquia', 'Governança']) {
    await expect(page.getByRole('heading', { name: group, exact: true })).toBeVisible();
  }

  await page.getByRole('link', { name: /^Faturamento/ }).click();
  await expect(page.getByRole('heading', { name: 'Faturamento', exact: true })).toBeVisible();
  await expect(page.getByText('Carteira (encomendas futuras)')).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(31); // cabeçalho + 30 dias
  await page.screenshot({ path: 'test-results/admin-relatorio-faturamento.png', fullPage: true });

  await page.getByRole('combobox', { name: 'Período' }).click();
  await page.getByRole('option', { name: 'Últimos 90 dias' }).click();
  await expect(page).toHaveURL(/periodo=90d/);
  await expect(page.getByRole('columnheader', { name: 'Semana de' })).toBeVisible(); // agrupado por semana

  await page.getByRole('combobox', { name: 'Unidade' }).click();
  await page.getByRole('option', { name: 'Todas as unidades' }).click();
  await expect(page).toHaveURL(/unidade=todas/);
  await expect(page.getByText(/· Todas as unidades$/)).toBeVisible();

  const href = await page.getByRole('link', { name: 'Exportar CSV' }).getAttribute('href');
  const csv = await page.request.get(href!);
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-type']).toContain('text/csv');
  const body = await csv.text();
  expect(body.startsWith('﻿Semana de;Pedidos entregues;Faturamento;Ticket médio')).toBe(true);

  const { rows } = await db.query(`select after from audit_logs where action = 'EXPORT' and entity_id = 'faturamento' order by id desc limit 1`);
  expect(rows[0].after).toMatchObject({ report: 'Faturamento', scope: 'Todas as unidades' });
});

test('mapa de calor, previsão de produção e RFM renderizam com dados', async ({ page }) => {
  await loginGestor(page);
  await page.goto('/admin/relatorios/dias-e-horarios?periodo=90d');
  await expect(page.getByLabel(/^Sexta, 19h: \d+ pedidos$/)).toBeVisible();
  await page.screenshot({ path: 'test-results/admin-relatorio-horarios.png', fullPage: true });

  await page.goto('/admin/relatorios/previsao-producao?dias=30');
  await expect(page.getByText('Tubos a produzir')).toBeVisible();

  await page.goto('/admin/relatorios/rfm');
  await expect(page.getByRole('columnheader', { name: 'Segmento' })).toBeVisible();
  await expect(page.getByRole('row').nth(1)).toBeVisible();
});

test('gerente vê relatórios da unidade, mas não os da rede nem os de governança', async ({ page }) => {
  await createAndLoginAs(page, { name: 'Gerente Relatórios', email: 'gerente.relatorios@zaraki.test', role: 'Gerente' });
  await page.goto('/admin/relatorios');
  await expect(page.getByRole('heading', { name: 'Vendas', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Franquia', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Governança', exact: true })).toHaveCount(0);

  await page.goto('/admin/relatorios/royalties');
  await expect(page).toHaveURL(/\/admin\/sem-permissao$/);
  const csv = await page.request.get('/api/reports/royalties');
  expect(csv.status()).toBe(403);
  await expect(page.getByRole('combobox', { name: 'Unidade' })).toHaveCount(0);
});
