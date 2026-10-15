import { expect, test, type Page } from '@playwright/test';
import { loginGestor, openDb } from './helpers';

const db = openDb();
test.afterAll(() => db.end());
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ context }) => {
  await context.route('https://wa.me/**', (route) => route.fulfill({ status: 200, body: 'WhatsApp (simulado)' }));
});

async function createCoupon(page: Page, fill: (page: Page) => Promise<void>) {
  await loginGestor(page);
  await page.goto('/admin/cupons/novo');
  await fill(page);
  await page.getByRole('button', { name: 'Criar cupom' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

async function siteCart(page: Page, phone: string, tubes: number) {
  // Página nova a cada pedido (depois de enviar, o formulário vira a tela de "Pedido enviado").
  await page.goto(`/?carrinho=${Date.now()}#encomendas`);
  const form = page.locator('form.form');
  await form.getByLabel('Nome').fill('Cliente Cupom');
  await form.getByLabel('WhatsApp').fill(phone);
  await form.getByLabel('Bairro').fill('Setor Oeste');
  await form.getByLabel('Endereço').fill('Rua 9, 50');
  for (let i = 0; i < tubes; i++) await page.getByRole('button', { name: 'Adicionar Uramaki de Salmão e Manga' }).click();
  return form;
}

async function applyOnSite(page: Page, code: string) {
  const form = page.locator('form.form');
  await form.getByLabel('Cupom de desconto').fill(code);
  await form.getByRole('button', { name: 'Aplicar' }).click();
}

async function submitAndReadWhatsapp(page: Page) {
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Enviar pelo WhatsApp' }).click();
  const wa = await popup;
  await wa.waitForURL(/wa\.me/);
  return new URL(wa.url()).searchParams.get('text') ?? '';
}

test('cupom de porcentagem: cadastro com resumo, mínimo de tubos, desconto no pedido e no WhatsApp', async ({ page }) => {
  await createCoupon(page, async (p) => {
    await p.getByLabel('Código', { exact: true }).fill('zk10');
    await p.getByLabel('Desconto (%)').fill('10');
    await p.getByLabel('Pedido mínimo em tubos (opcional)').fill('3');
    await p.getByLabel('Limite de usos (opcional)').fill('50');
    await expect(p.getByTestId('coupon-summary')).toHaveText('10% de desconto nos produtos, a partir de 3 tubos, limitado a 50 usos.');
  });
  await expect(page.getByRole('heading', { name: 'ZK10' })).toBeVisible();

  await siteCart(page, '62 98777-0001', 2);
  await applyOnSite(page, 'zk10');
  await expect(page.getByRole('alert').filter({ hasText: 'Válido para pedidos a partir de 3 tubos.' })).toBeVisible();

  await page.getByRole('button', { name: 'Adicionar Uramaki de Salmão e Manga' }).click();
  await page.locator('form.form').getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Cupom aplicado: − R$ 15,00')).toBeVisible();
  await expect(page.locator('.lines__total')).toContainText('R$ 135,00');

  const text = await submitAndReadWhatsapp(page);
  expect(text).toContain('Cupom ZK10: − R$ 15,00');
  expect(text).toContain('Total estimado: R$ 135,00');

  const { rows } = await db.query(`select discount_cents, total_cents, coupon_code from orders where coupon_code = 'ZK10'`);
  expect(rows).toEqual([{ discount_cents: 1500, total_cents: 13500, coupon_code: 'ZK10' }]);

  await page.goto('/admin/cupons');
  await expect(page.getByRole('row', { name: /ZK10/ })).toContainText('1 / 50');
  await expect(page.getByRole('row', { name: /ZK10/ })).toContainText('Válido');
  await page.screenshot({ path: 'test-results/admin-cupons-lista.png', fullPage: true });
});

test('desligar pela chave da lista faz o site recusar o cupom', async ({ page }) => {
  await loginGestor(page);
  await page.goto('/admin/cupons');
  await page.getByRole('switch', { name: 'Cupom ZK10 ativo' }).click();
  await expect(page.getByText('Cupom ZK10 desativado')).toBeVisible();
  await expect(page.getByRole('row', { name: /ZK10/ })).toContainText('Desativado');

  await siteCart(page, '62 98777-0002', 3);
  await applyOnSite(page, 'ZK10');
  await expect(page.getByRole('alert').filter({ hasText: 'Cupom inválido.' })).toBeVisible();
});

test('cupom exclusivo: só o WhatsApp dono, uma única vez', async ({ page }) => {
  await createCoupon(page, async (p) => {
    await p.getByLabel('Código', { exact: true }).fill('ANA-VIP');
    await p.getByRole('radio', { name: /Valor em reais/ }).click();
    await p.getByLabel('Desconto (R$)').fill('20');
    await p.getByRole('switch', { name: 'Exclusivo para um cliente (uso único)' }).click();
    await p.getByLabel('WhatsApp do cliente').fill('(62) 98777-1111');
    await expect(p.getByTestId('coupon-summary')).toHaveText('R$ 20,00 de desconto nos produtos, exclusivo para (62) 98777-1111, uso único.');
    await expect(p.getByRole('switch', { name: 'Exclusivo para um cliente (uso único)' })).toHaveAttribute('aria-checked', 'true');
    await p.waitForTimeout(300); // fim da animação da chave, para a captura
    await p.screenshot({ path: 'test-results/admin-cupom-cadastro.png' });
  });

  await siteCart(page, '62 98777-2222', 1);
  await applyOnSite(page, 'ANA-VIP');
  await expect(page.getByRole('alert').filter({ hasText: 'Este cupom não é válido para este WhatsApp.' })).toBeVisible();

  await page.locator('form.form').getByLabel('WhatsApp').fill('62 98777-1111');
  await page.locator('form.form').getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Cupom aplicado: − R$ 20,00')).toBeVisible();
  expect(await submitAndReadWhatsapp(page)).toContain('Cupom ANA-VIP: − R$ 20,00');

  await siteCart(page, '62 98777-1111', 1);
  await applyOnSite(page, 'ANA-VIP');
  await expect(page.getByRole('alert').filter({ hasText: 'Este cupom já foi utilizado.' })).toBeVisible();
});

test('painel: aplica cupom ao lançar pedido e bloqueia o desconto manual', async ({ page }) => {
  await createCoupon(page, async (p) => {
    await p.getByLabel('Código', { exact: true }).fill('BALCAO15');
    await p.getByRole('radio', { name: /Valor em reais/ }).click();
    await p.getByLabel('Desconto (R$)').fill('15');
  });
  await page.goto('/admin/pedidos/novo');
  await page.getByLabel('Nome do cliente').fill('Cliente Balcão');
  await page.getByLabel('WhatsApp do cliente').fill('62 98777-3333');
  await page.getByLabel('Bairro').fill('Centro');
  await page.getByLabel('Endereço').fill('Rua 3, 30');
  await page.getByRole('button', { name: 'Adicionar Uramaki Especial Salmão e Camarão' }).click();
  await page.getByLabel('Cupom de desconto').fill('balcao15');
  await page.getByRole('button', { name: 'Aplicar cupom' }).click();
  await expect(page.getByText('Cupom BALCAO15 aplicado: − R$ 15,00')).toBeVisible();
  await expect(page.getByLabel('Desconto (R$)')).toBeDisabled();
  await expect(page.getByText('Total R$ 45,00')).toBeVisible();
  await page.getByRole('button', { name: 'Lançar pedido' }).click();

  await expect(page.getByRole('heading', { name: /^Pedido ZK-/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Desconto \(cupom BALCAO15\)/ })).toContainText('R$ 15,00');
});

test('tentar adivinhar códigos bloqueia o aparelho por alguns minutos', async ({ page }) => {
  await siteCart(page, '62 98777-4444', 1);
  for (let i = 0; i < 10; i++) {
    await applyOnSite(page, `CHUTE${i}`);
    await expect(page.getByRole('alert').filter({ hasText: /Cupom inválido|Muitas tentativas/ })).toBeVisible();
  }
  await applyOnSite(page, 'CHUTE-FINAL');
  await expect(page.getByRole('alert').filter({ hasText: 'Muitas tentativas de cupom.' })).toBeVisible();
});
