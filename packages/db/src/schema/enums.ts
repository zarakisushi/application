import { pgEnum } from 'drizzle-orm/pg-core';

export const tenantKind = pgEnum('tenant_kind', ['MATRIZ', 'FRANQUIA']);

export const membershipRole = pgEnum('membership_role', ['ADMIN', 'GERENTE', 'ATENDENTE']);

export const orderType = pgEnum('order_type', ['DELIVERY', 'ENCOMENDA', 'FESTA']);

export const orderStage = pgEnum('order_stage', [
  'NOVO',
  'CONFIRMADO',
  'EM_PREPARO',
  'PRONTO',
  'SAIU_PARA_ENTREGA',
  'ENTREGUE',
  'CANCELADO',
]);

export const orderSource = pgEnum('order_source', ['SITE', 'ADMIN', 'WHATSAPP', 'BALCAO']);

export const paymentMethod = pgEnum('payment_method', ['PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'DINHEIRO', 'OUTRO']);

export const calendarSyncState = pgEnum('calendar_sync_state', ['NAO_APLICA', 'PENDENTE', 'SINCRONIZADO', 'FALHA']);

export const calendarJobOp = pgEnum('calendar_job_op', ['UPSERT', 'DELETE']);

export const calendarJobState = pgEnum('calendar_job_state', ['PENDING', 'DONE', 'FAILED']);

export const couponKind = pgEnum('coupon_kind', ['PERCENT', 'FIXED']);

export const financeDirection = pgEnum('finance_direction', ['ENTRADA', 'SAIDA']);

export const financeAccountKind = pgEnum('finance_account_kind', ['CAIXA', 'BANCO', 'CARTEIRA_DIGITAL', 'OUTRO']);

export const financeDreGroup = pgEnum('finance_dre_group', [
  'RECEITA',
  'CUSTO_VARIAVEL',
  'DESPESA_FIXA',
  'IMPOSTOS',
  'ROYALTIES',
  'FINANCEIRO',
  'INVESTIMENTO',
  'OUTROS',
]);

export const financeOrigin = pgEnum('finance_origin', ['MANUAL', 'PEDIDO', 'ROYALTIES', 'AJUSTE', 'TRANSFERENCIA', 'ESTOQUE']);

export const stockKind = pgEnum('stock_kind', ['INSUMO', 'EMBALAGEM', 'MARKETING', 'OPERACIONAL', 'OUTRO']);

export const stockMovementKind = pgEnum('stock_movement_kind', ['COMPRA', 'PEDIDO', 'PERDA', 'CONSUMO', 'AJUSTE', 'ENTRADA']);
