import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

// Banco de teste (papel dono, para conferir o que foi gravado).
const db = new pg.Pool({ connectionString: process.env.E2E_OWNER_URL });
test.afterAll(() => db.end());

/** Data daqui a `days` dias no formato do input date. */
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

test.beforeEach(async ({ context }) => {
  // O wa.me nunca é acessado de verdade: o teste só confere o link aberto.
  await context.route('https://wa.me/**', (route) => route.fulfill({ status: 200, body: 'WhatsApp (simulado)' }));
});

async function addTubes(page: Page, flavor: string, n: number) {
  for (let i = 0; i < n; i++) await page.getByRole('button', { name: `Adicionar ${flavor}` }).click();
}

/** Envia o formulário e devolve a mensagem que foi para o WhatsApp. */
async function submitAndReadWhatsapp(page: Page) {
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Enviar pelo WhatsApp' }).click();
  const wa = await popup;
  await wa.waitForURL(/wa\.me/);
  const url = new URL(wa.url());
  return { number: url.pathname.slice(1), text: url.searchParams.get('text') ?? '' };
}

test('festa: grava o pedido, abre o WhatsApp da env com o código e vai para a agenda', async ({ page }) => {
  await page.goto('/#encomendas');
  const form = page.locator('form.form');

  await form.getByRole('button', { name: 'Festa', exact: true }).click();
  await form.getByLabel('Nome').fill('Ana Teste');
  await form.getByLabel('WhatsApp').fill('(62) 98888-1234');
  const date = inDays(7);
  await form.getByLabel('Data').fill(date);
  await form.getByLabel('Horário').fill('19:30');
  await form.getByLabel('Número de convidados').fill('30');
  await addTubes(page, 'Uramaki de salmão e cream cheese', 2);
  await addTubes(page, 'Uramaki Especial Salmão e Camarão', 1);
  await expect(form.locator('.lines__total')).toContainText('3 tubos');
  await expect(form.locator('.lines__total')).toContainText('R$ 160,00');
  await form.getByRole('button', { name: 'Pix', exact: true }).click();

  const wa = await submitAndReadWhatsapp(page);
  expect(wa.number).toBe('5562900000000');
  const code = wa.text.match(/Pedido: (ZK-\d{6})/)![1]!;
  expect(wa.text).toContain('Tipo: Festa');
  expect(wa.text).toContain(`Data: ${date.split('-').reverse().join('/')} às 19:30`);
  expect(wa.text).toContain('Convidados: 30');
  expect(wa.text).toContain('• 2x Uramaki de salmão e cream cheese (R$ 100,00)');
  expect(wa.text).toContain('Total estimado: R$ 160,00');
  expect(wa.text).toContain('Pagamento: Pix');

  await expect(page.getByRole('status')).toContainText(`Pedido ${code}`);

  // A encomenda vai para a Google Agenda (simulada nos testes) logo após a resposta.
  await expect
    .poll(async () => (await db.query(`select calendar_sync_state from orders where code = $1`, [code])).rows[0]?.calendar_sync_state, {
      timeout: 15_000,
    })
    .toBe('SINCRONIZADO');

  const { rows } = await db.query(
    `select o.type, o.total_cents, o.guests, o.scheduled_at, o.google_event_id, o.payment_method, o.paid, c.phone,
            (select actor_label from audit_logs a where a.entity = 'orders' and a.entity_id = o.id::text and a.action = 'CREATE') as actor
       from orders o join customers c on c.id = o.customer_id where o.code = $1`,
    [code],
  );
  expect(rows[0]).toMatchObject({
    type: 'FESTA',
    total_cents: 16000,
    guests: 30,
    payment_method: 'PIX',
    paid: false,
    phone: '+5562988881234',
    actor: 'site',
  });
  expect(rows[0].google_event_id).toMatch(/^[0-9a-v]{32}$/);
  expect((rows[0].scheduled_at as Date).toISOString()).toBe(`${date}T22:30:00.000Z`);
});

test('delivery: exige endereço, recalcula o total no servidor e usa o mesmo cliente', async ({ page }) => {
  await page.goto('/#encomendas');
  const form = page.locator('form.form');

  await expect(form.getByLabel('Data')).toHaveCount(0); // delivery não tem agendamento
  await form.getByLabel('Nome').fill('Ana Teste');
  await form.getByLabel('WhatsApp').fill('62988881234');
  await addTubes(page, 'Uramaki de Salmão e Manga', 1);

  // Sem bairro/endereço o navegador não deixa enviar.
  await page.getByRole('button', { name: 'Enviar pelo WhatsApp' }).click();
  expect(await form.getByLabel('Bairro').evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);

  await form.getByLabel('Bairro').fill('Setor Bueno');
  await form.getByLabel('Endereço').fill('Rua T-30, 100');
  await form.getByLabel('Ponto de referência').fill('Portão azul, ao lado da padaria');

  // A forma de pagamento é obrigatória.
  await page.getByRole('button', { name: 'Enviar pelo WhatsApp' }).click();
  await expect(form.getByRole('alert')).toHaveText('Escolha a forma de pagamento.');
  await form.getByRole('button', { name: 'Cartão de débito', exact: true }).click();
  await expect(form.getByRole('button', { name: 'Cartão de débito', exact: true })).toHaveAttribute('aria-pressed', 'true');

  const wa = await submitAndReadWhatsapp(page);
  expect(wa.text).toContain('Quero fazer um pedido de Push Pop Sushi.');
  expect(wa.text).toMatch(/Pedido: ZK-\d{6}/);
  expect(wa.text).toContain('Bairro: Setor Bueno');
  expect(wa.text).toContain('Total estimado: R$ 50,00');
  expect(wa.text).toContain('Ponto de referência: Portão azul, ao lado da padaria');
  expect(wa.text).toContain('Pagamento: Cartão de débito');

  const code = wa.text.match(/Pedido: (ZK-\d{6})/)![1]!;
  const { rows: order } = await db.query(`select payment_method, address_reference from orders where code = $1`, [code]);
  expect(order[0]).toEqual({ payment_method: 'CARTAO_DEBITO', address_reference: 'Portão azul, ao lado da padaria' });

  const { rows } = await db.query(`select count(*)::int as n from customers where phone = '+5562988881234'`);
  expect(rows[0].n).toBe(1);
});

test('tipos no site: Delivery, Festa e Evento (evento com convidados opcionais)', async ({ page }) => {
  await page.goto('/#encomendas');
  const form = page.locator('form.form');
  await expect(form.getByRole('group', { name: 'Tipo de pedido' }).getByRole('button')).toHaveText(['Delivery', 'Festa', 'Evento']);

  await form.getByRole('button', { name: 'Evento', exact: true }).click();
  await expect(form.getByLabel('Número de convidados (opcional)')).not.toHaveAttribute('required');
  await form.getByLabel('Nome').fill('Empresa Teste');
  await form.getByLabel('WhatsApp').fill('62988887777');
  await form.getByLabel('Data').fill(inDays(10));
  await form.getByLabel('Horário').fill('12:00');
  await addTubes(page, 'Uramaki de Salmão e Manga', 3);
  await form.getByRole('button', { name: 'Pix', exact: true }).click();
  const wa = await submitAndReadWhatsapp(page);
  expect(wa.text).toContain('Quero fazer um pedido de Push Pop Sushi para um evento.');
  expect(wa.text).toContain('Tipo: Evento');
  expect(wa.text).not.toContain('Convidados');
});

test('festa e evento: só a partir de 3 dias corridos; data digitada antes disso é recusada', async ({ page }) => {
  await page.goto('/#encomendas');
  const form = page.locator('form.form');
  await form.getByRole('button', { name: 'Festa', exact: true }).click();

  // Hoje e o 3º dia no fuso de Goiânia.
  const spDay = (days: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(Date.now() + days * 86_400_000));
  const min = spDay(3);
  const br = (d: string) => d.split('-').reverse().join('/');
  const date = form.getByLabel('Data');
  await expect(date).toHaveAttribute('min', min); // o calendário não oferece datas anteriores
  await expect(form.getByText(`A partir de ${br(min)}: precisamos de 3 dias para preparar tudo.`)).toBeVisible();

  // Digitada à mão (amanhã): o aviso aparece na hora e o pedido não sai.
  await form.getByLabel('Nome').fill('Cliente Apressado');
  await form.getByLabel('WhatsApp').fill('62988886666');
  await date.fill(spDay(1));
  const message = `Para festas e eventos, escolha uma data a partir de ${br(min)}: precisamos de 3 dias para preparar tudo.`;
  await expect(form.getByText(message)).toBeVisible();
  await expect(date).toHaveAttribute('aria-invalid', 'true');
  await form.getByLabel('Horário').fill('19:00');
  await form.getByLabel('Número de convidados').fill('20');
  await addTubes(page, 'Uramaki de Salmão e Manga', 2);
  await form.getByRole('button', { name: 'Pix', exact: true }).click();
  let popup = false;
  page.on('popup', () => (popup = true));
  // Sem a validação nativa do navegador, para provar que o formulário também barra.
  await form.evaluate((f) => f.setAttribute('novalidate', ''));
  await page.getByRole('button', { name: 'Enviar pelo WhatsApp' }).click();
  await expect(date).toBeFocused();
  expect(popup).toBe(false);
  const { rows } = await db.query(`select count(*)::int as n from customers where phone = '+5562988886666'`);
  expect(rows[0].n).toBe(0);

  // No 3º dia, vale (o envio com data válida é coberto pelos testes acima; aqui não envia, para não somar
  // pedidos do mesmo aparelho no limite anti-abuso do site).
  await date.fill(min);
  await expect(form.getByText(message)).toHaveCount(0);
  await expect(date).not.toHaveAttribute('aria-invalid');
  await expect(form.getByText(`A partir de ${br(min)}`)).toBeVisible();
});

test('sem nenhum tubo, avisa e não abre o WhatsApp', async ({ page }) => {
  await page.goto('/#encomendas');
  const form = page.locator('form.form');
  await form.getByLabel('Nome').fill('Ana');
  await form.getByLabel('WhatsApp').fill('62988881234');
  await form.getByLabel('Bairro').fill('Centro');
  await form.getByLabel('Endereço').fill('Av. Goiás, 1');

  let opened = false;
  page.on('popup', () => (opened = true));
  await page.getByRole('button', { name: 'Enviar pelo WhatsApp' }).click();
  await expect(form.getByRole('alert')).toHaveText('Adicione pelo menos um tubo ao pedido.');
  expect(opened).toBe(false);
});

test('rodapé do site tem o acesso à área administrativa', async ({ page }) => {
  await page.goto('/');
  const footer = page.locator('footer');
  await footer.scrollIntoViewIfNeeded();
  await footer.screenshot({ path: 'test-results/site-rodape.png' });
  await footer.getByRole('link', { name: 'Área administrativa' }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
});
