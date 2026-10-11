'use client';

import { ROLES, ROLE_LABEL, type Role } from '@zaraki/core';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { SecretBox } from './ConfirmAction';
import { Field, FormError, useServerForm, type ActionResult } from './form';

const ROLE_HINT: Record<Role, string> = {
  ADMIN: 'Tudo na unidade, inclusive usuários, relatórios e auditoria.',
  GERENTE: 'Pedidos, clientes, cardápio e relatórios.',
  ATENDENTE: 'Lança e atualiza pedidos e clientes.',
};

type User = { name: string; email: string; role: Role; isPlatformAdmin: boolean };

export function UserForm({
  user,
  action,
  canGrantNetwork,
  lockRole,
  readOnly,
}: {
  user?: User;
  action: (form: FormData) => Promise<ActionResult>;
  /** Quem está editando é da Matriz e pode conceder acesso à rede. */
  canGrantNetwork: boolean;
  /** Editando a si mesmo: papel e acesso à rede ficam travados. */
  lockRole?: boolean;
  readOnly?: boolean;
}) {
  const { result, pending, onSubmit, errors } = useServerForm(action);

  if (!user && result?.ok && result.secret) {
    return (
      <Card>
        <CardContent className="grid gap-4 pt-6">
          <p className="font-medium">Usuário criado. Senha provisória:</p>
          <SecretBox value={result.secret} />
          <p className="text-sm text-muted-foreground">
            Envie a senha por um canal seguro: ela aparece só agora e precisa ser trocada no primeiro acesso.
          </p>
          <Button asChild className="w-fit">
            <Link href={`/admin/usuarios/${result.id}`}>Ver usuário</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={onSubmit} className="grid gap-5">
          <FormError result={result} />
          <fieldset disabled={readOnly || pending} className="grid gap-5 sm:grid-cols-2">
            <Field label="Nome" htmlFor="name" error={errors.name}>
              <Input id="name" name="name" defaultValue={user?.name} required aria-invalid={!!errors.name} />
            </Field>
            <Field label="E-mail (login)" htmlFor="email" error={errors.email}>
              <Input id="email" name="email" type="email" defaultValue={user?.email} required aria-invalid={!!errors.email} />
            </Field>
            <Field label="Papel nesta unidade" htmlFor="role" error={errors.role} hint={lockRole ? 'Você não pode alterar o próprio papel.' : undefined}>
              {lockRole && <input type="hidden" name="role" value={user!.role} />}
              <Select name={lockRole ? undefined : 'role'} defaultValue={user?.role ?? 'ATENDENTE'} disabled={lockRole}>
                <SelectTrigger id="role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABEL[r]} — {ROLE_HINT[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {canGrantNetwork && (
              <label className="flex items-center gap-3 self-end pb-2 text-sm font-medium">
                {lockRole && user?.isPlatformAdmin && <input type="hidden" name="isPlatformAdmin" value="on" />}
                <Switch name={lockRole ? undefined : 'isPlatformAdmin'} defaultChecked={user?.isPlatformAdmin} disabled={lockRole} />
                Administrador da rede (acesso a todas as unidades)
              </label>
            )}
          </fieldset>
          {!readOnly && (
            <div>
              <Button type="submit" disabled={pending}>
                {pending ? 'Salvando…' : user ? 'Salvar usuário' : 'Criar usuário'}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
