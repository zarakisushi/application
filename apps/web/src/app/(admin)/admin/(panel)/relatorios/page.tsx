import { REPORTS } from '@zaraki/db';
import { ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/admin/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireAdmin } from '@/server/admin';
import { canSeeReport } from '@/server/reports';

export const metadata: Metadata = { title: 'Relatórios' };

const GROUP_HINT: Record<string, string> = {
  Vendas: 'Faturamento realizado = pedidos entregues, pela data do pedido (ou da festa/evento).',
  Financeiro: 'A partir dos lançamentos do Financeiro. Na Matriz, “Todas as unidades” consolida a rede.',
  Estoque: 'Saldos, entradas e saídas, e perdas avaliadas pelo custo médio de compra.',
  Franquia: 'Visão de toda a rede — exclusivo da Matriz.',
  Governança: 'Construídos a partir da auditoria.',
};

export default async function ReportsPage() {
  const ctx = await requireAdmin('reports:read');
  const visible = REPORTS.filter((r) => canSeeReport(ctx, r));
  const groups = [...new Set(visible.map((r) => r.group))];

  return (
    <>
      <PageHeader title="Relatórios" description="Indicadores da operação da Zaraki. Todos podem ser filtrados por período e exportados em CSV." />
      <div className="grid gap-8">
        {groups.map((group) => (
          <section key={group} aria-labelledby={`g-${group}`}>
            <h2 id={`g-${group}`} className="font-display text-lg font-bold">
              {group}
            </h2>
            {GROUP_HINT[group] && <p className="mb-3 text-sm text-muted-foreground">{GROUP_HINT[group]}</p>}
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visible
                .filter((r) => r.group === group)
                .map((r) => (
                  <Link key={r.slug} href={`/admin/relatorios/${r.slug}`} className="group">
                    <Card className="h-full transition-colors group-hover:border-brand-gold">
                      <CardHeader>
                        <CardTitle className="flex items-center justify-between gap-2 text-base">
                          {r.title}
                          <ChevronRight className="size-4 text-muted-foreground" />
                        </CardTitle>
                        <CardDescription>{r.description}</CardDescription>
                      </CardHeader>
                    </Card>
                  </Link>
                ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
