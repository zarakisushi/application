import { expect, test } from '@playwright/test';
import { confirmDialog, expectEventually, loginGestor, openDb } from './helpers';

const db = openDb();
test.afterAll(() => db.end());

test('cancelar uma festa tira o evento da agenda; o selo some da ficha', async ({ page }) => {
  await loginGestor(page);
  await page.goto('/admin/encomendas/novo');
  await page.getByLabel('Nome do cliente').fill('Teresa Agenda');
  await page.getByLabel('WhatsApp do cliente').fill('62 98111-2233');
  const date = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel('Data').fill(date);
  await page.getByLabel('Horário').fill('18:00');
  await page.getByRole('button', { name: 'Adicionar Uramaki de Salmão e Manga' }).click();
  await page.getByRole('button', { name: 'Lançar pedido' }).click();
  await expect(page).toHaveURL(/\/admin\/encomendas\/[0-9a-f-]+$/);
  await expectEventually(page, 'Na agenda');

  await page.getByRole('button', { name: 'Cancelar pedido' }).click();
  await confirmDialog(page, 'Cancelar pedido', 'Data remarcada pelo cliente');
  await expect
    .poll(async () => {
      const { rows } = await db.query(
        `select o.calendar_sync_state, o.google_event_id from orders o join customers c on c.id = o.customer_id
          where c.phone = '+5562981112233'`,
      );
      return rows[0];
    }, { timeout: 15_000 })
    .toEqual({ calendar_sync_state: 'NAO_APLICA', google_event_id: null });
});

test('rota do cron exige o segredo e processa a fila', async ({ request }) => {
  expect((await request.get('/api/cron/calendar')).status()).toBe(401);
  expect((await request.get('/api/cron/calendar', { headers: { authorization: 'Bearer errado' } })).status()).toBe(401);

  const ok = await request.get('/api/cron/calendar', { headers: { authorization: 'Bearer e2e-cron-secret-de-teste-0001' } });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toMatchObject({ ok: true, failed: 0 });
});
