-- P4 · FUNIL · kanban 4 colunas + cadência automática Z-API + webhook.
-- Escopo: schema completo. Handlers HTTP em /api/va-*. RLS admin.

-- ══════════════════════════════════════════════════════════════════════
-- 1 · va_leads ganha campos de funil + cadência + adendos (desdobramento, contato)
-- ══════════════════════════════════════════════════════════════════════
ALTER TABLE va_leads
  ADD COLUMN IF NOT EXISTS funil_etapa text NULL
    CHECK (funil_etapa IS NULL OR funil_etapa IN
      ('na_fila','contatado','respondeu','em_conversa','promovido','optout','sem_contato')),
  ADD COLUMN IF NOT EXISTS toque1_em timestamptz NULL,
  ADD COLUMN IF NOT EXISTS toque2_em timestamptz NULL,
  ADD COLUMN IF NOT EXISTS proximo_toque_apos timestamptz NULL,
  ADD COLUMN IF NOT EXISTS pausado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS respondeu_em timestamptz NULL,
  -- Adendo 1 · desdobramento de plataforma (pool retroalimentado)
  ADD COLUMN IF NOT EXISTS desdobramento text NULL
    CHECK (desdobramento IS NULL OR desdobramento IN
      ('interessado_ativo','quer_vender','comprador_outra_tese','parceiro_potencial','sem_interesse')),
  ADD COLUMN IF NOT EXISTS desdobramento_nota text NULL,
  -- Adendo 2 · memória de relacionamento (matchmaking futuro)
  ADD COLUMN IF NOT EXISTS contato_nome text NULL,
  ADD COLUMN IF NOT EXISTS contato_cargo text NULL
    CHECK (contato_cargo IS NULL OR contato_cargo IN
      ('dono_socio','diretor','gerente','funcionario','outro')),
  ADD COLUMN IF NOT EXISTS visao_registrada_em timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_va_leads_funil_etapa
  ON va_leads(projeto_id, funil_etapa) WHERE funil_etapa IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_va_leads_proximo_toque
  ON va_leads(projeto_id, proximo_toque_apos)
  WHERE funil_etapa='contatado' AND pausado=false AND proximo_toque_apos IS NOT NULL;

-- Trigger · opt-out não volta pra etapa de disparo (respondeu/em_conversa também trava)
CREATE OR REPLACE FUNCTION va_leads_funil_optout_trava() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.funil_etapa = 'optout' AND NEW.funil_etapa <> 'optout' THEN
    RAISE EXCEPTION 'FUNIL_OPTOUT_TRAVA: lead marcado opt-out não pode voltar (tentou ir para %). Ação bloqueada por trigger.', NEW.funil_etapa
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_va_leads_optout ON va_leads;
CREATE TRIGGER trg_va_leads_optout
  BEFORE UPDATE OF funil_etapa ON va_leads
  FOR EACH ROW EXECUTE FUNCTION va_leads_funil_optout_trava();

-- Trigger · marca visao_registrada_em quando desdobramento é setado
CREATE OR REPLACE FUNCTION va_leads_visao_ts() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP='INSERT' AND NEW.desdobramento IS NOT NULL)
  OR (TG_OP='UPDATE' AND NEW.desdobramento IS DISTINCT FROM OLD.desdobramento AND NEW.desdobramento IS NOT NULL) THEN
    NEW.visao_registrada_em := now();
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_va_leads_visao ON va_leads;
CREATE TRIGGER trg_va_leads_visao
  BEFORE INSERT OR UPDATE OF desdobramento ON va_leads
  FOR EACH ROW EXECUTE FUNCTION va_leads_visao_ts();

-- ══════════════════════════════════════════════════════════════════════
-- 2 · va_cadencia_config (1 por projeto)
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS va_cadencia_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL UNIQUE REFERENCES va_projetos(id) ON DELETE CASCADE,
  ativa boolean NOT NULL DEFAULT false,
  teto_diario int NOT NULL DEFAULT 4 CHECK (teto_diario > 0 AND teto_diario <= 200),
  janela_inicio time NOT NULL DEFAULT '09:00',
  janela_fim time NOT NULL DEFAULT '18:00',
  dias_uteis_apenas boolean NOT NULL DEFAULT true,
  intervalo_toques_dias int NOT NULL DEFAULT 2 CHECK (intervalo_toques_dias > 0 AND intervalo_toques_dias <= 30),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE va_cadencia_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_cad_config_admin ON va_cadencia_config;
CREATE POLICY pol_cad_config_admin ON va_cadencia_config
  FOR ALL TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
GRANT SELECT, INSERT, UPDATE, DELETE ON va_cadencia_config TO authenticated;

CREATE OR REPLACE FUNCTION va_cadencia_config_ts() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.atualizado_em := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_cad_config_ts ON va_cadencia_config;
CREATE TRIGGER trg_cad_config_ts BEFORE UPDATE ON va_cadencia_config
  FOR EACH ROW EXECUTE FUNCTION va_cadencia_config_ts();

-- ══════════════════════════════════════════════════════════════════════
-- 3 · va_cadencia_templates (por arquétipo · 2 toques)
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS va_cadencia_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  arquetipo_id uuid NOT NULL REFERENCES va_arquetipos(id) ON DELETE CASCADE,
  toque int NOT NULL CHECK (toque IN (1,2)),
  corpo text NOT NULL,
  aprovado boolean NOT NULL DEFAULT false,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (arquetipo_id, toque)
);
CREATE INDEX IF NOT EXISTS idx_cad_tpl_projeto ON va_cadencia_templates(projeto_id);
ALTER TABLE va_cadencia_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_cad_tpl_admin ON va_cadencia_templates;
CREATE POLICY pol_cad_tpl_admin ON va_cadencia_templates
  FOR ALL TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
GRANT SELECT, INSERT, UPDATE, DELETE ON va_cadencia_templates TO authenticated;

CREATE OR REPLACE FUNCTION va_cad_tpl_ts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.atualizado_em := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_cad_tpl_ts ON va_cadencia_templates;
CREATE TRIGGER trg_cad_tpl_ts BEFORE UPDATE ON va_cadencia_templates
  FOR EACH ROW EXECUTE FUNCTION va_cad_tpl_ts();

-- ══════════════════════════════════════════════════════════════════════
-- 4 · va_disparos (fila + log)
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS va_disparos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES va_leads(id) ON DELETE CASCADE,
  arquetipo_id uuid NULL REFERENCES va_arquetipos(id) ON DELETE SET NULL,
  toque int NOT NULL CHECK (toque IN (1,2)),
  corpo_snapshot text NOT NULL,
  status text NOT NULL DEFAULT 'agendado'
    CHECK (status IN ('agendado','enviado','erro','cancelado')),
  zapi_message_id text NULL,
  razao_id uuid NULL,
  erro text NULL,
  tentativas int NOT NULL DEFAULT 0,
  agendado_para timestamptz NULL,
  enviado_em timestamptz NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_disp_projeto_status ON va_disparos(projeto_id, status);
CREATE INDEX IF NOT EXISTS idx_disp_lead ON va_disparos(lead_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_disp_dia
  ON va_disparos(projeto_id, enviado_em) WHERE status='enviado';
ALTER TABLE va_disparos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_disp_admin ON va_disparos;
CREATE POLICY pol_disp_admin ON va_disparos
  FOR ALL TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
GRANT SELECT, INSERT, UPDATE, DELETE ON va_disparos TO authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- 5 · va_mensagens_recebidas (webhook Z-API)
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS va_mensagens_recebidas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NULL REFERENCES va_projetos(id) ON DELETE SET NULL,
  lead_id uuid NULL REFERENCES va_leads(id) ON DELETE SET NULL,
  telefone text NOT NULL,
  corpo text NULL,
  recebida_em timestamptz NOT NULL DEFAULT now(),
  processada boolean NOT NULL DEFAULT false,
  raw jsonb NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_recv_lead ON va_mensagens_recebidas(lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_msg_recv_fone ON va_mensagens_recebidas(telefone);
CREATE INDEX IF NOT EXISTS idx_msg_recv_orfa ON va_mensagens_recebidas(processada, recebida_em DESC) WHERE lead_id IS NULL;
ALTER TABLE va_mensagens_recebidas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_msg_recv_admin ON va_mensagens_recebidas;
CREATE POLICY pol_msg_recv_admin ON va_mensagens_recebidas
  FOR ALL TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
GRANT SELECT, INSERT, UPDATE, DELETE ON va_mensagens_recebidas TO authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- 6 · Helper · normalizar telefone (só dígitos, mantém formato E.164 curto)
-- ══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION va_norm_fone(txt text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(regexp_replace(COALESCE(txt,''), '\D', '', 'g'), '');
$$;
