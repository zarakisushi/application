-- Fornecedores: exclusão só lógica, autoria, auditoria e isolamento por unidade. Exceção à leitura: os
-- fornecedores que a Matriz compartilha com a rede ficam visíveis (só para leitura) a todas as unidades.
CREATE TRIGGER suppliers_forbid_delete BEFORE DELETE ON suppliers FOR EACH ROW EXECUTE FUNCTION forbid_delete();
--> statement-breakpoint
CREATE TRIGGER suppliers_stamp BEFORE INSERT OR UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION stamp_row();
--> statement-breakpoint
CREATE TRIGGER suppliers_audit AFTER INSERT OR UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION audit_row();
--> statement-breakpoint
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE suppliers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY suppliers_read ON suppliers FOR SELECT
  USING (
    app_is_platform_admin()
    OR tenant_id = app_tenant_id()
    OR (network_shared AND status AND EXISTS (SELECT 1 FROM tenants t WHERE t.id = suppliers.tenant_id AND t.kind = 'MATRIZ'))
  );
--> statement-breakpoint
CREATE POLICY suppliers_insert ON suppliers FOR INSERT
  WITH CHECK (app_is_platform_admin() OR tenant_id = app_tenant_id());
--> statement-breakpoint
CREATE POLICY suppliers_update ON suppliers FOR UPDATE
  USING (app_is_platform_admin() OR tenant_id = app_tenant_id())
  WITH CHECK (app_is_platform_admin() OR tenant_id = app_tenant_id());
--> statement-breakpoint
-- Só a Matriz compartilha fornecedores com a rede, e uma cópia só pode vir de um fornecedor da rede.
CREATE FUNCTION supplier_rules() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.network_shared AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = NEW.tenant_id AND t.kind = 'MATRIZ') THEN
    RAISE EXCEPTION 'Só a Matriz compartilha fornecedores com a rede' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.copied_from_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.copied_from_id IS DISTINCT FROM OLD.copied_from_id)
     AND NOT EXISTS (
       SELECT 1 FROM suppliers s JOIN tenants t ON t.id = s.tenant_id
        WHERE s.id = NEW.copied_from_id AND s.network_shared AND t.kind = 'MATRIZ') THEN
    RAISE EXCEPTION 'A cópia precisa vir de um fornecedor da rede' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER suppliers_rules BEFORE INSERT OR UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION supplier_rules();
