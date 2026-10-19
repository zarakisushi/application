import { describe, expect, it } from 'vitest';
import { can, PERMISSIONS, type Permission, type Role } from '../src';

const allowed = (role: Role | null, platformAdmin = false) =>
  PERMISSIONS.filter((p) => can({ role, platformAdmin }, p));

describe('permissões por papel', () => {
  it('platform admin (Matriz) pode tudo, inclusive gerir unidades', () => {
    expect(allowed(null, true)).toEqual([...PERMISSIONS]);
  });

  it('ADMIN da unidade pode tudo, menos gerir unidades', () => {
    expect(allowed('ADMIN')).toEqual(PERMISSIONS.filter((p) => p !== 'tenants:manage'));
  });

  it('GERENTE opera e vê relatórios, mas não gere usuários, auditoria nem exclui produtos', () => {
    const p = allowed('GERENTE');
    expect(p).toContain('reports:read');
    expect(p).toContain('orders:delete');
    expect(p).toContain('products:write');
    expect(p).toContain('tasks:manage');
    expect(p).toContain('suppliers:write');
    expect(p).not.toContain('suppliers:delete');
    for (const denied of ['users:manage', 'audit:read', 'products:delete', 'tenants:manage'] as Permission[]) {
      expect(p).not.toContain(denied);
    }
  });

  it('ATENDENTE cria e edita pedidos e clientes, registra no estoque e cuida das tarefas, sem excluir e sem relatórios', () => {
    expect(allowed('ATENDENTE')).toEqual([
      'orders:read',
      'orders:write',
      'customers:read',
      'customers:write',
      'products:read',
      'stock:read',
      'stock:write',
      'tasks:read',
      'tasks:write',
    ]);
  });

  it('sem vínculo com a unidade, nada é permitido', () => {
    expect(allowed(null)).toEqual([]);
  });
});
