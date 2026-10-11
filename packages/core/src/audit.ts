import { formatCents } from './money';
import {
  ORDER_SOURCE_LABEL,
  ORDER_TYPE_LABEL,
  PAYMENT_METHOD_LABEL,
  type OrderSource,
  type OrderType,
  type PaymentMethod,
} from './order';
import { ROLE_LABEL, type Role } from './permissions';
import { formatBrPhone } from './phone';
import { STAGE_LABEL, type OrderStage } from './stages';

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  CREATE: 'Criação',
  UPDATE: 'Alteração',
  SOFT_DELETE: 'Exclusão',
  RESTORE: 'Restauração',
  LOGIN: 'Login',
  LOGIN_FAILED: 'Login recusado',
  LOGIN_BLOCKED: 'Login bloqueado',
  LOGOUT: 'Saída',
  PASSWORD_CHANGED: 'Senha trocada',
  PASSWORD_RESET: 'Senha redefinida',
  PERMISSION_DENIED: 'Acesso negado',
  CALENDAR_SYNC_FAILED: 'Falha na agenda',
  AUDIT_VERIFIED: 'Verificação de integridade',
  EXPORT: 'Exportação',
};

export const AUDIT_ENTITY_LABEL: Record<string, string> = {
  orders: 'Pedido',
  order_items: 'Item do pedido',
  order_stage_history: 'Etapa do pedido',
  customers: 'Cliente',
  products: 'Sabor do cardápio',
  users: 'Usuário',
  accounts: 'Credencial de acesso',
  memberships: 'Acesso à unidade',
  tenants: 'Unidade',
  permission: 'Permissão',
  audit_logs: 'Auditoria',
  report: 'Relatório',
};

/** Campos técnicos que não ajudam a entender a mudança. */
const HIDDEN = new Set(['id', 'tenant_id', 'created_at', 'created_by', 'updated_at', 'updated_by', 'order_id', 'user_id', 'customer_id', 'product_id', 'account_id', 'provider_id', 'google_event_id']);

const FIELD_LABEL: Record<string, string> = {
  status: 'Situação',
  name: 'Nome',
  slug: 'Identificador',
  description: 'Descrição',
  price_cents: 'Preço',
  cost_cents: 'Custo',
  image_url: 'Imagem',
  is_special: 'Especial',
  sort_order: 'Ordem',
  phone: 'Telefone',
  email: 'E-mail',
  birthday: 'Aniversário',
  neighborhood: 'Bairro',
  address: 'Endereço',
  notes: 'Observações',
  code: 'Código',
  type: 'Tipo',
  stage: 'Etapa',
  scheduled_at: 'Data marcada',
  guests: 'Convidados',
  subtotal_cents: 'Subtotal',
  discount_cents: 'Desconto',
  delivery_fee_cents: 'Taxa de entrega',
  total_cents: 'Total',
  source: 'Origem',
  payment_method: 'Pagamento',
  paid: 'Pago',
  cancel_reason: 'Motivo do cancelamento',
  calendar_sync_state: 'Agenda',
  product_name: 'Sabor',
  unit_price_cents: 'Preço unitário',
  unit_cost_cents: 'Custo unitário',
  qty: 'Quantidade',
  line_total_cents: 'Total do item',
  from_stage: 'Etapa anterior',
  to_stage: 'Nova etapa',
  note: 'Observação',
  role: 'Papel',
  is_platform_admin: 'Administrador da rede',
  must_change_password: 'Troca de senha pendente',
  email_verified: 'E-mail verificado',
  kind: 'Tipo de unidade',
  cnpj: 'CNPJ',
  city: 'Cidade',
  domain: 'Domínio',
  whatsapp_number: 'WhatsApp',
  calendar_id: 'Google Agenda',
  timezone: 'Fuso horário',
  royalty_pct: 'Royalties (%)',
  order_code_prefix: 'Prefixo dos pedidos',
  permission: 'Permissão',
  error: 'Erro',
  attempts: 'Tentativas',
};

const CALENDAR_STATE_LABEL: Record<string, string> = {
  NAO_APLICA: 'Fora da agenda',
  PENDENTE: 'Pendente',
  SINCRONIZADO: 'Na agenda',
  FALHA: 'Falhou',
};

export const auditFieldLabel = (field: string) => FIELD_LABEL[field] ?? field;

/** Campo que vale mostrar para quem lê a auditoria (esconde ids e carimbos técnicos). */
export const isAuditFieldVisible = (field: string) => !HIDDEN.has(field);

/** Valor de um campo da auditoria em texto legível. */
export function formatAuditValue(field: string, value: unknown, timeZone: string): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'status') return value ? 'Ativo' : 'Excluído';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (field.endsWith('_cents') && typeof value === 'number') return formatCents(value);
  if (field === 'stage' || field === 'from_stage' || field === 'to_stage') return STAGE_LABEL[value as OrderStage] ?? String(value);
  if (field === 'type' && typeof value === 'string' && value in ORDER_TYPE_LABEL) return ORDER_TYPE_LABEL[value as OrderType];
  if (field === 'role') return ROLE_LABEL[value as Role] ?? String(value);
  if (field === 'source') return ORDER_SOURCE_LABEL[value as OrderSource] ?? String(value);
  if (field === 'payment_method') return PAYMENT_METHOD_LABEL[value as PaymentMethod] ?? String(value);
  if (field === 'calendar_sync_state') return CALENDAR_STATE_LABEL[String(value)] ?? String(value);
  if ((field === 'phone' || field === 'whatsapp_number') && typeof value === 'string') return formatBrPhone(value);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value.split('-').reverse().join('/');
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    return new Intl.DateTimeFormat('pt-BR', { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export type AuditEntry = {
  action: string;
  entity: string;
  changedFields: string[] | null;
  before: unknown;
  after: unknown;
};

export type AuditChange = { field: string; label: string; before: string; after: string };

const asRecord = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/**
 * Mudanças de um registro da auditoria, campo a campo:
 * alteração/exclusão/restauração → só os campos alterados; criação → os campos preenchidos;
 * eventos (login, falha na agenda...) → os detalhes do evento.
 */
export function auditChanges(entry: AuditEntry, timeZone: string): AuditChange[] {
  const before = asRecord(entry.before);
  const after = asRecord(entry.after);
  const fields =
    entry.changedFields?.length
      ? entry.changedFields
      : Object.keys(after).filter((k) => after[k] !== null && after[k] !== '' && after[k] !== false);
  return fields
    .filter(isAuditFieldVisible)
    .map((field) => ({
      field,
      label: auditFieldLabel(field),
      before: entry.action === 'CREATE' || !entry.before ? '—' : formatAuditValue(field, before[field], timeZone),
      after: formatAuditValue(field, after[field], timeZone),
    }));
}

/** Nome curto do registro afetado (nome, código ou e-mail), quando houver. */
export function auditRecordTitle(entry: Pick<AuditEntry, 'before' | 'after'>): string | null {
  const data = { ...asRecord(entry.before), ...asRecord(entry.after) };
  const title = data.code ?? data.name ?? data.product_name ?? data.email;
  return typeof title === 'string' ? title : null;
}

const SYSTEM_ACTOR: Record<string, string> = {
  site: 'Site (cliente)',
  agenda: 'Google Agenda (automático)',
  seed: 'Instalação do sistema',
  cli: 'Terminal (administração)',
};

/** Quem fez: nome do usuário; senão, o rótulo do processo (site, agenda...) ou o e-mail usado no login. */
export function auditActor(actorName: string | null, actorLabel: string | null): string {
  if (actorName) return actorName;
  if (actorLabel) return SYSTEM_ACTOR[actorLabel] ?? actorLabel;
  return 'Sistema';
}
