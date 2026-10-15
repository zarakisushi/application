// Gera as capturas de tela do manual (docs/manual/img). Fica fora da suíte normal: só roda com
// MANUAL_CAPTURES=1 (veja docs/manual/LEIA-ME.md).
import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { loginGestor, openDb } from './helpers';

const OUT = resolve(process.cwd(), '../../docs/manual/img');
const db = openDb();
test.afterAll(() => db.end());
test.describe.configure({ mode: 'serial' });
test.skip(!process.env.MANUAL_CAPTURES, 'capturas do manual: rode com MANUAL_CAPTURES=1');

async function shot(page: Page, name: string, height = 800) {
  await page.setViewportSize({ width: 1280, height });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 82 });
}

test('capturas do manual', async ({ page }) => {
  test.setTimeout(240_000);
  await page.context().route('https://wa.me/**', (r) => r.fulfill({ status: 200, body: 'ok' }));

  // Site
  await page.goto('/');
  await shot(page, '01-site');
  await page.goto('/#encomendas');
  await page.getByRole('button', { name: 'Adicionar Uramaki de Salmão e Manga' }).click();
  await page.getByRole('button', { name: 'Adicionar Uramaki de Salmão e Manga' }).click();
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.locator('#encomendas').evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 40));
  await shot(page, '02-site-pedido', 1000);

  // Acesso
  await page.goto('/admin/login');
  await shot(page, '03-login', 700);
  await loginGestor(page);
  await shot(page, '04-inicio', 1500);

  // Operação
  await page.goto('/admin/pedidos');
  await shot(page, '05-pedidos', 900);
  await page.locator('table a[href^="/admin/pedidos/"]').first().click();
  await expect(page.getByRole('heading', { name: /^Pedido / })).toBeVisible();
  await shot(page, '06-pedido-ficha', 1100);
  await page.goto('/admin/encomendas?visao=calendario');
  await shot(page, '07-encomendas-calendario', 950);
  await page.goto('/admin/clientes');
  await shot(page, '08-clientes', 900);
  await page.goto('/admin/cardapio');
  await shot(page, '09-cardapio', 900);
  await page.goto('/admin/cupons/novo');
  await page.getByLabel('Código', { exact: true }).fill('ANIVERSARIO');
  await page.getByLabel('Desconto (%)').fill('15');
  await page.getByLabel('Pedido mínimo em tubos (opcional)').fill('3');
  await page.getByLabel('Limite de usos (opcional)').fill('100');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await shot(page, '10-cupom', 950);

  // Royalties: franquia com faturamento no mês passado
  await page.goto('/admin/unidades/nova');
  await page.getByLabel('Nome da unidade').fill('Zaraki Sushi — Setor Bueno');
  await page.getByLabel('Cidade').fill('Goiânia');
  await page.getByLabel('Prefixo dos pedidos').fill('ZKB');
  await page.getByLabel('Royalties (%)').fill('6');
  await page.getByRole('button', { name: 'Criar unidade' }).click();
  await expect(page.getByRole('heading', { name: 'Zaraki Sushi — Setor Bueno' })).toBeVisible();
  const { rows } = await db.query("select id from tenants where name = 'Zaraki Sushi — Setor Bueno' and status");
  const c = await db.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('app.platform_admin','on',true), set_config('app.allow_backdate','on',true), set_config('app.actor_label','manual',true)");
    const cust = await c.query("insert into customers (tenant_id, name, phone) values ($1, 'Cliente Bueno', '+5562988880000') returning id", [rows[0].id]);
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 2 + i * 2, 20));
      const order = await c.query(
        `insert into orders (tenant_id, code, type, stage, customer_id, subtotal_cents, total_cents, source, payment_method, paid, paid_at, created_at)
         values ($1, $2, 'DELIVERY', 'ENTREGUE', $3, $4, $4, 'SITE', 'PIX', true, $5, $5) returning id`,
        [rows[0].id, `ZKB-${String(i + 1).padStart(6, '0')}`, cust.rows[0].id, 150000 + i * 9000, at.toISOString()],
      );
      // Venda paga entra no caixa da franquia (como o sistema faz ao registrar o pagamento).
      await c.query(
        `insert into finance_entries (tenant_id, direction, description, amount_cents, category_id, account_id, competence_date, due_date, paid_on, payment_method, origin, order_id)
         select $1, 'ENTRADA', 'Pedido ' || $2, $3,
                (select id from finance_categories where tenant_id = $1 and system_key = 'VENDAS' and status),
                (select id from finance_accounts where tenant_id = $1 and kind = 'BANCO' and status limit 1),
                $4::date, $4::date, $4::date, 'PIX', 'PEDIDO', $5`,
        [rows[0].id, `ZKB-${String(i + 1).padStart(6, '0')}`, 150000 + i * 9000, at.toISOString().slice(0, 10), order.rows[0].id],
      );
      // Algumas despesas típicas da franquia no mesmo mês.
      if (i % 3 === 0) {
        await c.query(
          `insert into finance_entries (tenant_id, direction, description, amount_cents, category_id, account_id, competence_date, due_date, paid_on, origin)
           select $1, 'SAIDA', 'Insumos da semana', $2,
                  (select id from finance_categories where tenant_id = $1 and name = 'Insumos: peixes e frutos do mar' and status),
                  (select id from finance_accounts where tenant_id = $1 and kind = 'BANCO' and status limit 1),
                  $3::date, $3::date, $3::date, 'MANUAL'`,
          [rows[0].id, 210000 + i * 5000, at.toISOString().slice(0, 10)],
        );
      }
    }
    await c.query('commit');
  } finally {
    c.release();
  }
  await page.goto('/admin/financeiro/royalties');
  await page.getByRole('button', { name: 'Gerar royalties' }).click();
  await expect(page.getByText(/cobrança\(s\) gerada\(s\)/)).toBeVisible();
  await page.waitForTimeout(1500);

  // Financeiro
  await page.goto('/admin/financeiro');
  await shot(page, '11-fin-visao-geral', 1850);
  await page.goto('/admin/financeiro/lancamentos');
  await shot(page, '12-fin-lancamentos', 1000);
  await page.goto('/admin/financeiro/lancamentos/novo?tipo=SAIDA');
  await page.waitForURL(/tipo=SAIDA/);
  await page.getByLabel('Descrição').fill('Salmão fresco da semana');
  await page.getByLabel('Valor (R$)').fill('2.350,00');
  await page.getByRole('combobox', { name: 'Categoria' }).click();
  await page.getByRole('option', { name: 'Insumos: peixes e frutos do mar' }).click();
  await page.getByLabel('Fornecedor (opcional)').fill('Peixaria Goiás');
  await shot(page, '13-fin-nova-saida', 1150);
  await page.goto('/admin/financeiro/agenda');
  await shot(page, '14-fin-agenda', 1000);
  await page.goto('/admin/financeiro/fluxo?aba=dre');
  await shot(page, '15-fin-dre', 800);
  await page.goto('/admin/financeiro/royalties');
  await shot(page, '16-fin-royalties', 700);

  // Extrato com uma imagem que imita a tela do banco
  const balance = await db.query(
    `select (select opening_balance_cents from finance_accounts a where a.name = 'Conta bancária' and a.tenant_id = (select id from tenants where kind = 'MATRIZ'))
          + coalesce((select sum(case when e.direction = 'ENTRADA' then e.amount_cents else -e.amount_cents end) from finance_entries e join finance_accounts a on a.id = e.account_id
                       where a.name = 'Conta bancária' and e.status and e.paid_on is not null and e.tenant_id = (select id from tenants where kind = 'MATRIZ')), 0) as cents`,
  );
  const saldo = Number(balance.rows[0].cents) + 4_870;
  await page.goto('/admin/financeiro/contas');
  await shot(page, '17-fin-contas', 900);
  await page.getByTestId('conta-Conta bancária').getByRole('link', { name: /Extratos/ }).click();
  const image = await page.evaluate((cents) => {
    const cv = document.createElement('canvas');
    cv.width = 900;
    cv.height = 1200;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 900, 1200);
    g.fillStyle = '#0b5394';
    g.fillRect(0, 0, 900, 140);
    g.fillStyle = '#ffffff';
    g.font = 'bold 44px sans-serif';
    g.fillText('Banco • Extrato', 40, 90);
    g.fillStyle = '#222';
    g.font = '30px sans-serif';
    const lines = ['PIX RECEBIDO   + 1.245,00', 'CARTÃO DÉBITO  + 3.980,40', 'BOLETO ALUGUEL − 6.500,00', 'PIX ENVIADO    − 2.350,00', 'TARIFA         −    89,00'];
    lines.forEach((l, i) => g.fillText(l, 40, 240 + i * 70));
    g.font = 'bold 40px sans-serif';
    g.fillText(`Saldo: R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 40, 700);
    return cv.toDataURL('image/png').split(',')[1]!;
  }, saldo);
  await page.getByRole('button', { name: 'Enviar extrato' }).click();
  await page.getByLabel('Saldo no extrato (R$)').fill((saldo / 100).toFixed(2).replace('.', ','));
  await page.getByLabel('Escolher arquivos do extrato').setInputFiles({ name: 'extrato-outubro.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
  await expect(page.getByRole('list', { name: 'Arquivos do extrato' }).getByRole('listitem')).toHaveCount(1);
  await page.getByLabel('Observação (opcional)').fill('Print do app do banco');
  await page.getByRole('button', { name: 'Guardar extrato' }).click();
  await expect(page.getByText('Extrato guardado.')).toBeVisible();
  await page.waitForTimeout(2500);
  await shot(page, '18-fin-extratos', 750);

  // Relatórios e rede
  await page.goto('/admin/relatorios');
  await shot(page, '19-relatorios', 1700);
  await page.goto('/admin/relatorios/ranking-unidades?periodo=90d');
  await shot(page, '20-rede-ranking', 1100);
  await page.goto('/admin/relatorios/financeiro-rede?periodo=90d');
  await shot(page, '21-rede-financeiro', 1100);
  await page.goto('/admin/relatorios/faturamento?periodo=90d');
  await shot(page, '22-relatorio-faturamento', 1100);

  // Gestão
  await page.goto('/admin/usuarios');
  await shot(page, '23-usuarios', 700);
  await page.goto('/admin/unidades');
  await shot(page, '24-unidades', 700);
  await page.goto('/admin/auditoria');
  await page.getByRole('button', { name: 'Verificar integridade' }).click();
  await expect(page.getByText(/Trilha íntegra/)).toBeVisible();
  await shot(page, '25-auditoria', 900);
  await page.goto('/admin?unidade=todas');
  await page.getByRole('button', { name: 'Trocar de unidade' }).click();
  await shot(page, '26-seletor-unidade', 700);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Mostrar apenas ícones' }).click();
  await shot(page, '27-menu-icones', 700);
  await page.getByRole('button', { name: 'Mostrar textos do menu' }).click();
});
