-- Tarefas da equipe: mesmas garantias das demais tabelas de negócio (exclusão só lógica, autoria,
-- auditoria e isolamento por unidade).
CREATE TRIGGER tasks_forbid_delete BEFORE DELETE ON tasks FOR EACH ROW EXECUTE FUNCTION forbid_delete();
--> statement-breakpoint
CREATE TRIGGER tasks_stamp BEFORE INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION stamp_row();
--> statement-breakpoint
CREATE TRIGGER tasks_audit AFTER INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION audit_row();
--> statement-breakpoint
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON tasks
  USING (app_is_platform_admin() OR tenant_id = app_tenant_id())
  WITH CHECK (app_is_platform_admin() OR tenant_id = app_tenant_id());
--> statement-breakpoint
-- O responsável precisa ter acesso à unidade da tarefa. Só é conferido quando muda: uma tarefa antiga
-- continua podendo ser concluída mesmo que o responsável tenha saído da equipe.
CREATE FUNCTION task_same_tenant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.assignee_user_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.assignee_user_id IS DISTINCT FROM OLD.assignee_user_id)
     AND NOT EXISTS (
       SELECT 1 FROM memberships m
        WHERE m.user_id = NEW.assignee_user_id AND m.tenant_id = NEW.tenant_id AND m.status) THEN
    RAISE EXCEPTION 'O responsável não tem acesso a esta unidade' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tasks_same_tenant BEFORE INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION task_same_tenant();
