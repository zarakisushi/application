import { ROLE_LABEL } from '@zaraki/core';
import { cookies } from 'next/headers';
import { AppSidebar } from '@/components/admin/AppSidebar';
import { ALL_NAV_ITEMS } from '@/components/admin/nav';
import { TenantSwitcher } from '@/components/admin/TenantSwitcher';
import { UserMenu } from '@/components/admin/UserMenu';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/sonner';
import { requireAdmin } from '@/server/admin';

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAdmin();
  // Preferência "ícones + textos" / "apenas ícones" lida no servidor: a página não pisca ao carregar.
  const defaultOpen = (await cookies()).get('sidebar_state')?.value !== 'false';
  const allowed = ALL_NAV_ITEMS.filter((i) => !i.permission || ctx.can(i.permission)).map((i) => i.href);
  const roleLabel = ctx.platformAdmin ? 'Administrador da rede (Matriz)' : ROLE_LABEL[ctx.tenant.role];

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar allowed={allowed} tenantName={ctx.tenant.name} />
      {/* min-w-0: tabelas largas rolam dentro do cartão em vez de alargar a página */}
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" aria-label="Abrir ou recolher o menu" />
          <Separator orientation="vertical" className="h-5" />
          <div className="flex flex-1 items-center justify-end gap-3">
            <TenantSwitcher
              tenants={ctx.tenants.map(({ id, name, kind }) => ({ id, name, kind }))}
              activeId={ctx.tenant.id}
            />
            <UserMenu name={ctx.user.name} email={ctx.user.email} roleLabel={roleLabel} />
          </div>
        </header>
        <div className="min-w-0 flex-1 p-4 md:p-6 lg:p-8">{children}</div>
      </SidebarInset>
      <Toaster richColors position="bottom-right" />
    </SidebarProvider>
  );
}
