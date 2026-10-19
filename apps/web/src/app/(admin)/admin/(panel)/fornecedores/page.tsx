import {
  formatDocument,
  SUPPLIER_CATEGORIES,
  SUPPLIER_CATEGORY_LABEL,
  WEEKDAY_SHORT,
  type SupplierCategory,
} from '@zaraki/core';
import { listSupplierCities, listSuppliers, withContext, type SupplierOrigin } from '@zaraki/db';
import { Mail, Network, Plus, Star } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { STATUS_FILTER, type ToolbarFilter } from '@/components/admin/filters';
import { ListToolbar } from '@/components/admin/ListToolbar';
import { EmptyRow, Pagination, param, readListParams } from '@/components/admin/list';
import { PageHeader } from '@/components/admin/PageHeader';
import { CallButton, WhatsappButton } from '@/components/admin/suppliers/ContactButtons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireAdmin } from '@/server/admin';

export const metadata: Metadata = { title: 'Fornecedores' };

type Row = Awaited<ReturnType<typeof listSuppliers>>['rows'][number];

const ALL = 'todas';

function Rating({ value }: { value: number | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex items-center gap-0.5" aria-label={`${value} de 5 estrelas`} title={`${value} de 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={n <= value ? 'size-3.5 fill-amber-400 text-amber-500' : 'size-3.5 text-muted-foreground/30'} aria-hidden />
      ))}
    </span>
  );
}

const days = (d: number[]) => (d.length === 0 ? '—' : d.length === 7 ? 'Todos os dias' : d.map((i) => WEEKDAY_SHORT[i]).join(', '));

function Categories({ values }: { values: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {values.map((c) => (
        <Badge key={c} variant="outline" className="font-normal">
          {SUPPLIER_CATEGORY_LABEL[c as SupplierCategory] ?? c}
        </Badge>
      ))}
    </div>
  );
}

function NameCell({ s, rating = false }: { s: Row; rating?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Link href={`/admin/fornecedores/${s.id}`} className="font-medium hover:underline">
          {s.name}
        </Link>
        {s.fromNetwork ? (
          <Badge className="gap-1 bg-brand-ink text-brand-gold-light">
            <Network className="size-3" /> Da rede
          </Badge>
        ) : s.networkShared ? (
          <Badge variant="outline" className="gap-1">
            <Network className="size-3" /> Compartilhado
          </Badge>
        ) : null}
        {!s.status && <Badge variant="outline">Excluído</Badge>}
      </div>
      {(s.legalName || s.document) && (
        <div className="mt-0.5 truncate text-xs text-muted-foreground" title={s.legalName ?? undefined}>
          {[s.document && formatDocument(s.document), s.legalName].filter(Boolean).join(' · ')}
        </div>
      )}
      {rating && s.rating ? (
        <div className="mt-1">
          <Rating value={s.rating} />
        </div>
      ) : null}
    </div>
  );
}

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const ctx = await requireAdmin('suppliers:read');
  const sp = await searchParams;
  const params = readListParams(sp);
  const category = param(sp.categoria);
  const city = param(sp.cidade);
  const day = param(sp.entrega);
  const origin = (['meus', 'rede'].includes(param(sp.origem) ?? '') ? param(sp.origem) : 'todos') as SupplierOrigin;
  const unitName = ctx.tenant.name;

  const { page, cities } = await withContext(ctx.db, async (tx) => ({
    page: await listSuppliers(tx, ctx.tenant.id, {
      ...params,
      category: (SUPPLIER_CATEGORIES as readonly string[]).includes(category ?? '') ? (category as SupplierCategory) : undefined,
      city: city && city !== ALL ? city : undefined,
      deliveryDay: day && /^[0-6]$/.test(day) ? Number(day) : undefined,
      origin,
    }),
    cities: await listSupplierCities(tx, ctx.tenant.id),
  }));

  const filters: ToolbarFilter[] = [
    {
      name: 'categoria',
      label: 'Categoria',
      value: category ?? ALL,
      options: [{ value: ALL, label: 'Todas as categorias' }, ...SUPPLIER_CATEGORIES.map((c) => ({ value: c, label: SUPPLIER_CATEGORY_LABEL[c] }))],
    },
    { name: 'cidade', label: 'Cidade', value: city ?? ALL, options: [{ value: ALL, label: 'Todas as cidades' }, ...cities.map((c) => ({ value: c, label: c }))] },
    {
      name: 'entrega',
      label: 'Dia de entrega',
      value: day ?? ALL,
      options: [{ value: ALL, label: 'Qualquer dia' }, ...WEEKDAY_SHORT.map((d, i) => ({ value: String(i), label: `Entrega ${d.toLowerCase()}` }))],
    },
    {
      name: 'origem',
      label: 'Origem',
      value: origin,
      options: [
        { value: 'todos', label: ctx.tenant.kind === 'MATRIZ' ? 'Todos' : 'Meus e da rede' },
        { value: 'meus', label: 'Só os meus' },
        ...(ctx.tenant.kind === 'MATRIZ' ? [] : [{ value: 'rede', label: 'Só os da rede' }]),
      ],
    },
    STATUS_FILTER(params.status),
  ];

  return (
    <>
      <PageHeader
        title="Fornecedores"
        description={
          ctx.tenant.kind === 'MATRIZ'
            ? 'Os fornecedores da Matriz. Os marcados como compartilhados aparecem para as franquias.'
            : 'Os seus fornecedores e os indicados pela Matriz (da rede).'
        }
        actions={
          ctx.can('suppliers:write') && (
            <Button asChild>
              <Link href="/admin/fornecedores/novo">
                <Plus /> Novo fornecedor
              </Link>
            </Button>
          )
        }
      />
      <ListToolbar q={params.q} placeholder="Buscar por nome, CNPJ, contato, telefone ou cidade" filters={filters} />

      {/* Computador: grade */}
      <Card className="hidden py-0 lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Fornecedor</TableHead>
              <TableHead>Categorias</TableHead>
              <TableHead>Contato</TableHead>
              <TableHead>WhatsApp e telefone</TableHead>
              <TableHead className="pr-6">Cidade e entrega</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.rows.length === 0 && <EmptyRow colSpan={5}>Nenhum fornecedor encontrado.</EmptyRow>}
            {page.rows.map((s) => (
              <TableRow key={s.id} data-testid="supplier-row">
                <TableCell className="w-64 max-w-64 pl-6 whitespace-normal">
                  <NameCell s={s} rating />
                </TableCell>
                <TableCell className="max-w-44 whitespace-normal">
                  <Categories values={s.categories} />
                </TableCell>
                <TableCell className="max-w-44 whitespace-normal">
                  {s.contactName ?? <span className="text-muted-foreground">—</span>}
                  {s.email && (
                    <a href={`mailto:${s.email}`} title={s.email} className="flex items-center gap-1 text-xs text-muted-foreground hover:underline">
                      <Mail className="size-3 shrink-0" /> <span className="truncate">{s.email}</span>
                    </a>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-start gap-1.5">
                    {s.whatsapp && <WhatsappButton number={s.whatsapp} unitName={unitName} />}
                    {s.phone && <CallButton number={s.phone} />}
                    {!s.whatsapp && !s.phone && <span className="text-muted-foreground">—</span>}
                  </div>
                </TableCell>
                <TableCell className="pr-6 whitespace-normal">
                  <div>{s.city ? `${s.city}${s.state ? `/${s.state}` : ''}` : '—'}</div>
                  {s.deliveryDays.length > 0 && <div className="text-xs text-muted-foreground">Entrega: {days(s.deliveryDays)}</div>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Celular e tablet: cartões com os botões grandes */}
      <ul className="grid gap-3 sm:grid-cols-2 lg:hidden" aria-label="Fornecedores">
        {page.rows.length === 0 && <li className="rounded-xl border bg-card p-6 text-center text-muted-foreground sm:col-span-2">Nenhum fornecedor encontrado.</li>}
        {page.rows.map((s) => (
          <li key={s.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4" data-testid="supplier-card">
            <div className="flex items-start justify-between gap-2">
              <NameCell s={s} />
              <Rating value={s.rating} />
            </div>
            <Categories values={s.categories} />
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Contato</dt>
                <dd>{s.contactName ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Entrega</dt>
                <dd>{days(s.deliveryDays)}</dd>
              </div>
            </dl>
            {(s.whatsapp || s.phone) && (
              <div className="grid grid-cols-2 gap-2">
                {s.whatsapp && <WhatsappButton number={s.whatsapp} unitName={unitName} label="WhatsApp" className="justify-center py-2.5 text-base" />}
                {(s.phone ?? s.whatsapp) && <CallButton number={(s.phone ?? s.whatsapp)!} label="Ligar" className="justify-center py-2.5 text-base" />}
              </div>
            )}
          </li>
        ))}
      </ul>
      <Pagination page={page.page} pages={page.pages} total={page.total} basePath="/admin/fornecedores" searchParams={sp} />
    </>
  );
}
