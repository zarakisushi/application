-- Cupons seguem as mesmas garantias das demais tabelas de negócio (ver 0001_security.sql):
-- exclusão só lógica, autoria carimbada, auditoria automática e isolamento por unidade.
CREATE TRIGGER coupons_forbid_delete BEFORE DELETE ON coupons FOR EACH ROW EXECUTE FUNCTION forbid_delete();
--> statement-breakpoint
CREATE TRIGGER coupons_stamp BEFORE INSERT OR UPDATE ON coupons FOR EACH ROW EXECUTE FUNCTION stamp_row();
--> statement-breakpoint
CREATE TRIGGER coupons_audit AFTER INSERT OR UPDATE ON coupons FOR EACH ROW EXECUTE FUNCTION audit_row();
--> statement-breakpoint
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE coupons FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON coupons
  USING (app_is_platform_admin() OR tenant_id = app_tenant_id())
  WITH CHECK (app_is_platform_admin() OR tenant_id = app_tenant_id());
