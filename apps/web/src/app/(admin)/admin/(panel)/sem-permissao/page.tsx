import { ShieldX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { requireAdmin } from '@/server/admin';

export const metadata: Metadata = { title: 'Sem permissão' };

export default async function NoPermissionPage() {
  await requireAdmin();
  return (
    <Card className="mx-auto max-w-lg">
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <ShieldX className="size-10 text-brand-red" />
        <h1 className="font-display text-xl font-bold">Sem permissão</h1>
        <p className="text-sm text-muted-foreground">
          Seu perfil não tem acesso a esta área. Se precisar, fale com o administrador da sua unidade.
        </p>
        <Button asChild className="mt-2">
          <Link href="/admin">Voltar ao início</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
