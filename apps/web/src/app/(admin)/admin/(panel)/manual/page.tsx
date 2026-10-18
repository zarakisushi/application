import { Download, ExternalLink } from 'lucide-react';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/PageHeader';
import { ManualViewer } from '@/components/admin/manual/ManualViewer';
import { Button } from '@/components/ui/button';
import { requireAdmin } from '@/server/admin';
import { loadManual } from '@/server/manual';

export const metadata: Metadata = { title: 'Manual do sistema' };

export default async function ManualPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  await requireAdmin();
  const { busca } = await searchParams;
  const manual = loadManual();

  return (
    <>
      <PageHeader
        title="Manual do sistema"
        description={`Como usar cada parte do sistema, da operação ao acompanhamento da rede.${manual.version ? ` Versão de ${manual.version}.` : ''}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <a href="/api/manual/pdf" target="_blank" rel="noopener">
                <ExternalLink /> Abrir PDF
              </a>
            </Button>
            <Button asChild>
              <a href="/api/manual/pdf?download=1" download>
                <Download /> Baixar PDF
              </a>
            </Button>
          </div>
        }
      />
      <ManualViewer chapters={manual.chapters} search={manual.search} initialQuery={typeof busca === 'string' ? busca : ''} />
    </>
  );
}
