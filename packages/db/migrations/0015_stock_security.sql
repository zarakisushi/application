-- Estoque: mesmas garantias das demais tabelas de negócio (exclusão só lógica, autoria, auditoria e
-- isolamento por unidade).
CREATE TRIGGER stock_items_forbid_delete BEFORE DELETE ON stock_items FOR EACH ROW EXECUTE FUNCTION forbid_delete();
--> statement-breakpoint
CREATE TRIGGER stock_items_stamp BEFORE INSERT OR UPDATE ON stock_items FOR EACH ROW EXECUTE FUNCTION stamp_row();
--> statement-breakpoint
CREATE TRIGGER stock_items_audit AFTER INSERT OR UPDATE ON stock_items FOR EACH ROW EXECUTE FUNCTION audit_row();
--> statement-breakpoint
ALTER TABLE stock_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE stock_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON stock_items
  USING (app_is_platform_admin() OR tenant_id = app_tenant_id())
  WITH CHECK (app_is_platform_admin() OR tenant_id = app_tenant_id());
--> statement-breakpoint
CREATE TRIGGER stock_purchases_forbid_delete BEFORE DELETE ON stock_purchases FOR EACH ROW EXECUTE FUNCTION forbid_delete();
--> statement-breakpoint
CREATE TRIGGER stock_purchases_stamp BEFORE INSERT OR UPDATE ON stock_purchases FOR EACH ROW EXECUTE FUNCTION stamp_row();
--> statement-breakpoint
CREATE TRIGGER stock_purchases_audit AFTER INSERT OR UPDATE ON stock_purchases FOR EACH ROW EXECUTE FUNCTION audit_row();
--> statement-breakpoint
ALTER TABLE stock_purchases ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE stock_purchases FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON stock_purchases
  USING (app_is_platform_admin() OR tenant_id = app_tenant_id())
  WITH CHECK (app_is_platform_admin() OR tenant_id = app_tenant_id());
--> statement-breakpoint
CREATE TRIGGER stock_movements_forbid_delete BEFORE DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION forbid_delete();
--> statement-breakpoint
CREATE TRIGGER stock_movements_stamp BEFORE INSERT OR UPDATE ON stock_movements FOR EACH ROW EXECUTE FUNCTION stamp_row();
--> statement-breakpoint
CREATE TRIGGER stock_movements_audit AFTER INSERT OR UPDATE ON stock_movements FOR EACH ROW EXECUTE FUNCTION audit_row();
--> statement-breakpoint
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE stock_movements FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON stock_movements
  USING (app_is_platform_admin() OR tenant_id = app_tenant_id())
  WITH CHECK (app_is_platform_admin() OR tenant_id = app_tenant_id());
--> statement-breakpoint
CREATE TRIGGER product_recipes_forbid_delete BEFORE DELETE ON product_recipes FOR EACH ROW EXECUTE FUNCTION forbid_delete();
--> statement-breakpoint
CREATE TRIGGER product_recipes_stamp BEFORE INSERT OR UPDATE ON product_recipes FOR EACH ROW EXECUTE FUNCTION stamp_row();
--> statement-breakpoint
CREATE TRIGGER product_recipes_audit AFTER INSERT OR UPDATE ON product_recipes FOR EACH ROW EXECUTE FUNCTION audit_row();
--> statement-breakpoint
ALTER TABLE product_recipes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE product_recipes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON product_recipes
  USING (app_is_platform_admin() OR tenant_id = app_tenant_id())
  WITH CHECK (app_is_platform_admin() OR tenant_id = app_tenant_id());
--> statement-breakpoint
-- Chaves estrangeiras não passam pelo RLS: cada referência precisa ser da mesma unidade.
CREATE FUNCTION stock_same_tenant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ref text;
BEGIN
  IF TG_TABLE_NAME = 'stock_items' THEN
    IF NEW.finance_category_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM finance_categories c WHERE c.id = NEW.finance_category_id AND c.tenant_id = NEW.tenant_id) THEN v_ref := 'A categoria'; END IF;
  ELSIF TG_TABLE_NAME = 'stock_purchases' THEN
    IF NEW.attachment_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM finance_attachments f WHERE f.id = NEW.attachment_id AND f.tenant_id = NEW.tenant_id) THEN v_ref := 'A nota fiscal'; END IF;
    IF (SELECT count(*) FROM finance_entries e WHERE e.id = ANY (NEW.finance_entry_ids) AND e.tenant_id = NEW.tenant_id)
       <> cardinality(NEW.finance_entry_ids) THEN v_ref := 'Um lançamento da compra'; END IF;
  ELSIF TG_TABLE_NAME = 'stock_movements' THEN
    IF NOT EXISTS (SELECT 1 FROM stock_items i WHERE i.id = NEW.item_id AND i.tenant_id = NEW.tenant_id) THEN v_ref := 'O item';
    ELSIF NEW.order_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM orders o WHERE o.id = NEW.order_id AND o.tenant_id = NEW.tenant_id) THEN v_ref := 'O pedido';
    ELSIF NEW.purchase_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM stock_purchases p WHERE p.id = NEW.purchase_id AND p.tenant_id = NEW.tenant_id) THEN v_ref := 'A compra';
    END IF;
  ELSIF TG_TABLE_NAME = 'product_recipes' THEN
    IF NOT EXISTS (SELECT 1 FROM products p WHERE p.id = NEW.product_id AND p.tenant_id = NEW.tenant_id) THEN v_ref := 'O sabor';
    ELSIF NOT EXISTS (SELECT 1 FROM stock_items i WHERE i.id = NEW.item_id AND i.tenant_id = NEW.tenant_id) THEN v_ref := 'O item';
    END IF;
  END IF;
  IF v_ref IS NOT NULL THEN
    RAISE EXCEPTION '% pertence a outra unidade', v_ref USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER stock_items_same_tenant BEFORE INSERT OR UPDATE ON stock_items FOR EACH ROW EXECUTE FUNCTION stock_same_tenant();
--> statement-breakpoint
CREATE TRIGGER stock_purchases_same_tenant BEFORE INSERT OR UPDATE ON stock_purchases FOR EACH ROW EXECUTE FUNCTION stock_same_tenant();
--> statement-breakpoint
CREATE TRIGGER stock_movements_same_tenant BEFORE INSERT OR UPDATE ON stock_movements FOR EACH ROW EXECUTE FUNCTION stock_same_tenant();
--> statement-breakpoint
CREATE TRIGGER product_recipes_same_tenant BEFORE INSERT OR UPDATE ON product_recipes FOR EACH ROW EXECUTE FUNCTION stock_same_tenant();
