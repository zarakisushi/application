import { expect, test } from '@playwright/test';
import { createAndLoginAs, loginGestor } from './helpers';

test('manual: abre pelo menu, navega pelo sumário e busca seções sem depender de acento', async ({ page }) => {
  await loginGestor(page);
  await page.locator('[data-sidebar="menu-button"]', { hasText: 'Manual do sistema' }).click();
  await expect(page.getByRole('heading', { name: 'Manual do sistema', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Visão geral do sistema', level: 2 })).toBeVisible();

  // Sumário: pula para o capítulo e mostra as seções dele.
  const toc = page.getByRole('navigation', { name: 'Sumário do manual' });
  await toc.getByRole('link', { name: /Estoque/ }).click();
  await expect(page).toHaveURL(/#estoque$/);
  await expect(page.getByRole('heading', { name: 'Estoque', level: 2 })).toBeInViewport();
  await expect(toc.getByRole('link', { name: 'Quem faz o quê' })).toBeVisible();
  await toc.getByRole('link', { name: 'Saídas, perdas e contagem' }).click();
  await expect(page).toHaveURL(/#estoque--saidas-perdas-e-contagem$/);
  await expect(page.getByRole('heading', { name: 'Saídas, perdas e contagem', level: 3 })).toBeInViewport();

  // Busca sem acento encontra "Conferência bancária"; Enter vai ao primeiro resultado.
  const search = page.getByRole('searchbox', { name: 'Buscar no manual' });
  await search.fill('conferencia bancaria');
  const results = page.getByRole('list', { name: 'Resultados da busca' });
  await expect(results.getByRole('link').first()).toContainText('Conferência bancária');
  await search.press('Enter');
  await expect(page).toHaveURL(/#financeiro--visao-geral-e-semaforo-de-saude$/);

  await search.fill('ficha técnica');
  await results.getByRole('link', { name: /Baixa automática pela ficha técnica/ }).click();
  await expect(page).toHaveURL(/#estoque--baixa-automatica-pela-ficha-tecnica$/);
  await expect(page.getByRole('heading', { name: 'Baixa automática pela ficha técnica' })).toBeInViewport();

  await search.fill('xyzqw');
  await expect(page.getByText('Nada encontrado para "xyzqw"')).toBeVisible();
  await page.getByRole('button', { name: 'Limpar busca' }).click();
  await expect(toc).toBeVisible();

  // Link direto para uma busca.
  await page.goto('/admin/manual?busca=royalties');
  await expect(results.getByRole('link').first()).toContainText(/Royalties/);
});

test('manual: PDF para abrir ou baixar e imagens só para quem está logado', async ({ page, browser }) => {
  await loginGestor(page);
  await page.goto('/admin/manual');
  await expect(page.getByRole('link', { name: 'Baixar PDF' })).toHaveAttribute('href', '/api/manual/pdf?download=1');

  const pdf = await page.request.get('/api/manual/pdf?download=1');
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect(pdf.headers()['content-disposition']).toContain('attachment');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  expect((await page.request.get('/api/manual/pdf')).headers()['content-disposition']).toContain('inline');

  const img = page.locator('.manual-doc img').first();
  await img.scrollIntoViewIfNeeded();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
  expect((await page.request.get('/api/manual/..%2Fmanual.html')).status()).toBe(404);

  const anon = await browser.newContext();
  expect((await anon.request.get(`${new URL(page.url()).origin}/api/manual/pdf`)).status()).toBe(401);
  await anon.close();
});

test('manual: disponível para todos os papéis, inclusive atendente', async ({ page }) => {
  await createAndLoginAs(page, { name: 'Rui Atendente', email: 'rui.manual@zaraki.test', role: 'Atendente' });
  await page.locator('[data-sidebar="menu-button"]', { hasText: 'Manual do sistema' }).click();
  await expect(page.getByRole('heading', { name: 'Manual do sistema', level: 1 })).toBeVisible();
});
