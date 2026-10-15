-- Extratos: mesmas garantias das demais tabelas de negócio.
CREATE TRIGGER finance_statements_forbid_delete BEFORE DELETE ON finance_statements FOR EACH ROW EXECUTE FUNCTION forbid_delete();
--> statement-breakpoint
CREATE TRIGGER finance_statements_stamp BEFORE INSERT OR UPDATE ON finance_statements FOR EACH ROW EXECUTE FUNCTION stamp_row();
--> statement-breakpoint
CREATE TRIGGER finance_statements_audit AFTER INSERT OR UPDATE ON finance_statements FOR EACH ROW EXECUTE FUNCTION audit_row();
--> statement-breakpoint
ALTER TABLE finance_statements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE finance_statements FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON finance_statements
  USING (app_is_platform_admin() OR tenant_id = app_tenant_id())
  WITH CHECK (app_is_platform_admin() OR tenant_id = app_tenant_id());
--> statement-breakpoint
-- A conta, os arquivos e o ajuste do extrato precisam ser da mesma unidade (chaves estrangeiras e arrays
-- não passam pelo RLS).
CREATE FUNCTION finance_statement_same_tenant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM finance_accounts a WHERE a.id = NEW.account_id AND a.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'A conta pertence a outra unidade' USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(*) FROM finance_attachments f WHERE f.id = ANY (NEW.attachment_ids) AND f.tenant_id = NEW.tenant_id)
     <> cardinality(NEW.attachment_ids) THEN
    RAISE EXCEPTION 'Algum arquivo do extrato pertence a outra unidade' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.adjustment_entry_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM finance_entries e WHERE e.id = NEW.adjustment_entry_id AND e.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'O ajuste pertence a outra unidade' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER finance_statements_same_tenant BEFORE INSERT OR UPDATE ON finance_statements FOR EACH ROW EXECUTE FUNCTION finance_statement_same_tenant();
