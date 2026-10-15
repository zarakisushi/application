-- =====================================================================================
-- Segurança dos dados da Zaraki: tudo garantido no próprio Postgres.
--   1. Contexto da transação (quem, de onde, em qual unidade)
--   2. Exclusão física proibida (somente exclusão lógica via status = false)
--   3. Carimbo automático de autoria (created_by/updated_by)
--   4. Auditoria automática de INSERT/UPDATE
--   5. audit_logs append-only com cadeia de hash por unidade
--   6. Isolamento entre unidades (RLS)
--   7. Papel da aplicação com privilégios mínimos
-- =====================================================================================

-- 1. Contexto ---------------------------------------------------------------------------
-- Definido por withContext() com set_config(..., true): vale só dentro da transação.

CREATE FUNCTION app_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

CREATE FUNCTION app_is_platform_admin() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.platform_admin', true), '') = 'on'
$$;

-- 2. Exclusão física proibida -----------------------------------------------------------

CREATE FUNCTION forbid_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Exclusão física não permitida em "%": use status = false', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END $$;

-- 3. Carimbo de autoria -----------------------------------------------------------------
-- created_* é imutável; updated_* reflete sempre o ator da transação atual.

CREATE FUNCTION stamp_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF coalesce(current_setting('app.allow_backdate', true), '') <> 'on' THEN
      NEW.created_at := now();
    END IF;
    NEW.created_by := app_user_id();
    NEW.updated_at := NEW.created_at;
  ELSE
    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
    NEW.updated_at := now();
  END IF;
  NEW.updated_by := app_user_id();
  RETURN NEW;
END $$;

-- 4. Auditoria automática ---------------------------------------------------------------
-- SECURITY DEFINER: grava em audit_logs mesmo sem a aplicação ter acesso direto de escrita
-- além de INSERT. Campos sensíveis (senhas, tokens) nunca entram na auditoria.

CREATE FUNCTION audit_row() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_secret text[] := ARRAY['password', 'access_token', 'refresh_token', 'id_token', 'token'];
  v_before jsonb;
  v_after  jsonb := to_jsonb(NEW) - v_secret;
  v_changed text[];
  v_action text := 'CREATE';
  v_tenant uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_before := to_jsonb(OLD) - v_secret;
    SELECT array_agg(k ORDER BY k) INTO v_changed
      FROM jsonb_object_keys(v_after) AS k
     WHERE v_after -> k IS DISTINCT FROM v_before -> k
       AND k NOT IN ('updated_at', 'updated_by');
    IF v_changed IS NULL THEN
      RETURN NULL; -- UPDATE sem mudança real
    END IF;
    v_action := CASE
      WHEN (v_before ->> 'status')::boolean AND NOT (v_after ->> 'status')::boolean THEN 'SOFT_DELETE'
      WHEN NOT (v_before ->> 'status')::boolean AND (v_after ->> 'status')::boolean THEN 'RESTORE'
      ELSE 'UPDATE'
    END;
  END IF;

  v_tenant := CASE TG_TABLE_NAME
    WHEN 'tenants' THEN (v_after ->> 'id')::uuid
    WHEN 'users' THEN app_tenant_id()
    WHEN 'accounts' THEN app_tenant_id()
    ELSE (v_after ->> 'tenant_id')::uuid
  END;

  INSERT INTO audit_logs (tenant_id, actor_user_id, actor_label, action, entity, entity_id,
                          before, after, changed_fields, ip, user_agent, request_id)
  VALUES (v_tenant, app_user_id(), nullif(current_setting('app.actor_label', true), ''),
          v_action, TG_TABLE_NAME, v_after ->> 'id', v_before, v_after, v_changed,
          nullif(current_setting('app.ip', true), ''),
          nullif(current_setting('app.user_agent', true), ''),
          nullif(current_setting('app.request_id', true), ''));
  RETURN NULL;
END $$;

-- 5. audit_logs append-only com cadeia de hash -----------------------------------------
-- Cada linha guarda hash = sha256(prev_hash || conteúdo canônico). A cadeia é por unidade
-- (tenant_id; NULL = eventos globais). O lock + nextval dentro do trigger garantem que a
-- ordem do id é a ordem da cadeia mesmo com gravações concorrentes.

CREATE FUNCTION audit_payload(a audit_logs) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_array(
    a.tenant_id, a.actor_user_id, a.actor_label, a.action, a.entity, a.entity_id,
    a.before, a.after, a.changed_fields, a.ip, a.user_agent, a.request_id,
    (extract(epoch FROM a.created_at) * 1000000)::bigint
  )::text
$$;

CREATE FUNCTION audit_chain() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prev text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('audit:' || coalesce(NEW.tenant_id::text, 'global'), 0));
  IF NEW.tenant_id IS NULL THEN
    SELECT hash INTO v_prev FROM audit_logs WHERE tenant_id IS NULL ORDER BY id DESC LIMIT 1;
  ELSE
    SELECT hash INTO v_prev FROM audit_logs WHERE tenant_id = NEW.tenant_id ORDER BY id DESC LIMIT 1;
  END IF;
  NEW.id := nextval(pg_get_serial_sequence('audit_logs', 'id'));
  NEW.created_at := clock_timestamp();
  NEW.prev_hash := v_prev;
  NEW.hash := encode(sha256(convert_to(coalesce(v_prev, '') || audit_payload(NEW), 'UTF8')), 'hex');
  RETURN NEW;
END $$;

CREATE FUNCTION audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs é somente inserção (% bloqueado)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER audit_logs_chain BEFORE INSERT ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_chain();
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_immutable();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_immutable();

-- Recalcula a cadeia de uma unidade. Retorna o id da primeira linha inconsistente, se houver.
CREATE FUNCTION audit_verify_chain(p_tenant uuid)
RETURNS TABLE (ok boolean, checked bigint, broken_at bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r audit_logs;
  v_prev text;
  v_n bigint := 0;
BEGIN
  FOR r IN
    SELECT * FROM audit_logs
     WHERE (p_tenant IS NULL AND tenant_id IS NULL) OR tenant_id = p_tenant
     ORDER BY id
  LOOP
    v_n := v_n + 1;
    IF r.prev_hash IS DISTINCT FROM v_prev
       OR r.hash <> encode(sha256(convert_to(coalesce(v_prev, '') || audit_payload(r), 'UTF8')), 'hex') THEN
      RETURN QUERY SELECT false, v_n, r.id;
      RETURN;
    END IF;
    v_prev := r.hash;
  END LOOP;
  RETURN QUERY SELECT true, v_n, NULL::bigint;
END $$;

-- Triggers nas tabelas -------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  -- Exclusão física proibida: todas as tabelas, exceto as técnicas de sessão/verificação.
  FOREACH t IN ARRAY ARRAY['tenants', 'users', 'accounts', 'memberships', 'order_counters', 'customers',
                           'products', 'orders', 'order_items', 'order_stage_history', 'calendar_sync_jobs']
  LOOP
    EXECUTE format('CREATE TRIGGER %I_forbid_delete BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_delete()', t, t);
  END LOOP;

  -- Carimbo de autoria: tabelas com as colunas padrão.
  FOREACH t IN ARRAY ARRAY['tenants', 'users', 'memberships', 'customers', 'products', 'orders',
                           'order_items', 'order_stage_history', 'calendar_sync_jobs']
  LOOP
    EXECUTE format('CREATE TRIGGER %I_stamp BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION stamp_row()', t, t);
  END LOOP;

  -- Auditoria de linha (calendar_sync_jobs e order_counters são técnicas: falhas viram eventos).
  FOREACH t IN ARRAY ARRAY['tenants', 'users', 'accounts', 'memberships', 'customers', 'products',
                           'orders', 'order_items', 'order_stage_history']
  LOOP
    EXECUTE format('CREATE TRIGGER %I_audit AFTER INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row()', t, t);
  END LOOP;
END $$;

-- 6. Isolamento entre unidades (RLS) ----------------------------------------------------
-- FORCE: vale inclusive para o dono das tabelas. Sem app.tenant_id, nada é visível.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['order_counters', 'customers', 'products', 'orders', 'order_items',
                           'order_stage_history', 'calendar_sync_jobs']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (app_is_platform_admin() OR tenant_id = app_tenant_id())
      WITH CHECK (app_is_platform_admin() OR tenant_id = app_tenant_id())$p$, t);
  END LOOP;
END $$;

-- Vínculos: além da unidade ativa, o próprio usuário enxerga os seus (para escolher a unidade no login).
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY memberships_read ON memberships FOR SELECT
  USING (app_is_platform_admin() OR tenant_id = app_tenant_id() OR user_id = app_user_id());
CREATE POLICY memberships_insert ON memberships FOR INSERT
  WITH CHECK (app_is_platform_admin() OR tenant_id = app_tenant_id());
CREATE POLICY memberships_update ON memberships FOR UPDATE
  USING (app_is_platform_admin() OR tenant_id = app_tenant_id())
  WITH CHECK (app_is_platform_admin() OR tenant_id = app_tenant_id());

-- Unidades: dados cadastrais são públicos (o site precisa resolver a unidade pelo slug);
-- criar é exclusivo da Matriz; editar, da Matriz ou da própria unidade.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenants_read ON tenants FOR SELECT USING (true);
CREATE POLICY tenants_insert ON tenants FOR INSERT WITH CHECK (app_is_platform_admin());
CREATE POLICY tenants_update ON tenants FOR UPDATE
  USING (app_is_platform_admin() OR id = app_tenant_id())
  WITH CHECK (app_is_platform_admin() OR id = app_tenant_id());

-- Auditoria: leitura por unidade; eventos globais (tenant NULL) só para a Matriz.
-- Sem FORCE: os triggers SECURITY DEFINER (dono) gravam e encadeiam sem restrição.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON audit_logs FOR SELECT
  USING (app_is_platform_admin() OR tenant_id = app_tenant_id());
CREATE POLICY audit_insert ON audit_logs FOR INSERT
  WITH CHECK (app_is_platform_admin() OR tenant_id IS NULL OR tenant_id = app_tenant_id());

-- 7. Papel da aplicação ----------------------------------------------------------------
-- Criado sem login; a senha é definida fora das migrations (runMigrations / APP_DB_PASSWORD).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zaraki_app') THEN
    CREATE ROLE zaraki_app NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO zaraki_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO zaraki_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO zaraki_app;
REVOKE UPDATE ON audit_logs FROM zaraki_app;
GRANT DELETE ON sessions, verifications TO zaraki_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO zaraki_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO zaraki_app;
