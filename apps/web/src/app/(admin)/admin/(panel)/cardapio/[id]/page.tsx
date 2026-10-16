import { getProduct, getRecipe, withContext } from '@zaraki/db';
import { RotateCcw, Trash2 } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/admin/ConfirmAction';
import { StatusBadge } from '@/components/admin/list';
import { PageHeader } from '@/components/admin/PageHeader';
import { RecordTabs } from '@/components/admin/RecordTabs';
import { ProductForm } from '@/components/admin/ProductForm';
import { RecipeEditor } from '@/components/admin/stock/RecipeEditor';
import { isUuid } from '@/lib/ids';
import { requireAdmin } from '@/server/admin';
import { recordHistory } from '@/server/history';
import { loadStockOptions } from '@/server/stock';
import { applyRecipeCostAction, saveRecipeAction } from '../../estoque/actions';
import { saveProduct, setProductStatusAction, uploadProductImageAction } from '../actions';

export const metadata: Metadata = { title: 'Sabor' };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin('products:read');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const product = await withContext(ctx.db, (tx) => getProduct(tx, ctx.tenant.id, id));
  if (!product) notFound();
  const history = await recordHistory(ctx, 'products', product.id);
  // Ficha técnica: quem vê o estoque vê a ficha; quem gerencia o estoque edita.
  const recipe = ctx.can('stock:read')
    ? { data: await withContext(ctx.db, (tx) => getRecipe(tx, ctx.tenant.id, product.id)), options: await loadStockOptions(ctx) }
    : null;

  return (
    <>
      <PageHeader
        title={product.name}
        description={`Identificador no site: ${product.slug}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge active={product.status} />
            {ctx.can('products:delete') &&
              (product.status ? (
                <ConfirmAction
                  key="excluir"
                  label="Excluir"
                  icon={<Trash2 />}
                  variant="destructive"
                  title="Excluir este sabor?"
                  description="Ele sai do cardápio do site e do painel. Pedidos antigos continuam intactos e o sabor pode ser restaurado depois."
                  confirmLabel="Excluir sabor"
                  action={setProductStatusAction.bind(null, product.id, false)}
                />
              ) : (
                <ConfirmAction
                  key="restaurar"
                  label="Restaurar"
                  icon={<RotateCcw />}
                  title="Restaurar este sabor?"
                  description="Ele volta a aparecer no cardápio do site."
                  confirmLabel="Restaurar sabor"
                  action={setProductStatusAction.bind(null, product.id, true)}
                />
              ))}
          </div>
        }
      />
      <RecordTabs history={history} timezone={ctx.tenant.timezone}>
        <div className="grid gap-6">
          <ProductForm
            product={product}
            action={saveProduct.bind(null, product.id)}
            uploadAction={uploadProductImageAction}
            readOnly={!ctx.can('products:write') || !product.status}
          />
          {recipe && (
            <RecipeEditor
              initial={recipe.data.lines.map((l) => ({ itemId: l.itemId, qty: l.qty }))}
              items={recipe.options.items}
              currentCostCents={product.costCents}
              action={saveRecipeAction.bind(null, product.id)}
              applyCost={applyRecipeCostAction.bind(null, product.id)}
              readOnly={!ctx.can('stock:manage') || !product.status}
            />
          )}
        </div>
      </RecordTabs>
    </>
  );
}
