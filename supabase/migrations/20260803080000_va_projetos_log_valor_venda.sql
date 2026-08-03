-- Proteção definitiva contra sobrescrita não-rastreável de valor_venda.
-- Não bloqueia · APENAS LOGA quem/quando/de-onde mudou. Se aparecer
-- origem inesperada nos logs, aí sim adicionamos guard restritivo.

CREATE TABLE IF NOT EXISTS va_projetos_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  campo text NOT NULL,
  valor_antigo text NULL,
  valor_novo text NULL,
  auth_uid uuid NULL,
  auth_role text NULL,
  origem text NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_va_projetos_log_projeto ON va_projetos_log(projeto_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_va_projetos_log_campo   ON va_projetos_log(campo, criado_em DESC);

ALTER TABLE va_projetos_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_projetos_log_admin ON va_projetos_log;
CREATE POLICY pol_projetos_log_admin ON va_projetos_log
  FOR ALL TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
GRANT SELECT, INSERT ON va_projetos_log TO authenticated;

CREATE OR REPLACE FUNCTION va_projetos_log_valor_venda_ts() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid;
  v_role text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.valor_venda IS DISTINCT FROM OLD.valor_venda THEN
    BEGIN v_uid := auth.uid(); EXCEPTION WHEN OTHERS THEN v_uid := NULL; END;
    BEGIN v_role := current_setting('request.jwt.claim.role', true); EXCEPTION WHEN OTHERS THEN v_role := NULL; END;
    INSERT INTO va_projetos_log(projeto_id, campo, valor_antigo, valor_novo, auth_uid, auth_role, origem)
    VALUES (NEW.id, 'valor_venda', OLD.valor_venda::text, NEW.valor_venda::text, v_uid, v_role,
            CASE WHEN v_role='service_role' THEN 'srk_ou_edge'
                 WHEN v_role='authenticated' THEN 'ui_ou_api_com_jwt'
                 ELSE COALESCE(v_role, 'desconhecido') END);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_va_projetos_log_valor_venda ON va_projetos;
CREATE TRIGGER trg_va_projetos_log_valor_venda
  AFTER UPDATE OF valor_venda ON va_projetos
  FOR EACH ROW EXECUTE FUNCTION va_projetos_log_valor_venda_ts();
