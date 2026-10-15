/** Tela do registro afetado por uma entrada da auditoria (quando existe uma). */
export function auditRecordHref(entity: string, entityId: string | null, data: unknown): string | null {
  const record = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  switch (entity) {
    case 'products':
      return entityId && `/admin/cardapio/${entityId}`;
    case 'customers':
      return entityId && `/admin/clientes/${entityId}`;
    case 'orders':
      // A ficha redireciona para a seção certa (pedidos ou encomendas).
      return entityId && `/admin/pedidos/${entityId}`;
    case 'order_items':
    case 'order_stage_history':
      return typeof record.order_id === 'string' ? `/admin/pedidos/${record.order_id}` : null;
    case 'users':
      return entityId && `/admin/usuarios/${entityId}`;
    case 'memberships':
    case 'accounts':
      return typeof record.user_id === 'string' ? `/admin/usuarios/${record.user_id}` : null;
    case 'tenants':
      return entityId && `/admin/unidades/${entityId}`;
    default:
      return null;
  }
}
