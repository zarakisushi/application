import 'server-only';
import { SUPPLIER_CATEGORY_LABEL, type SupplierCategory } from '@zaraki/core';
import { listAccounts, listCategories, listStockItems, listStockSuppliers, listSuppliers, withContext } from '@zaraki/db';
import type { SupplierOption } from '@/components/admin/suppliers/SupplierCombobox';
import type { StockItemOption } from '@/components/admin/stock/ui';
import type { AdminContext } from './admin';

/** Opções dos formulários do estoque da unidade ativa (itens ativos, categorias de saída, fornecedores, contas). */
export function loadStockOptions(ctx: AdminContext) {
  return withContext(ctx.db, async (tx) => {
    const all = await listStockItems(tx, ctx.tenant.id, { pageSize: 100_000 });
    const items: (StockItemOption & { kind: (typeof all.rows)[number]['kind'] })[] = all.rows
      .filter((i) => i.active)
      .map((i) => ({ id: i.id, name: i.name, unit: i.unit, kind: i.kind, balance: i.balance, avgCostCents: i.avgCostCents }));
    return {
      items,
      categories: (await listCategories(tx, ctx.tenant.id, { direction: 'SAIDA', onlyActive: true })).map((c) => ({ id: c.id, name: c.name })),
      suppliers: await supplierOptions(tx, ctx),
      accounts: (await listAccounts(tx, ctx.tenant.id)).filter((a) => a.active).map((a) => ({ id: a.id, name: a.name })),
    };
  });
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

/** Fornecedores para o campo da compra: os cadastrados (da unidade e da rede) e os nomes já usados em compras. */
async function supplierOptions(tx: Parameters<Parameters<typeof withContext>[1]>[0], ctx: AdminContext): Promise<SupplierOption[]> {
  const registered: SupplierOption[] = ctx.can('suppliers:read')
    ? (await listSuppliers(tx, ctx.tenant.id, { pageSize: 1000 })).rows.map((s) => ({
        name: s.name,
        registered: true,
        fromNetwork: s.fromNetwork,
        detail: [s.categories.slice(0, 2).map((c) => SUPPLIER_CATEGORY_LABEL[c as SupplierCategory] ?? c).join(', '), s.contactName].filter(Boolean).join(' · ') || null,
      }))
    : [];
  const known = new Set(registered.map((s) => fold(s.name)));
  const previous = (await listStockSuppliers(tx, ctx.tenant.id))
    .filter((n) => !known.has(fold(n)))
    .map((name) => ({ name, registered: false }));
  return [...registered, ...previous];
}
