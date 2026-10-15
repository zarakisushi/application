import { History } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RecordHistory, type AuditRow } from './audit';

/**
 * Abas "Cadastro" e "Histórico" das fichas. Sem permissão de auditoria (history = null),
 * mostra só o cadastro.
 */
export function RecordTabs({
  children,
  history,
  timezone,
  mainLabel = 'Cadastro',
}: {
  children: React.ReactNode;
  history: AuditRow[] | null;
  timezone: string;
  mainLabel?: string;
}) {
  if (!history) return <>{children}</>;
  return (
    <Tabs defaultValue="cadastro" className="gap-4">
      <TabsList>
        <TabsTrigger value="cadastro">{mainLabel}</TabsTrigger>
        <TabsTrigger value="historico">
          <History /> Histórico
        </TabsTrigger>
      </TabsList>
      <TabsContent value="cadastro">{children}</TabsContent>
      <TabsContent value="historico">
        <Card>
          <CardContent>
            <RecordHistory rows={history} timezone={timezone} />
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
