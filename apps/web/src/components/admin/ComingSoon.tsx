import { Hammer } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from './PageHeader';

/** Página de módulo ainda não entregue (o acesso e a permissão já valem). */
export function ComingSoon({ title, description, phase }: { title: string; description: string; phase: number }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <Hammer className="size-8 text-brand-gold" />
          <p className="font-medium">Este módulo chega na fase {phase} do projeto.</p>
          <p className="max-w-md text-sm text-muted-foreground">
            O menu, o acesso e as permissões já estão ativos; as telas de gestão serão liberadas aqui.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
