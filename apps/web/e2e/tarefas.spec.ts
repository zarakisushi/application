import { expect, test, type Page } from '@playwright/test';
import { confirmDialog, createAndLoginAs, loginGestor } from './helpers';

test.describe.configure({ mode: 'serial' });

const task = (page: Page, title: string) => page.getByTestId('task').filter({ has: page.getByText(title, { exact: true }) });

async function addTask(page: Page, title: string) {
  const input = page.getByRole('textbox', { name: 'Nova tarefa' });
  await input.fill(title);
  await input.press('Enter');
  await expect(task(page, title)).toBeVisible();
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
}

test('tarefas: adicionar com Enter, concluir com ícone e cor, desfazer pelo aviso', async ({ page }) => {
  await loginGestor(page);
  await page.locator('[data-sidebar="menu-button"]', { hasText: 'Tarefas' }).click();
  await expect(page.getByRole('heading', { name: 'Tarefas', level: 1 })).toBeVisible();

  // A atrasada fica no topo, em vermelho.
  const first = page.getByRole('list', { name: 'Tarefas em aberto' }).getByTestId('task').first();
  await expect(first).toContainText('Pedir salmão para sexta');
  await expect(first).toContainText(/Atrasada · \d+ dias?/);
  await expect(page.getByText(/1 tarefa atrasada: elas vêm primeiro entre as pendentes/)).toBeVisible();

  await addTask(page, 'Comprar gelo para o evento');
  const item = task(page, 'Comprar gelo para o evento');
  await expect(item).toContainText('Hoje');
  await item.getByRole('button', { name: 'Marcar "Comprar gelo para o evento" como feita' }).click();

  const done = page.getByRole('region', { name: 'Tarefas feitas' }).getByTestId('task').filter({ hasText: 'Comprar gelo para o evento' });
  await expect(done).toHaveAttribute('data-done', 'true');
  await expect(done).toHaveClass(/bg-emerald-50/);
  await expect(done).toContainText(/Feita por Gestora às \d{2}:\d{2}/);
  await expect(done.getByRole('button', { name: 'Desmarcar "Comprar gelo para o evento"' })).toHaveAttribute('aria-pressed', 'true');
  // No computador, lado a lado: pendentes à esquerda e feitas à direita.
  const doneBox = (await page.getByRole('region', { name: 'Tarefas feitas' }).boundingBox())!;
  const pendingBox = (await page.getByRole('region', { name: 'Tarefas pendentes' }).boundingBox())!;
  expect(doneBox.x).toBeGreaterThan(pendingBox.x + pendingBox.width - 1);
  await expect(page.getByRole('heading', { name: /^Pendentes \(\d+\)/ })).toBeVisible();

  await page.getByRole('button', { name: 'Desfazer' }).click();
  await expect(page.getByRole('list', { name: 'Tarefas em aberto' }).getByText('Comprar gelo para o evento')).toBeVisible();
  await page.reload();
  await expect(task(page, 'Comprar gelo para o evento')).not.toHaveAttribute('data-done');
});

test('celular: as feitas ficam num accordion fechado, com a contagem, das mais recentes para as mais antigas', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginGestor(page);
  await page.goto('/admin/tarefas');
  await page.getByRole('textbox', { name: 'Nova tarefa' }).fill('Primeira concluída');
  await page.getByRole('textbox', { name: 'Nova tarefa' }).press('Enter');
  await page.getByRole('textbox', { name: 'Nova tarefa' }).fill('Segunda concluída');
  await page.getByRole('textbox', { name: 'Nova tarefa' }).press('Enter');
  await expect(task(page, 'Segunda concluída')).toBeVisible();
  await task(page, 'Primeira concluída').getByRole('button', { name: /como feita/ }).click();
  await expect(page.getByText('Tarefa concluída').first()).toBeVisible();
  await task(page, 'Segunda concluída').getByRole('button', { name: /como feita/ }).click();

  const accordion = page.getByRole('button', { name: /^Feitas \d+/ });
  await expect(accordion).toHaveAttribute('aria-expanded', 'false');
  const doneList = page.getByRole('list', { name: 'Tarefas concluídas' });
  await expect(doneList).toBeHidden();
  const count = await page.getByRole('region', { name: 'Tarefas feitas' }).getByTestId('task').count();
  await expect(accordion).toContainText(String(count));

  await accordion.click();
  await expect(accordion).toHaveAttribute('aria-expanded', 'true');
  await expect(doneList).toBeVisible();
  // A mais recente primeiro.
  await expect(doneList.getByTestId('task').first()).toContainText('Segunda concluída');
  await expect(doneList.getByTestId('task').nth(1)).toContainText('Primeira concluída');
});

test('tarefas: prazo da semana, responsável, edição e "Minhas tarefas"', async ({ page }) => {
  await loginGestor(page);
  await page.goto('/admin/tarefas');
  await page.getByRole('textbox', { name: 'Nova tarefa' }).fill('Trocar o filtro da coifa');
  await page.getByRole('combobox', { name: 'Prazo' }).click();
  await page.getByRole('option', { name: 'Esta semana' }).click();
  await page.getByRole('combobox', { name: 'Responsável' }).click();
  await page.getByRole('option', { name: 'Gestora Matriz (eu)' }).click();
  await page.getByRole('button', { name: 'Importante' }).click();
  await page.getByRole('button', { name: 'Adicionar' }).click();
  await expect(page.getByText('Tarefa adicionada.')).toBeVisible();

  // Prazo até domingo: aparece na Semana (e em Hoje só se hoje for domingo).
  await page.getByRole('link', { name: /^Semana/ }).click();
  await expect(page).toHaveURL(/aba=semana/);
  const coifa = task(page, 'Trocar o filtro da coifa');
  await expect(coifa).toContainText('Importante');
  await expect(coifa).toContainText('Gestora Matriz');
  await expect(task(page, 'Limpar o freezer')).toBeVisible();

  await page.getByRole('link', { name: /Minhas tarefas/ }).click();
  await expect(page).toHaveURL(/minhas=1/);
  await expect(coifa).toBeVisible();
  await expect(task(page, 'Limpar o freezer')).toHaveCount(0);

  // Editar pelo painel lateral.
  await coifa.getByRole('button', { name: 'Trocar o filtro da coifa', exact: true }).click();
  await page.getByLabel('Observação (opcional)').fill('Modelo do filtro na nota antiga.');
  await page.getByRole('button', { name: 'Salvar tarefa' }).click();
  await expect(page.getByText('Tarefa salva.')).toBeVisible();
  await expect(task(page, 'Trocar o filtro da coifa')).toContainText('Observação');
});

test('página inicial: tarefas de hoje com botão de concluir', async ({ page }) => {
  await loginGestor(page);
  const card = page.getByTestId('home-tasks');
  await expect(card).toContainText('Tarefas de hoje');
  await expect(card).toContainText(/atrasada/);
  await card.getByRole('button', { name: 'Marcar "Postar story do Push Pop da semana" como feita' }).click();
  await expect(page.getByText('Tarefa concluída')).toBeVisible();
  await page.goto('/admin/tarefas');
  await expect(task(page, 'Postar story do Push Pop da semana')).toHaveAttribute('data-done', 'true');
});

test('atendente cria e conclui, mas não altera tarefa de outra pessoa', async ({ page }) => {
  await createAndLoginAs(page, { name: 'Dani Atendente', email: 'dani.tarefas@zaraki.test', role: 'Atendente' });
  await page.locator('[data-sidebar="menu-button"]', { hasText: 'Tarefas' }).click();
  await addTask(page, 'Separar sachês de shoyu');

  // A própria tarefa: pode editar e excluir.
  await task(page, 'Separar sachês de shoyu').getByRole('button', { name: 'Separar sachês de shoyu', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Excluir' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Tarefa de outra pessoa: só concluir.
  await task(page, 'Conferir a validade do cream cheese').getByRole('button', { name: 'Conferir a validade do cream cheese', exact: true }).click();
  await expect(page.getByText('Só quem criou, o gerente ou o administrador alteram esta tarefa.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Excluir' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await task(page, 'Conferir a validade do cream cheese').getByRole('button', { name: /como feita/ }).click();
  await expect(task(page, 'Conferir a validade do cream cheese')).toContainText('Feita por Dani');
});

test('franquia nova começa com a lista vazia e não vê as tarefas da Matriz', async ({ page }) => {
  await loginGestor(page);
  await page.goto('/admin/unidades/nova');
  await page.getByLabel('Nome da unidade').fill('Zaraki Sushi — Tarefas Teste');
  await page.getByLabel('Cidade').fill('Goiânia');
  await page.getByLabel('Prefixo dos pedidos').fill('ZKT');
  await page.getByRole('button', { name: 'Criar unidade' }).click();
  await expect(page.getByRole('heading', { name: 'Zaraki Sushi — Tarefas Teste' })).toBeVisible();

  await page.goto('/admin/tarefas');
  await page.getByRole('button', { name: 'Trocar de unidade' }).click();
  await page.getByRole('menuitem', { name: /Tarefas Teste/ }).click();
  await expect(page.getByRole('button', { name: 'Trocar de unidade' })).toContainText('Tarefas Teste');
  await expect(page.getByText('Nada para hoje 🎉')).toBeVisible();
  await page.getByRole('link', { name: /^Todas/ }).click();
  await expect(page.getByText('Nenhuma tarefa em aberto')).toBeVisible();
  await addTask(page, 'Primeira tarefa da franquia');

  // De volta à Matriz: a tarefa da franquia não aparece.
  await page.getByRole('button', { name: 'Trocar de unidade' }).click();
  await page.getByRole('menuitem', { name: /Matriz/ }).click();
  await expect(page.getByRole('button', { name: 'Trocar de unidade' })).toContainText('Matriz');
  await expect(task(page, 'Primeira tarefa da franquia')).toHaveCount(0);

  // Desativa a unidade de teste para não afetar os outros testes.
  await page.goto('/admin/unidades');
  await page.getByRole('link', { name: 'Zaraki Sushi — Tarefas Teste' }).click();
  await page.getByRole('button', { name: 'Desativar' }).click();
  await confirmDialog(page, 'Desativar unidade');
});
