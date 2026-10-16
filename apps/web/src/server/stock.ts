import 'server-only';
import { listAccounts, listCategories, listStockItems, listStockSuppliers, withContext } from '@zaraki/db';
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
      suppliers: await listStockSuppliers(tx, ctx.tenant.id),
      accounts: (await listAccounts(tx, ctx.tenant.id)).filter((a) => a.active).map((a) => ({ id: a.id, name: a.name })),
    };
  });
}
