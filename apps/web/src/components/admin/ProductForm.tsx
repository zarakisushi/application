'use client';

import { centsToInput, formatCents, parseMoneyToCents } from '@zaraki/core';
import { ImageUp } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Field, FormError, useServerForm, type ActionResult } from './form';

type Product = {
  name: string;
  description: string;
  priceCents: number;
  costCents: number;
  imageUrl: string | null;
  isSpecial: boolean;
  sortOrder: number;
};

export function ProductForm({
  product,
  action,
  uploadAction,
  readOnly,
}: {
  product?: Product;
  action: (form: FormData) => Promise<ActionResult>;
  /** Envio de foto (Vercel Blob em produção). */
  uploadAction?: (form: FormData) => Promise<ActionResult>;
  readOnly?: boolean;
}) {
  const [uploading, startUpload] = useTransition();
  const { result, pending, onSubmit, errors } = useServerForm(action);
  const [price, setPrice] = useState(product ? centsToInput(product.priceCents) : '');
  const [cost, setCost] = useState(product ? centsToInput(product.costCents) : '');
  const [image, setImage] = useState(product?.imageUrl ?? '');

  const priceCents = parseMoneyToCents(price);
  const costCents = parseMoneyToCents(cost || '0');
  const margin = priceCents && costCents !== null ? priceCents - costCents : null;

  return (
    <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardContent className="grid gap-5 pt-6">
          <FormError result={result} />
          <fieldset disabled={readOnly || pending} className="grid gap-5">
            <Field label="Nome do sabor" htmlFor="name" error={errors.name}>
              <Input id="name" name="name" defaultValue={product?.name} required aria-invalid={!!errors.name} />
            </Field>
            <Field label="Descrição" htmlFor="description" error={errors.description} hint="Aparece no cardápio do site.">
              <Textarea id="description" name="description" defaultValue={product?.description} rows={4} />
            </Field>
            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Preço de venda (R$)" htmlFor="price" error={errors.price}>
                <Input id="price" name="price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="50,00" required aria-invalid={!!errors.price} />
              </Field>
              <Field label="Custo (R$)" htmlFor="cost" error={errors.cost} hint="Insumos + embalagem, por tubo.">
                <Input id="cost" name="cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0,00" aria-invalid={!!errors.cost} />
              </Field>
              <Field label="Ordem no cardápio" htmlFor="sortOrder" error={errors.sortOrder}>
                <Input id="sortOrder" name="sortOrder" type="number" min={0} max={999} defaultValue={product?.sortOrder ?? 0} />
              </Field>
            </div>
            <Field label="Imagem" htmlFor="imageUrl" error={errors.imageUrl} hint="Envie uma foto (JPG, PNG ou WebP, até 4 MB) ou informe o endereço de uma imagem.">
              <div className="flex flex-wrap gap-2">
                <Input id="imageUrl" name="imageUrl" value={image} onChange={(e) => setImage(e.target.value)} aria-invalid={!!errors.imageUrl} className="min-w-56 flex-1" />
                {uploadAction && (
                  <Button type="button" variant="outline" disabled={uploading} asChild>
                    <label className="cursor-pointer">
                      <ImageUp /> {uploading ? 'Enviando…' : 'Enviar foto'}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="sr-only"
                        aria-label="Enviar foto do sabor"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          if (!file) return;
                          const data = new FormData();
                          data.set('file', file);
                          startUpload(async () => {
                            const r = await uploadAction(data);
                            if (r?.url) {
                              setImage(r.url);
                              toast.success(r.message ?? 'Foto enviada.');
                            } else if (r?.error) toast.error(r.error);
                          });
                        }}
                      />
                    </label>
                  </Button>
                )}
              </div>
            </Field>
            <label className="flex items-center gap-3 text-sm font-medium">
              <Switch name="isSpecial" defaultChecked={product?.isSpecial} />
              Destacar como “Especial” no site
            </label>
          </fieldset>
          {!readOnly && (
            <div>
              <Button type="submit" disabled={pending}>
                {pending ? 'Salvando…' : 'Salvar sabor'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="h-fit overflow-hidden">
        <div className="aspect-[4/3] bg-brand-ink">
          {image && (image.startsWith('/') || image.startsWith('https://')) && (
            <img src={image} alt="" className="size-full object-cover" />
          )}
        </div>
        <CardContent className="grid gap-1 pt-4 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Preço</span>
            <span>{priceCents !== null ? formatCents(priceCents) : '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Custo</span>
            <span>{costCents !== null ? formatCents(costCents) : '—'}</span>
          </div>
          <div className="flex justify-between font-medium">
            <span>Margem por tubo</span>
            <span>
              {margin !== null && priceCents
                ? `${formatCents(margin)} (${Math.round((margin / priceCents) * 100)}%)`
                : '—'}
            </span>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
