'use server';

import {
  financeAccountSchema,
  financeCategorySchema,
  financeEntrySchema,
  payEntrySchema,
  SERIES_SCOPES,
  statementSchema,
  transferSchema,
  type SeriesScope,
} from '@zaraki/core';
import {
  createAccount,
  createAttachment,
  createCategory,
  createEntries,
  adjustFromStatement,
  closeMonth,
  createStatement,
  createTransfer,
  generateRoyalties,
  recalculateRoyalty,
  reconcileAccount,
  reopenMonth,
  payEntry,
  setAccountStatus,
  setCategoryStatus,
  setEntryStatus,
  setStatementStatus,
  unpayEntry,
  updateAccount,
  updateCategory,
  updateEntry,
  withContext,
} from '@zaraki/db';
import { parseMoneyToCents, todayInZone } from '@zaraki/core';
import { revalidatePath } from 'next/cache';
import { attempt, formToObject, parseForm, type ActionResult } from '@/server/actions';
import { requireAdmin } from '@/server/admin';
import { readFinanceAttachment } from '@/server/uploads';

const BASE = '/admin/financeiro';

function refresh() {
  revalidatePath(BASE, 'layout');
}

export async function saveEntry(id: string | null, form: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin('finance:write');
  const { data, result } = parseForm(financeEntrySchema, form);
  if (!data) return result;
  const scopeRaw = String(form.get('scope') ?? 'ESTE');
  const scope: SeriesScope = (SERIES_SCOPES as readonly string[]).includes(scopeRaw) ? (scopeRaw as SeriesScope) : 'ESTE';
  return attempt(async () => {
    if (id) {
      await withContext(ctx.db, (tx) => updateEntry(tx, ctx.tenant.id, id, data, scope));
      refresh();
      return { ok: true, message: scope === 'PROXIMOS' ? 'Lançamento e próximos em aberto atualizados.' : 'Lançamento salvo.' };
    }
    const rows = await withContext(ctx.db, (tx) => createEntries(tx, ctx.tenant.id, data));
    refresh();
    const what = data.direction === 'ENTRADA' ? 'Entrada' : 'Saída';
    return {
      ok: true,
      message: rows.length > 1 ? `${what} lançada em ${rows.length} meses.` : `${what} lançada.`,
      redirectTo: `${BASE}/lancamentos/${rows[0]!.id}`,
    };
  });
}

export async function payEntryAction(id: string, form: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin('finance:write');
  const { data, result } = parseForm(payEntrySchema, form);
  if (!data) return result;
  return attempt(async () => {
    const entry = await withContext(ctx.db, (tx) => payEntry(tx, ctx.tenant.id, id, data));
    refresh();
    return { ok: true, message: entry.direction === 'ENTRADA' ? 'Recebimento registrado.' : 'Pagamento registrado.' };
  });
}

export async function unpayEntryAction(id: string): Promise<ActionResult> {
  const ctx = await requireAdmin('finance:write');
  return attempt(async () => {
    await withContext(ctx.db, (tx) => unpayEntry(tx, ctx.tenant.id, id));
    refresh();
    return { ok: true, message: 'Pagamento desfeito: o lançamento voltou a ficar em aberto.' };
  });
}

export async function setEntryStatusAction(id: string, status: boolean): Promise<ActionResult> {
  const ctx = await requireAdmin('finance:manage');
  return attempt(async () => {
    await withContext(ctx.db, (tx) => setEntryStatus(tx, ctx.tenant.id, id, status));
    refresh();
    return { ok: true, message: status ? 'Lançamento restaurado.' : 'Lançamento excluído. Ele pode ser restaurado depois.' };
  });
}

/**
 * Guarda o comprovante (no banco, privado à unidade) e devolve o id; o formulário o liga ao lançamento
 * ao salvar.
 */
export async function uploadAttachmentAction(form: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin('finance:write');
  const file = form.get('file');
  if (!(file instanceof File)) return { error: 'Escolha o arquivo do comprovante.' };
  return attempt(async () => {
    const data = await readFinanceAttachment(file);
    const id = await withContext(ctx.db, (tx) => createAttachment(tx, ctx.tenant.id, data));
    return { ok: true, id, message: 'Comprovante anexado. Salve o lançamento para guardar.' };
  });
}

export async function transferAction(form: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin('finance:write');
  const { data, result } = parseForm(transferSchema, form);
  if (!data) return result;
  return attempt(async () => {
    await withContext(ctx.db, (tx) => createTransfer(tx, ctx.tenant.id, data));
    refresh();
    return { ok: true, message: 'Transferência registrada.' };
  });
}

export async function saveAccount(id: string | null, form: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin('finance:manage');
  // Várias caixas "recebe vendas em" com o mesmo nome: formToObject só guardaria a última.
  const { data, result } = parseForm(financeAccountSchema, { ...formToObject(form), receivesMethods: form.getAll('receivesMethods').map(String) });
  if (!data) return result;
  return attempt(async () => {
    const account = await withContext(ctx.db, (tx) => (id ? updateAccount(tx, ctx.tenant.id, id, data) : createAccount(tx, ctx.tenant.id, data)));
    if (!account) return { error: 'Conta não encontrada.' };
    refresh();
    return { ok: true, message: id ? 'Conta salva.' : 'Conta criada.' };
  });
}

export async function setAccountStatusAction(id: string, status: boolean): Promise<ActionResult> {
  const ctx = await requireAdmin('finance:manage');
  return attempt(async () => {
    await withContext(ctx.db, (tx) => setAccountStatus(tx, ctx.tenant.id, id, status));
    refresh();
    return { ok: true, message: status ? 'Conta restaurada.' : 'Conta excluída. Os lançamentos antigos continuam no histórico.' };
  });
}

export async function saveCategory(id: string | null, form: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin('finance:manage');
  const { data, result } = parseForm(financeCategorySchema, form);
  if (!data) return result;
  return attempt(async () => {
    await withContext(ctx.db, (tx) => (id ? updateCategory(tx, ctx.tenant.id, id, data) : createCategory(tx, ctx.tenant.id, data)));
    refresh();
    return { ok: true, message: id ? 'Categoria salva.' : 'Categoria criada.' };
  });
}

export async function setCategoryStatusAction(id: string, status: boolean): Promise<ActionResult> {
  const ctx = await requireAdmin('finance:manage');
  return attempt(async () => {
    await withContext(ctx.db, (tx) => setCategoryStatus(tx, ctx.tenant.id, id, status));
    refresh();
    return { ok: true, message: status ? 'Categoria restaurada.' : 'Categoria excluída.' };
  });
}

/** Gera os royalties de um mês ("AAAA-MM") para todas as franquias (só a Matriz; o cron faz isso todo dia). */
export async function generateRoyaltiesAction(month: string): Promise<ActionResult> {
  const ctx = await requireAdmin('finance:manage');
  if (!ctx.platformAdmin) return { error: 'Só a administração da Matriz gera royalties.' };
  if (!/^\d{4}-\d{2}$/.test(month)) return { error: 'Mês inválido.' };
  return attempt(async () => {
    const r = await withContext({ ...ctx.db, platformAdmin: true }, (tx) => generateRoyalties(tx, `${month}-01`));
    refresh();
    if (r.failed.length) return { error: `Não foi possível gerar para: ${r.failed.map((f) => `${f.tenant} (${f.error})`).join('; ')}` };
    const parts = [r.created.length && `${r.created.length} cobrança(s) gerada(s)`, r.skipped.length && `${r.skipped.length} já existia(m)`].filter(Boolean);
    return { ok: true, message: parts.length ? `${parts.join(', ')}.` : 'Nenhuma franquia com royalties cadastrados.' };
  });
}

export async function recalculateRoyaltyAction(chargeId: string): Promise<ActionResult> {
  const ctx = await requireAdmin('finance:manage');
  if (!ctx.platformAdmin) return { error: 'Só a administração da Matriz recalcula royalties.' };
  return attempt(async () => {
    const r = await withContext({ ...ctx.db, platformAdmin: true }, (tx) => recalculateRoyalty(tx, chargeId));
    refresh();
    return { ok: true, message: r.changed ? 'Royalties recalculados com o faturamento atual.' : 'Nada mudou: o valor já estava correto.' };
  });
}

/** Conferência de saldo: informa o saldo real e o sistema lança a diferença. */
export async function reconcileAccountAction(accountId: string, form: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin('finance:manage');
  const raw = String(form.get('realBalance') ?? '').trim();
  const negative = raw.startsWith('-');
  const cents = parseMoneyToCents(raw.replace(/^-/, ''));
  if (!raw || cents === null) return { error: 'Confira os campos destacados.', fieldErrors: { realBalance: 'Informe o saldo (ex.: 1.250,00)' } };
  return attempt(async () => {
    const r = await withContext(ctx.db, (tx) => reconcileAccount(tx, ctx.tenant.id, accountId, negative ? -cents : cents, todayInZone(ctx.tenant.timezone)));
    refresh();
    if (!r.diff) return { ok: true, message: 'Saldo confere. Nada a ajustar.' };
    return { ok: true, message: `Ajuste de ${(Math.abs(r.diff) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} lançado (${r.diff > 0 ? 'sobra' : 'falta'}).` };
  });
}

export async function closeMonthAction(month: string): Promise<ActionResult> {
  const ctx = await requireAdmin('finance:manage');
  return attempt(async () => {
    await withContext(ctx.db, (tx) => closeMonth(tx, ctx.tenant.id, `${month}-01`, todayInZone(ctx.tenant.timezone)));
    refresh();
    return { ok: true, message: 'Mês fechado: os lançamentos dele não podem mais ser alterados.' };
  });
}

export async function reopenMonthAction(month: string): Promise<ActionResult> {
  const ctx = await requireAdmin('finance:manage');
  return attempt(async () => {
    await withContext(ctx.db, (tx) => reopenMonth(tx, ctx.tenant.id, `${month}-01`));
    refresh();
    return { ok: true, message: 'Mês reaberto. A reabertura fica registrada na auditoria.' };
  });
}

/** Guarda um extrato da conta (fotos/PDF já enviados como comprovantes) com a data e o saldo dele. */
export async function saveStatementAction(accountId: string, form: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin('finance:write');
  const { data, result } = parseForm(statementSchema, { ...formToObject(form), attachmentIds: form.getAll('attachmentIds').map(String) });
  if (!data) return result;
  return attempt(async () => {
    await withContext(ctx.db, (tx) => createStatement(tx, ctx.tenant.id, accountId, data));
    refresh();
    return { ok: true, message: 'Extrato guardado.' };
  });
}

export async function setStatementStatusAction(id: string, status: boolean): Promise<ActionResult> {
  const ctx = await requireAdmin('finance:manage');
  return attempt(async () => {
    await withContext(ctx.db, (tx) => setStatementStatus(tx, ctx.tenant.id, id, status));
    refresh();
    return { ok: true, message: status ? 'Extrato restaurado.' : 'Extrato excluído. Ele continua na auditoria.' };
  });
}

/** Lança a diferença do extrato como ajuste, na data do extrato. */
export async function adjustFromStatementAction(id: string): Promise<ActionResult> {
  const ctx = await requireAdmin('finance:manage');
  return attempt(async () => {
    const r = await withContext(ctx.db, (tx) => adjustFromStatement(tx, ctx.tenant.id, id));
    refresh();
    if (!r.diff) return { ok: true, message: 'O saldo já confere. Nada a ajustar.' };
    return { ok: true, message: `Ajuste de ${(Math.abs(r.diff) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} lançado na data do extrato.` };
  });
}
