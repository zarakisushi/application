-- Histórico de um pedido busca itens e mudanças de etapa pelo order_id gravado na auditoria;
-- o de um usuário, credenciais e vínculos pelo user_id.
CREATE INDEX audit_logs_order_ref_idx ON audit_logs ((after ->> 'order_id'))
  WHERE entity IN ('order_items', 'order_stage_history');
--> statement-breakpoint
CREATE INDEX audit_logs_user_ref_idx ON audit_logs ((after ->> 'user_id'))
  WHERE entity IN ('accounts', 'memberships');
