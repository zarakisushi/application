-- Financeiro: mesmas garantias das demais tabelas de negócio (ver 0001_security.sql):
-- exclusão só lógica, autoria carimbada, auditoria automática e isolamento por unidade.
CREATE TRIGGER finance_accounts_forbid_delete BEFORE DELETE ON finance_accounts FOR EACH ROW EXECUTE FUNCTION forbid_delete();
--> statement-breakpoint
CREATE TRIGGER finance_accounts_stamp BEFORE INSERT OR UPDATE ON finance_accounts FOR EACH ROW EXECUTE FUNCTION stamp_row();
--> statement-breakpoint
CREATE TRIGGER finance_accounts_audit AFTER INSERT OR UPDATE ON finance_accounts FOR EACH ROW EXECUTE FUNCTION audit_row();
--> statement-breakpoint
ALTER TABLE finance_accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE finance_accounts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON finance_accounts
  USING (app_is_platform_admin() OR tenant_id = app_tenant_id())
  WITH CHECK (app_is_platform_admin() OR tenant_id = app_tenant_id());
--> statement-breakpoint
CREATE TRIGGER finance_categories_forbid_delete BEFORE DELETE ON finance_categories FOR EACH ROW EXECUTE FUNCTION forbid_delete();
--> statement-breakpoint
CREATE TRIGGER finance_categories_stamp BEFORE INSERT OR UPDATE ON finance_categories FOR EACH ROW EXECUTE FUNCTION stamp_row();
--> statement-breakpoint
CREATE TRIGGER finance_categories_audit AFTER INSERT OR UPDATE ON finance_categories FOR EACH ROW EXECUTE FUNCTION audit_row();
--> statement-breakpoint
ALTER TABLE finance_categories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE finance_categories FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON finance_categories
  USING (app_is_platform_admin() OR tenant_id = app_tenant_id())
  WITH CHECK (app_is_platform_admin() OR tenant_id = app_tenant_id());
--> statement-breakpoint
CREATE TRIGGER finance_entries_forbid_delete BEFORE DELETE ON finance_entries FOR EACH ROW EXECUTE FUNCTION forbid_delete();
--> statement-breakpoint
CREATE TRIGGER finance_entries_stamp BEFORE INSERT OR UPDATE ON finance_entries FOR EACH ROW EXECUTE FUNCTION stamp_row();
--> statement-breakpoint
CREATE TRIGGER finance_entries_audit AFTER INSERT OR UPDATE ON finance_entries FOR EACH ROW EXECUTE FUNCTION audit_row();
--> statement-breakpoint
ALTER TABLE finance_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE finance_entries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON finance_entries
  USING (app_is_platform_admin() OR tenant_id = app_tenant_id())
  WITH CHECK (app_is_platform_admin() OR tenant_id = app_tenant_id());
--> statement-breakpoint
-- Chaves estrangeiras não passam pelo RLS: sem esta checagem, um lançamento poderia apontar para a
-- conta, a categoria ou o pedido de outra unidade. Roda como dono para enxergar as três tabelas.
CREATE FUNCTION finance_entry_same_tenant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM finance_categories c WHERE c.id = NEW.category_id AND c.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'A categoria pertence a outra unidade' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM finance_accounts a WHERE a.id = NEW.account_id AND a.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'A conta pertence a outra unidade' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.order_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM orders o WHERE o.id = NEW.order_id AND o.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'O pedido pertence a outra unidade' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER finance_entries_same_tenant BEFORE INSERT OR UPDATE ON finance_entries FOR EACH ROW EXECUTE FUNCTION finance_entry_same_tenant();
