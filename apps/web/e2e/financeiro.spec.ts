import { expect, test, type Page } from '@playwright/test';
import { confirmDialog, createAndLoginAs, loginGestor, openDb } from './helpers';

const db = openDb();
test.afterAll(() => db.end());
test.describe.configure({ mode: 'serial' });

/** "R$ 1.234,56" / "− R$ 10,00" → centavos. */
const cents = (text: string) => {
  const n = Number(text.replace(/[^\d,]/g, '').replace(',', '.'));
  return Math.round(n * 100) * (/[−-]/.test(text) ? -1 : 1);
};

async function accountBalance(page: Page, name: string) {
  await page.goto('/admin/financeiro/contas');
  const text = await page.getByTestId(`conta-${name}`).locator('.font-display').first().textContent();
  return cents(text!);
}

async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function panelOrder(page: Page, name: string) {
  await page.goto('/admin/pedidos/novo');
  await page.getByLabel('Nome do cliente').fill(name);
  await page.getByLabel('WhatsApp do cliente').fill(`62 98${String(Date.now()).slice(-7)}`);
  await page.getByLabel('Bairro').fill('Centro');
  await page.getByLabel('Endereço').fill('Rua 7, 70');
  await page.getByRole('button', { name: 'Adicionar Uramaki de Salmão e Manga' }).click();
  await page.getByRole('button', { name: 'Lançar pedido' }).click();
  await expect(page.getByRole('heading', { name: /^Pedido ZK-/ })).toBeVisible();
  return (await page.getByRole('heading', { name: /^Pedido ZK-/ }).textContent())!.replace('Pedido ', '').trim();
}

test('saída recorrente: aluguel em 3 meses, pagar o primeiro e ver o saldo da conta cair', async ({ page }) => {
  await loginGestor(page);
  const before = await accountBalance(page, 'Conta bancária');

  await page.goto('/admin/financeiro/lancamentos');
  await page.getByRole('link', { name: 'Nova saída' }).click();
  // Espera a navegação terminar: preencher antes disso perderia o que foi digitado.
  await page.waitForURL(/novo\?tipo=SAIDA/);
  await page.getByLabel('Descrição').fill('Aluguel da loja');
  await page.getByLabel('Valor (R$)').fill('3.500,00');
  await choose(page, 'Categoria', 'Aluguel');
  await page.getByLabel('Fornecedor (opcional)').fill('Imobiliária Centro');
  await choose(page, 'Repetir', 'Repete todo mês');
  await page.getByLabel('Por quantos meses').fill('3');
  await expect(page.getByTestId('entry-summary')).toContainText('Saída de R$ 3.500,00 · Aluguel');
  await expect(page.getByTestId('entry-summary')).toContainText('repete por 3 meses (R$ 10.500,00 no total)');
  await page.screenshot({ path: 'test-results/financeiro-lancamento.png', fullPage: true });
  await page.getByRole('button', { name: 'Lançar saída' }).click();
  await expect(page.getByRole('heading', { name: 'Aluguel da loja' })).toBeVisible();
  await expect(page.getByText('Série (3 lançamentos)')).toBeVisible();

  const { rows } = await db.query(`select amount_cents, paid_on, installment from finance_entries where description = 'Aluguel da loja' order by installment`);
  expect(rows.map((r) => [r.amount_cents, r.paid_on, r.installment])).toEqual([
    [350000, null, 1],
    [350000, null, 2],
    [350000, null, 3],
  ]);

  // Vence hoje: aparece em "A pagar" e é pago por lá.
  await page.goto('/admin/financeiro/agenda');
  await expect(page.getByText('Vencem hoje', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pagar: Aluguel da loja' }).first().click();
  await choose(page, 'Conta', 'Conta bancária');
  await page.getByRole('button', { name: 'Confirmar pagamento' }).click();
  await expect(page.getByText('Pagamento registrado.')).toBeVisible();
  await page.screenshot({ path: 'test-results/financeiro-agenda.png', fullPage: true });

  expect(await accountBalance(page, 'Conta bancária')).toBe(before - 350000);
  await page.screenshot({ path: 'test-results/financeiro-contas.png', fullPage: true });

  await page.goto('/admin/financeiro/lancamentos?q=Aluguel+da+loja&periodo=tudo');
  await expect(page.getByRole('row', { name: /Aluguel da loja/ })).toHaveCount(3);
  await expect(page.getByTestId('total-saídas')).toContainText('R$ 10.500,00');
  await page.screenshot({ path: 'test-results/financeiro-lista.png', fullPage: true });
});

test('pedido: registrar pagamento lança a venda no caixa e cancelar estorna', async ({ page }) => {
  await loginGestor(page);
  const code = await panelOrder(page, 'Cliente Caixa');
  await page.getByRole('button', { name: 'Registrar pagamento' }).click();
  await choose(page, 'Forma de pagamento', 'Dinheiro');
  await page.getByRole('button', { name: 'Confirmar pagamento' }).click();
  await expect(page.getByText('Pagamento registrado: a venda entrou no caixa.')).toBeVisible();

  await page.goto(`/admin/financeiro/lancamentos?q=${code}&periodo=tudo`);
  const row = page.getByRole('row', { name: new RegExp(`Pedido ${code}`) });
  await expect(row).toContainText('Recebido');
  await expect(row).toContainText('Caixa da loja');
  await expect(row).toContainText('+ R$ 50,00');

  // A entrada acompanha o pedido: no financeiro ela é só leitura.
  await row.getByRole('link', { name: `Pedido ${code} · Cliente Caixa` }).click();
  await expect(page.getByText('Este lançamento acompanha o pedido')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salvar lançamento' })).toHaveCount(0);

  await page.getByRole('link', { name: code }).click();
  await page.getByRole('button', { name: 'Cancelar pedido' }).click();
  await confirmDialog(page, 'Cancelar pedido', 'Cliente desistiu');
  await expect(page.getByText('Pedido cancelado.')).toBeVisible();
  await page.goto(`/admin/financeiro/lancamentos?q=${code}&periodo=tudo`);
  await expect(page.getByText('Nenhum lançamento neste filtro.')).toBeVisible();
});

test('entregar sem pagamento pergunta "Pagamento recebido?" e o pedido fica em "A receber"', async ({ page }) => {
  await loginGestor(page);
  const code = await panelOrder(page, 'Cliente Fiado');
  await page.getByRole('combobox', { name: 'Mudar etapa' }).click();
  await page.getByRole('option', { name: 'Entregue' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Pagamento recebido?');
  await page.getByRole('button', { name: 'Ainda não (só entregar)' }).click();
  await expect(page.getByText('Pedido entregue. O pagamento fica em "A receber".')).toBeVisible();

  await page.goto('/admin/financeiro/agenda');
  await page.getByRole('tab', { name: /A receber/ }).click();
  const line = page.locator('div.border-b', { has: page.getByRole('link', { name: `Pedido ${code}` }) });
  await line.getByRole('button', { name: 'Registrar pagamento' }).click();
  await choose(page, 'Forma de pagamento', 'Pix');
  await page.getByRole('button', { name: 'Confirmar pagamento' }).click();
  await expect(page.getByText('Pagamento registrado: a venda entrou no caixa.')).toBeVisible();
  await expect(page.getByRole('link', { name: `Pedido ${code}` })).toHaveCount(0);

  const { rows } = await db.query(
    `select e.amount_cents, a.name from finance_entries e join orders o on o.id = e.order_id join finance_accounts a on a.id = e.account_id where o.code = $1 and e.status`,
    [code],
  );
  expect(rows).toEqual([{ amount_cents: 5000, name: 'Conta bancária' }]);
});

test('transferência entre contas move o saldo sem virar entrada nem saída', async ({ page }) => {
  await loginGestor(page);
  const caixa = await accountBalance(page, 'Caixa da loja');
  const banco = await accountBalance(page, 'Conta bancária');
  await page.getByRole('button', { name: 'Transferir entre contas' }).click();
  await page.getByLabel('Valor (R$)').fill('20');
  await page.getByRole('button', { name: 'Registrar transferência' }).click();
  await expect(page.getByText('Transferência registrada.')).toBeVisible();
  expect(await accountBalance(page, 'Caixa da loja')).toBe(caixa - 2000);
  expect(await accountBalance(page, 'Conta bancária')).toBe(banco + 2000);
});

test('trocar de unidade troca todo o financeiro', async ({ page }) => {
  await loginGestor(page);
  await page.goto('/admin/unidades/nova');
  await page.getByLabel('Nome da unidade').fill('Zaraki Sushi — Marista');
  await page.getByLabel('Prefixo dos pedidos').fill('ZKM');
  await page.getByRole('button', { name: 'Criar unidade' }).click();
  await expect(page.getByRole('heading', { name: 'Zaraki Sushi — Marista' })).toBeVisible();

  await page.getByRole('button', { name: 'Trocar de unidade' }).click();
  await page.getByRole('menuitem', { name: /Marista/ }).click();
  await expect(page.getByRole('button', { name: 'Trocar de unidade' })).toContainText('Marista');

  await page.goto('/admin/financeiro/lancamentos?periodo=tudo');
  await expect(page.getByText('Nenhum lançamento neste filtro.')).toBeVisible();
  expect(await accountBalance(page, 'Conta bancária')).toBe(0);
  await page.getByRole('tab', { name: 'Categorias de saída' }).click();
  await expect(page.getByRole('cell', { name: 'Royalties à Matriz do sistema' })).toBeVisible();

  // De volta à Matriz, o aluguel lançado no primeiro teste continua lá.
  await page.getByRole('button', { name: 'Trocar de unidade' }).click();
  await page.getByRole('menuitem', { name: /Matriz/ }).click();
  await page.goto('/admin/financeiro/lancamentos?q=Aluguel+da+loja&periodo=tudo');
  await expect(page.getByRole('row', { name: /Aluguel da loja/ })).toHaveCount(3);

  // Desativa a unidade de teste (os outros testes contam com só a Matriz ativa).
  await page.goto('/admin/unidades?q=Marista');
  await page.getByRole('link', { name: 'Zaraki Sushi — Marista', exact: true }).click();
  await page.getByRole('button', { name: 'Desativar' }).click();
  await confirmDialog(page, 'Desativar unidade');
  await expect(page.getByText('Excluído', { exact: true })).toBeVisible();
});

test('visão geral: semáforo de saúde, números do mês e gráficos; cartão na página inicial', async ({ page }) => {
  await loginGestor(page);
  await expect(page.getByTestId('home-finance')).toContainText('Saldo em caixa');
  await page.getByRole('link', { name: 'Financeiro: abrir a visão geral' }).click();

  await expect(page.getByRole('heading', { name: 'Visão geral' })).toBeVisible();
  await expect(page.getByTestId('health-verdict')).toBeVisible();
  // A demonstração deixa uma conta vencida de propósito: o indicador fica vermelho.
  await expect(page.getByTestId('health-vencidas')).toHaveAttribute('data-tone', 'bad');
  await expect(page.getByTestId('health-folego')).toContainText('Fôlego de caixa');
  await expect(page.getByTestId('health-cmv')).toContainText('das vendas');
  await expect(page.getByText('Entradas × saídas (12 meses)')).toBeVisible();
  await expect(page.locator('a[data-active="true"]', { hasText: 'Visão geral' })).toBeVisible();
  await page.screenshot({ path: 'test-results/financeiro-visao-geral.png', fullPage: true });

  const shown = (await page.getByTestId('overview-month').textContent())!;
  await page.getByRole('link', { name: 'Mês anterior' }).click();
  await expect(page).toHaveURL(/mes=\d{4}-\d{2}/);
  await expect(page.getByTestId('overview-month')).not.toHaveText(shown);
});

test('fluxo de caixa e DRE do ano, com atalho para o relatório', async ({ page }) => {
  await loginGestor(page);
  await page.goto('/admin/financeiro/fluxo');
  await expect(page.getByRole('cell', { name: 'Saldo final' })).toBeVisible();
  await page.getByRole('tab', { name: 'DRE gerencial' }).click();
  await expect(page.getByRole('cell', { name: '= Margem de contribuição' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '= Resultado operacional' })).toBeVisible();
  await page.screenshot({ path: 'test-results/financeiro-dre.png', fullPage: true });

  await page.getByRole('link', { name: 'Abrir no relatório (CSV)' }).last().click();
  await expect(page.getByRole('heading', { name: 'DRE gerencial' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Receita', exact: true })).toBeVisible();

  await page.goto('/admin/relatorios');
  for (const title of ['Fluxo de caixa', 'Despesas por categoria', 'Gastos por fornecedor', 'Contas a pagar e a receber por atraso']) {
    await expect(page.getByRole('main').getByRole('link', { name: new RegExp(`^${title}`) })).toBeVisible();
  }
});

test('comprovante fica privado: abre para a equipe logada e não para quem não está', async ({ page, browser }) => {
  await loginGestor(page);
  await page.goto('/admin/financeiro/lancamentos/novo?tipo=SAIDA');
  await page.getByLabel('Descrição').fill('Compra de embalagens');
  await page.getByLabel('Valor (R$)').fill('180');
  await choose(page, 'Categoria', 'Embalagens');
  await page.getByLabel('Enviar comprovante').setInputFiles({ name: 'nota.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%nota fiscal de teste\n') });
  await expect(page.getByRole('link', { name: 'Ver comprovante' })).toBeVisible();
  await page.getByRole('button', { name: 'Lançar saída' }).click();
  await expect(page.getByRole('heading', { name: 'Compra de embalagens' })).toBeVisible();

  const href = (await page.getByRole('link', { name: 'Ver comprovante' }).getAttribute('href'))!;
  expect(href).toMatch(/^\/api\/financeiro\/comprovante\//);
  const ok = await page.request.get(href);
  expect(ok.status()).toBe(200);
  expect(ok.headers()['content-type']).toBe('application/pdf');

  const stranger = await browser.newContext();
  const denied = await stranger.request.get(new URL(href, page.url()).toString());
  expect(denied.status()).toBe(401);
  await stranger.close();

  // Arquivo que não é PDF nem imagem é recusado pelo conteúdo, não pela extensão.
  await page.goto('/admin/financeiro/lancamentos/novo?tipo=SAIDA');
  await page.getByLabel('Enviar comprovante').setInputFiles({ name: 'falso.pdf', mimeType: 'application/pdf', buffer: Buffer.from('<script>alert(1)</script>') });
  await expect(page.getByText('Formato não aceito: use PDF, JPG, PNG ou WebP.')).toBeVisible();
});

/** Pedido entregue no passado direto no banco (o painel só lança pedidos com a data de hoje). */
async function backdatedDeliveredOrder(tenantId: string, totalCents: number, at: string) {
  const c = await db.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('app.platform_admin', 'on', true), set_config('app.allow_backdate', 'on', true), set_config('app.actor_label', 'e2e', true)");
    const customer = await c.query("insert into customers (tenant_id, name, phone) values ($1, 'Cliente Franquia', '+5562988887777') returning id", [tenantId]);
    await c.query(
      `insert into orders (tenant_id, code, type, stage, customer_id, subtotal_cents, total_cents, source, created_at)
       values ($1, 'ZKR-000001', 'DELIVERY', 'ENTREGUE', $2, $3, $3, 'BALCAO', $4)`,
      [tenantId, customer.rows[0].id, totalCents, at],
    );
    await c.query('commit');
  } finally {
    c.release();
  }
}

test('royalties: a Matriz gera a cobrança do mês passado e a franquia vê o que deve', async ({ page }) => {
  await loginGestor(page);
  await page.goto('/admin/unidades/nova');
  await page.getByLabel('Nome da unidade').fill('Zaraki Sushi — Royalties');
  await page.getByLabel('Prefixo dos pedidos').fill('ZKR');
  await page.getByLabel('Royalties (%)').fill('6');
  await page.getByLabel('Vencimento dos royalties (dia)').fill('15');
  await page.getByRole('button', { name: 'Criar unidade' }).click();
  await expect(page.getByRole('heading', { name: 'Zaraki Sushi — Royalties' })).toBeVisible();

  const { rows } = await db.query("select id from tenants where name = 'Zaraki Sushi — Royalties' and status");
  const now = new Date();
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15, 18));
  await backdatedDeliveredOrder(rows[0].id, 1_000_000, lastMonth.toISOString()); // R$ 10.000 → 6% = R$ 600

  await page.goto('/admin/financeiro/royalties');
  await page.getByRole('button', { name: 'Gerar royalties' }).click();
  await expect(page.getByText(/cobrança\(s\) gerada\(s\)/)).toBeVisible();
  const row = page.getByRole('row', { name: /Zaraki Sushi — Royalties/ });
  await expect(row).toContainText('R$ 10.000,00');
  await expect(row).toContainText('R$ 600,00');
  await expect(row).toContainText('Em aberto');
  await page.screenshot({ path: 'test-results/financeiro-royalties.png', fullPage: true });

  // De novo: não duplica.
  await page.getByRole('button', { name: 'Gerar royalties' }).click();
  await expect(page.getByText(/já existia/)).toBeVisible();

  // Na Matriz, a entrada a receber; na franquia, a saída a pagar.
  const { rows: entries } = await db.query(
    `select t.kind, e.direction, e.amount_cents from finance_entries e join tenants t on t.id = e.tenant_id where e.origin = 'ROYALTIES' and e.status and e.description like '%Royalties%' order by t.kind`,
  );
  expect(entries).toEqual(
    expect.arrayContaining([
      { kind: 'FRANQUIA', direction: 'SAIDA', amount_cents: 60000 },
      { kind: 'MATRIZ', direction: 'ENTRADA', amount_cents: 60000 },
    ]),
  );

  await page.getByRole('button', { name: 'Trocar de unidade' }).click();
  await page.getByRole('menuitem', { name: /Royalties/ }).click();
  await page.goto('/admin/financeiro/royalties');
  await expect(page.getByText('A pagar à Matriz')).toBeVisible();
  await expect(page.getByRole('row', { name: /R\$ 600,00/ })).toBeVisible();

  await page.getByRole('button', { name: 'Trocar de unidade' }).click();
  await page.getByRole('menuitem', { name: /Matriz/ }).click();
  await page.goto('/admin/unidades?q=Royalties');
  await page.getByRole('link', { name: 'Zaraki Sushi — Royalties', exact: true }).click();
  await page.getByRole('button', { name: 'Desativar' }).click();
  await confirmDialog(page, 'Desativar unidade');
  await expect(page.getByText('Excluído', { exact: true })).toBeVisible();
});

test('conferir saldo lança a diferença como ajuste', async ({ page }) => {
  await loginGestor(page);
  const before = await accountBalance(page, 'Caixa da loja');
  await page.getByTestId('conta-Caixa da loja').getByRole('button', { name: 'Conferir saldo' }).click();
  await page.getByLabel('Saldo real hoje (R$)').fill(((before + 1000) / 100).toFixed(2).replace('.', ','));
  await page.getByRole('button', { name: 'Conferir', exact: true }).click();
  await expect(page.getByText('Ajuste de R$ 10,00 lançado (sobra).')).toBeVisible();
  expect(await accountBalance(page, 'Caixa da loja')).toBe(before + 1000);
});

test('fechar o mês bloqueia lançamentos nele, com mensagem clara; reabrir libera', async ({ page }) => {
  await loginGestor(page);
  const now = new Date();
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 10)).toISOString().slice(0, 10);
  await page.goto('/admin/financeiro/contas');
  await page.getByRole('tab', { name: 'Fechamento do mês' }).click();
  const row = page.getByTestId(`fechamento-${last.slice(0, 7)}`);
  await row.getByRole('button', { name: 'Fechar mês' }).click();
  await confirmDialog(page, 'Fechar mês');
  await expect(row).toContainText('Fechado');

  await page.goto('/admin/financeiro/lancamentos/novo?tipo=SAIDA');
  await page.getByLabel('Descrição').fill('Lançamento atrasado');
  await page.getByLabel('Valor (R$)').fill('50');
  await choose(page, 'Categoria', 'Gás');
  await page.getByLabel('Competência').fill(last);
  await page.getByRole('button', { name: 'Lançar saída' }).click();
  await expect(page.getByText(/está fechado\. Reabra o mês para alterar\./)).toBeVisible();

  await page.goto('/admin/financeiro/contas');
  await page.getByRole('tab', { name: 'Fechamento do mês' }).click();
  await row.getByRole('button', { name: 'Reabrir' }).click();
  await confirmDialog(page, 'Reabrir mês');
  await expect(row).toContainText('Aberto');
});

test('relatório Financeiro da rede mostra cada unidade', async ({ page }) => {
  await loginGestor(page);
  await page.goto('/admin/relatorios/financeiro-rede');
  await expect(page.getByRole('heading', { name: 'Financeiro da rede' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Zaraki Sushi — Matriz' })).toBeVisible();
});

test('extratos: envia fotos e PDF grandes, compara com o sistema e ajusta a diferença', async ({ page }) => {
  await loginGestor(page);
  const balance = await accountBalance(page, 'Conta bancária');
  await page.getByTestId('conta-Conta bancária').getByRole('link', { name: /Extratos \(0\)/ }).click();
  await expect(page.getByText('Nenhum extrato enviado ainda.', { exact: false })).toBeVisible();

  // Foto grande de celular (gerada no navegador) e um PDF de ~3 MB, acima do antigo limite de 1 MB.
  const photo = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 2400;
    c.height = 1800;
    const g = c.getContext('2d')!;
    const img = g.createImageData(c.width, c.height);
    for (let i = 0; i < img.data.length; i++) img.data[i] = (i * 2654435761) % 251;
    g.putImageData(img, 0, 0);
    return c.toDataURL('image/jpeg', 0.95).split(',')[1]!;
  });
  const photoBuffer = Buffer.from(photo, 'base64');
  const bigPdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(3 * 1024 * 1024, 32)]);

  await page.getByRole('button', { name: 'Enviar extrato' }).click();
  await page.getByLabel('Saldo no extrato (R$)').fill(((balance + 2500) / 100).toFixed(2).replace('.', ','));
  await page.getByLabel('Escolher arquivos do extrato').setInputFiles([
    { name: 'extrato-pagina-1.jpg', mimeType: 'image/jpeg', buffer: photoBuffer },
    { name: 'extrato-completo.pdf', mimeType: 'application/pdf', buffer: bigPdf },
  ]);
  await expect(page.getByRole('list', { name: 'Arquivos do extrato' }).getByRole('listitem')).toHaveCount(2, { timeout: 15_000 });
  await page.getByLabel('Observação (opcional)').fill('Extrato do app do banco');
  await page.getByRole('button', { name: 'Guardar extrato' }).click();
  await expect(page.getByText('Extrato guardado.')).toBeVisible();

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const card = page.getByTestId(`extrato-${today}`);
  await expect(card).toContainText('Diferença de R$ 25,00 a mais no banco');
  await expect(card.getByRole('link', { name: /Abrir/ })).toHaveCount(2);
  await page.screenshot({ path: 'test-results/financeiro-extratos.png', fullPage: true });

  // A foto chegou reduzida; o PDF, inteiro. Os dois abrem só para quem está logado.
  const { rows } = await db.query(`select content_type, size_bytes from finance_attachments where file_name like 'extrato-%' order by file_name`);
  expect(rows[0]).toEqual({ content_type: 'application/pdf', size_bytes: bigPdf.length });
  expect(rows[1].content_type).toMatch(/^image\/(webp|jpeg)$/);
  expect(rows[1].size_bytes).toBeLessThan(photoBuffer.length);
  const href = (await card.getByRole('link', { name: /Abrir/ }).first().getAttribute('href'))!;
  expect((await page.request.get(href)).status()).toBe(200);

  await card.getByRole('button', { name: 'Lançar ajuste da diferença' }).click();
  await confirmDialog(page, 'Lançar ajuste');
  await expect(card).toContainText('Confere');
  await expect(card.getByRole('link', { name: 'Ver o ajuste lançado' })).toBeVisible();

  await page.goto('/admin/financeiro/contas');
  await expect(page.getByTestId('conta-Conta bancária')).toContainText('Último extrato: hoje · confere');
  await page.goto('/admin/financeiro');
  await expect(page.getByTestId('health-conferencia')).toHaveAttribute('data-tone', 'good');
});

test('atendente não vê o financeiro', async ({ page }) => {
  await createAndLoginAs(page, { name: 'Bia Atendente', email: 'bia.financeiro@zaraki.test', role: 'Atendente' });
  await expect(page.getByRole('link', { name: 'Lançamentos' })).toHaveCount(0);
  await page.goto('/admin/financeiro/lancamentos');
  await expect(page).toHaveURL(/sem-permissao/);
});
