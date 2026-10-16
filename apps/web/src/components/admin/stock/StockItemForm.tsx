'use client';

import { STOCK_KIND_LABEL, STOCK_KINDS, STOCK_UNIT_LABEL, STOCK_UNITS, type StockKind } from '@zaraki/core';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Field, FormError, useServerForm, type ActionResult } from '../form';

type Item = { name: string; kind: StockKind; unit: string; minQty: number; financeCategoryId: string | null; supplier: string | null; active: boolean };
type Category = { id: string; name: string };

/** Categoria do Financeiro sugerida para cada tipo de item (pode ser trocada). */
const SUGGESTED_CATEGORY: Record<StockKind, string> = {
  INSUMO: 'Insumos: arroz, nori e mercearia',
  EMBALAGEM: 'Embalagens',
  MARKETING: 'Marketing',
  OPERACIONAL: 'Manutenção e limpeza',
  OUTRO: 'Manutenção e limpeza',
};

export function StockItemForm({
  item,
  categories,
  suppliers,
  action,
  readOnly,
}: {
  item?: Item;
  categories: Category[];
  suppliers: string[];
  action: (form: FormData) => Promise<ActionResult>;
  readOnly?: boolean;
}) {
  const { result, pending, onSubmit, errors } = useServerForm(action);
  const [kind, setKind] = useState<StockKind>(item?.kind ?? 'INSUMO');
  const suggested = (k: StockKind) => categories.find((c) => c.name === SUGGESTED_CATEGORY[k])?.id ?? '';
  const [categoryId, setCategoryId] = useState(item?.financeCategoryId ?? suggested(item?.kind ?? 'INSUMO'));

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={onSubmit} className="grid gap-6">
          <FormError result={result} />
          <fieldset disabled={readOnly || pending} className="grid gap-5 sm:grid-cols-2">
            <Field label="Nome do item" htmlFor="name" error={errors.name} className="sm:col-span-2">
              <Input id="name" name="name" defaultValue={item?.name ?? ''} placeholder="Ex.: Salmão, Tubo Push Pop, Panfleto" required />
            </Field>
            <Field label="Categoria" htmlFor="kind" error={errors.kind}>
              <Select
                name="kind"
                value={kind}
                onValueChange={(v) => {
                  setKind(v as StockKind);
                  if (!item) setCategoryId(suggested(v as StockKind));
                }}
              >
                <SelectTrigger id="kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STOCK_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {STOCK_KIND_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Unidade de medida" htmlFor="unit" error={errors.unit} hint="Como o item é contado e comprado.">
              <Select name="unit" defaultValue={item?.unit ?? 'un'}>
                <SelectTrigger id="unit" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STOCK_UNITS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {STOCK_UNIT_LABEL[u]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Estoque mínimo" htmlFor="minQty" error={errors.minQty} hint="Abaixo disso o item aparece como “repor”.">
              <Input id="minQty" name="minQty" inputMode="decimal" defaultValue={item ? String(item.minQty).replace('.', ',') : ''} placeholder="0" />
            </Field>
            <Field label="Fornecedor habitual (opcional)" htmlFor="supplier" error={errors.supplier}>
              <Input id="supplier" name="supplier" list="stock-suppliers" defaultValue={item?.supplier ?? ''} autoComplete="off" />
              <datalist id="stock-suppliers">
                {suppliers.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </Field>
            <Field label="Categoria no Financeiro" htmlFor="financeCategoryId" error={errors.financeCategoryId} hint="Onde as compras deste item entram na DRE (ex.: Insumos entram no CMV)." className="sm:col-span-2">
              <Select name="financeCategoryId" value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger id="financeCategoryId" className="w-full">
                  <SelectValue placeholder="Escolha a categoria" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <label className="flex items-center gap-3 text-sm font-medium sm:col-span-2">
              <Switch name="active" defaultChecked={item?.active ?? true} />
              Item ativo (aparece nas compras, contagens e fichas técnicas)
            </label>
          </fieldset>
          {!readOnly && (
            <div>
              <Button type="submit" disabled={pending}>
                {pending ? 'Salvando…' : item ? 'Salvar item' : 'Criar item'}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
