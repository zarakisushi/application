-- Royalties e fechamento de mês: mesmas garantias das demais tabelas de negócio.
CREATE TRIGGER royalty_charges_forbid_delete BEFORE DELETE ON royalty_charges FOR EACH ROW EXECUTE FUNCTION forbid_delete();
--> statement-breakpoint
CREATE TRIGGER royalty_charges_stamp BEFORE INSERT OR UPDATE ON royalty_charges FOR EACH ROW EXECUTE FUNCTION stamp_row();
--> statement-breakpoint
CREATE TRIGGER royalty_charges_audit AFTER INSERT OR UPDATE ON royalty_charges FOR EACH ROW EXECUTE FUNCTION audit_row();
--> statement-breakpoint
ALTER TABLE royalty_charges ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE royalty_charges FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- A franquia vê as próprias cobranças; a Matriz vê as que tem a receber.
CREATE POLICY tenant_isolation ON royalty_charges
  USING (app_is_platform_admin() OR tenant_id = app_tenant_id() OR matriz_tenant_id = app_tenant_id())
  WITH CHECK (app_is_platform_admin() OR tenant_id = app_tenant_id());
--> statement-breakpoint
CREATE TRIGGER finance_closings_forbid_delete BEFORE DELETE ON finance_closings FOR EACH ROW EXECUTE FUNCTION forbid_delete();
--> statement-breakpoint
CREATE TRIGGER finance_closings_stamp BEFORE INSERT OR UPDATE ON finance_closings FOR EACH ROW EXECUTE FUNCTION stamp_row();
--> statement-breakpoint
CREATE TRIGGER finance_closings_audit AFTER INSERT OR UPDATE ON finance_closings FOR EACH ROW EXECUTE FUNCTION audit_row();
--> statement-breakpoint
ALTER TABLE finance_closings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE finance_closings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON finance_closings
  USING (app_is_platform_admin() OR tenant_id = app_tenant_id())
  WITH CHECK (app_is_platform_admin() OR tenant_id = app_tenant_id());
--> statement-breakpoint
CREATE FUNCTION finance_month_closed(p_tenant uuid, p_day date) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_day IS NOT NULL AND EXISTS (
    SELECT 1 FROM finance_closings c
     WHERE c.tenant_id = p_tenant AND c.status AND c.month = date_trunc('month', p_day)::date
  );
$$;
--> statement-breakpoint
-- Mês fechado: nada muda na DRE (competência) nem no caixa (pagamentos) daquele mês. Pagar hoje uma
-- conta de competência fechada continua permitido: o pagamento é caixa do mês atual e a DRE não muda.
CREATE FUNCTION finance_entry_closed_month() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_day date;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF finance_month_closed(NEW.tenant_id, NEW.competence_date) THEN v_day := NEW.competence_date;
    ELSIF finance_month_closed(NEW.tenant_id, NEW.paid_on) THEN v_day := NEW.paid_on;
    END IF;
  ELSE
    -- Mudança que afeta a DRE do mês de competência.
    IF (OLD.amount_cents, OLD.direction, OLD.category_id, OLD.competence_date, OLD.status)
       IS DISTINCT FROM (NEW.amount_cents, NEW.direction, NEW.category_id, NEW.competence_date, NEW.status) THEN
      IF finance_month_closed(NEW.tenant_id, OLD.competence_date) THEN v_day := OLD.competence_date;
      ELSIF finance_month_closed(NEW.tenant_id, NEW.competence_date) THEN v_day := NEW.competence_date;
      END IF;
    END IF;
    -- Mudança que afeta o caixa do mês do pagamento.
    IF v_day IS NULL AND (OLD.paid_on, OLD.amount_cents, OLD.account_id, OLD.direction, OLD.status)
       IS DISTINCT FROM (NEW.paid_on, NEW.amount_cents, NEW.account_id, NEW.direction, NEW.status) THEN
      IF finance_month_closed(NEW.tenant_id, OLD.paid_on) THEN v_day := OLD.paid_on;
      ELSIF finance_month_closed(NEW.tenant_id, NEW.paid_on) THEN v_day := NEW.paid_on;
      END IF;
    END IF;
  END IF;
  IF v_day IS NOT NULL THEN
    RAISE EXCEPTION 'O financeiro de % está fechado. Reabra o mês para alterar.', to_char(v_day, 'MM/YYYY')
      USING ERRCODE = 'ZF001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER finance_entries_closed_month BEFORE INSERT OR UPDATE ON finance_entries FOR EACH ROW EXECUTE FUNCTION finance_entry_closed_month();
