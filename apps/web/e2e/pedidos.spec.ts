import { expect, test, type Page } from '@playwright/test';
import { confirmDialog, expectEventually, loginGestor, openDb } from './helpers';

const db = openDb();
test.afterAll(() => db.end());
test.describe.configure({ mode: 'serial' });

async function pick(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

const add = (page: Page, flavor: string) => page.getByRole('button', { name: `Adicionar ${flavor}` }).click();

test('pedido do WhatsApp: lança, avança etapas, edita valores e cancela com motivo', async ({ page }) => {
  await loginGestor(page);
  await page.goto('/admin/pedidos/novo');
  await page.getByLabel('Nome do cliente').fill('Rafael Lima');
  await page.getByLabel('WhatsApp do cliente').fill('62 98555-1212');
  await page.getByLabel('Bairro').fill('Jardim Goiás');
  await page.getByLabel('Endereço').fill('Rua 1, 100');
  await add(page, 'Uramaki de Salmão e Manga');
  await add(page, 'Uramaki de Salmão e Manga');
  await page.getByLabel('Taxa de entrega (R$)').fill('8,00');
  await expect(page.getByText('Total R$ 108,00')).toBeVisible();
  await page.getByRole('button', { name: 'Lançar pedido' }).click();

  await expect(page.getByRole('heading', { name: /^Pedido ZK-/ })).toBeVisible();
  await expect(page.getByText('WhatsApp', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('row', { name: /Total R\$ 108,00/ })).toBeVisible();

  // Fluxo de etapas
  await page.getByRole('button', { name: 'Avançar para “Confirmado”' }).click();
  await expect(page.getByRole('button', { name: 'Avançar para “Em preparo”' })).toBeVisible();

  // Edição: mais um sabor e desconto
  await add(page, 'Uramaki Especial Salmão e Camarão');
  await page.getByLabel('Desconto (R$)').fill('10');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByText('Pedido salvo.')).toBeVisible();
  await expect(page.getByRole('row', { name: /Total R\$ 158,00/ })).toBeVisible(); // 100 + 60 − 10 + 8

  // Cancelar exige motivo
  await page.getByRole('button', { name: 'Cancelar pedido' }).click();
  await expect(page.getByRole('alertdialog').getByRole('button', { name: 'Cancelar pedido' })).toBeDisabled();
  await confirmDialog(page, 'Cancelar pedido', 'Cliente desistiu');
  await expect(page.getByText('Motivo do cancelamento: Cliente desistiu')).toBeVisible();
  await expect(page.locator('ol.border-l').getByText('Cancelado', { exact: true })).toBeVisible();

  const { rows } = await db.query(
    `select o.source, o.stage, o.total_cents, array_agg(h.to_stage order by h.created_at) as stages
       from orders o join order_stage_history h on h.order_id = o.id
      where o.customer_id = (select id from customers where phone = '+5562985551212') group by o.id`,
  );
  expect(rows[0]).toMatchObject({ source: 'WHATSAPP', stage: 'CANCELADO', total_cents: 15800 });
  expect(rows[0].stages).toEqual('{NOVO,CONFIRMADO,CANCELADO}');
});

test('festa: lança pelo painel, vai para a Google Agenda e aparece na lista e no calendário', async ({ page }) => {
  await loginGestor(page);
  await page.goto('/admin/encomendas/novo');
  await page.getByLabel('Nome do cliente').fill('Juliana Prado');
  await page.getByLabel('WhatsApp do cliente').fill('62 98444-3434');
  await pick(page, 'Tipo', 'Festa');
  const date = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel('Data').fill(date);
  await page.getByLabel('Horário').fill('20:00');
  await page.getByLabel('Convidados').fill('50');
  await add(page, 'Uramaki de salmão e cream cheese');
  await page.getByRole('button', { name: 'Lançar pedido' }).click();

  await expect(page).toHaveURL(/\/admin\/encomendas\/[0-9a-f-]+$/);
  await expect(page.getByText('50 convidados')).toBeVisible();
  await expectEventually(page, 'Na agenda');

  await page.goto('/admin/encomendas');
  await expect(page.getByRole('row', { name: /Juliana Prado/ })).toBeVisible();

  await page.goto(`/admin/encomendas?visao=calendario&mes=${date.slice(0, 7)}`);
  await expect(page.getByRole('link', { name: /20:00 Juliana Prado/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/admin-encomendas-calendario.png', fullPage: true });

  // Excluir encomenda tira da agenda (fila DELETE) e da lista; restaurar devolve.
  await page.getByRole('link', { name: /20:00 Juliana Prado/ }).click();
  await page.getByRole('button', { name: 'Excluir' }).click();
  await confirmDialog(page, 'Excluir pedido');
  await expect(page.getByText('Excluído', { exact: true })).toBeVisible();
  const { rows } = await db.query(
    `select array_agg(j.op order by j.created_at) as ops from calendar_sync_jobs j
       join orders o on o.id = j.order_id join customers c on c.id = o.customer_id where c.phone = '+5562984443434'`,
  );
  expect(rows[0].ops).toEqual('{UPSERT,DELETE}');
});

test('mudar um delivery para evento move o pedido de seção', async ({ page }) => {
  await loginGestor(page);
  await page.goto('/admin/pedidos?q=Rafael&status=todos');
  await page.getByRole('link', { name: /^ZK-/ }).first().click();
  await pick(page, 'Mudar etapa', 'Confirmado'); // sai de "Cancelado"
  await expect(page.getByText('Etapa atualizada.')).toBeVisible();

  await pick(page, 'Tipo', 'Evento');
  const date = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel('Data').fill(date);
  await page.getByLabel('Horário').fill('12:30');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page).toHaveURL(/\/admin\/encomendas\/[0-9a-f-]+$/);
  await expectEventually(page, 'Na agenda');
});
