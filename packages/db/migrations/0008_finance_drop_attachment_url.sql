ALTER TABLE "finance_entries" DROP COLUMN "attachment_url";--> statement-breakpoint
-- Comprovantes: exclusão só lógica, autoria e isolamento por unidade. Sem auditoria de linha
-- (o conteúdo binário não vai para a auditoria; a troca de comprovante é auditada no lançamento).
CREATE TRIGGER finance_attachments_forbid_delete BEFORE DELETE ON finance_attachments FOR EACH ROW EXECUTE FUNCTION forbid_delete();
--> statement-breakpoint
CREATE TRIGGER finance_attachments_stamp BEFORE INSERT OR UPDATE ON finance_attachments FOR EACH ROW EXECUTE FUNCTION stamp_row();
--> statement-breakpoint
ALTER TABLE finance_attachments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE finance_attachments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON finance_attachments
  USING (app_is_platform_admin() OR tenant_id = app_tenant_id())
  WITH CHECK (app_is_platform_admin() OR tenant_id = app_tenant_id());
--> statement-breakpoint
CREATE OR REPLACE FUNCTION finance_entry_same_tenant() RETURNS trigger
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
  IF NEW.attachment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM finance_attachments f WHERE f.id = NEW.attachment_id AND f.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'O comprovante pertence a outra unidade' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- Categorias padrão que são compra de mercadoria (CMV). O RLS vale também para o dono das tabelas:
-- a atualização roda como plataforma (todas as unidades) e o ajuste é desfeito em seguida.
SELECT set_config('app.platform_admin', 'on', false);
--> statement-breakpoint
UPDATE finance_categories SET cmv = true
 WHERE name IN ('Insumos: peixes e frutos do mar', 'Insumos: arroz, nori e mercearia', 'Hortifrúti', 'Bebidas', 'Embalagens');
--> statement-breakpoint
SELECT set_config('app.platform_admin', '', false);
