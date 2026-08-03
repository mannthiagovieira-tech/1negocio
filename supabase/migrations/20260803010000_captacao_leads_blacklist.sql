-- P3 · CAPTAÇÃO · schema completo: extrações, leads, blacklist, log.
-- Padrão: RLS admin via va_is_admin() (SECURITY DEFINER · allowlist va_admins).
-- Regras econômicas: antessala grátis, aprovar no portão consome crédito.
-- Regra de proteção: blacklist enforcement via trigger, override loga.

-- ══════════════════════════════════════════════════════════════════════
-- 1 · BLACKLIST DO MANDATO
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS va_projeto_blacklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  nome text NOT NULL,
  cnpj text NULL,
  dominio text NULL,
  motivo text NULL,
  origem text NOT NULL DEFAULT 'manual'
    CHECK (origem IN ('fonte','manual')),
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_va_blacklist_projeto ON va_projeto_blacklist(projeto_id);
CREATE INDEX IF NOT EXISTS idx_va_blacklist_cnpj    ON va_projeto_blacklist(projeto_id, cnpj) WHERE cnpj IS NOT NULL;

ALTER TABLE va_projeto_blacklist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_blacklist_admin ON va_projeto_blacklist;
CREATE POLICY pol_blacklist_admin ON va_projeto_blacklist
  FOR ALL TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());

-- ══════════════════════════════════════════════════════════════════════
-- 2 · EXTRAÇÕES (histórico das levas)
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS va_extracoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  arquetipo_id uuid NOT NULL REFERENCES va_arquetipos(id) ON DELETE CASCADE,
  fonte text NOT NULL DEFAULT 'kipflow'
    CHECK (fonte IN ('kipflow','apify_gmaps','manual')),
  query jsonb NOT NULL DEFAULT '{}'::jsonb, -- snapshot do filtro compilado
  status text NOT NULL DEFAULT 'executando'
    CHECK (status IN ('executando','concluida','erro')),
  qtd_consultados_bruto int NOT NULL DEFAULT 0,  -- registros consultados na fonte (antes pós-filtro)
  qtd_encontrados int NOT NULL DEFAULT 0,        -- que passaram no pós-filtro
  qtd_novos int NOT NULL DEFAULT 0,
  qtd_duplicados int NOT NULL DEFAULT 0,
  qtd_blacklist int NOT NULL DEFAULT 0,
  erro text NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  concluido_em timestamptz NULL
);
CREATE INDEX IF NOT EXISTS idx_va_extracoes_projeto ON va_extracoes(projeto_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_va_extracoes_arq     ON va_extracoes(arquetipo_id, criado_em DESC);

ALTER TABLE va_extracoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_extracoes_admin ON va_extracoes;
CREATE POLICY pol_extracoes_admin ON va_extracoes
  FOR ALL TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());

-- ══════════════════════════════════════════════════════════════════════
-- 3 · LEADS
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS va_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  extracao_id uuid NULL REFERENCES va_extracoes(id) ON DELETE SET NULL,
  arquetipo_id uuid NULL REFERENCES va_arquetipos(id) ON DELETE SET NULL,
  origem text NOT NULL
    CHECK (origem IN ('extracao','campanha','parceiro','manual')),
  parceiro_id uuid NULL, -- FK futura (Prompt 5); coluna nasce agora
  fonte text NULL
    CHECK (fonte IS NULL OR fonte IN ('kipflow','apify_gmaps','meta_ads','manual')),
  cnpj text NULL,
  razao_social text NULL,
  nome_fantasia text NULL,
  cidade text NULL,
  uf text NULL,
  cnae text NULL,
  porte text NULL,
  faturamento_estimado numeric NULL,
  socios jsonb NULL,
  telefone text NULL,
  whatsapp text NULL,
  email text NULL,
  dados_brutos jsonb NULL,
  status text NOT NULL DEFAULT 'antessala'
    CHECK (status IN ('antessala','aprovado','descartado','bloqueado')),
  same_city boolean NOT NULL DEFAULT false,
  blacklist_hit boolean NOT NULL DEFAULT false,
  override_blacklist boolean NOT NULL DEFAULT false,
  custo_creditos numeric NULL,
  aprovado_em timestamptz NULL,
  descartado_em timestamptz NULL,
  motivo_descarte text NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  -- Proveniência obrigatória quando origem='extracao'
  CONSTRAINT chk_leads_origem_extracao
    CHECK (origem <> 'extracao' OR (extracao_id IS NOT NULL AND arquetipo_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_va_leads_projeto_status ON va_leads(projeto_id, status);
CREATE INDEX IF NOT EXISTS idx_va_leads_extracao      ON va_leads(extracao_id) WHERE extracao_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_va_leads_arquetipo     ON va_leads(arquetipo_id) WHERE arquetipo_id IS NOT NULL;
-- Dedupe · UNIQUE parcial (projeto_id, cnpj) WHERE cnpj IS NOT NULL
CREATE UNIQUE INDEX IF NOT EXISTS uq_va_leads_projeto_cnpj
  ON va_leads(projeto_id, cnpj) WHERE cnpj IS NOT NULL;

ALTER TABLE va_leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_leads_admin ON va_leads;
CREATE POLICY pol_leads_admin ON va_leads
  FOR ALL TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());

-- ══════════════════════════════════════════════════════════════════════
-- 4 · LOG DE AÇÕES SOBRE LEADS
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS va_leads_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES va_leads(id) ON DELETE CASCADE,
  acao text NOT NULL
    CHECK (acao IN ('aprovado','descartado','bloqueado_blacklist','override_blacklist','movido','inserido')),
  detalhe text NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_va_leads_log_lead ON va_leads_log(lead_id, criado_em DESC);

ALTER TABLE va_leads_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_leads_log_admin ON va_leads_log;
CREATE POLICY pol_leads_log_admin ON va_leads_log
  FOR ALL TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());

-- ══════════════════════════════════════════════════════════════════════
-- 5 · HELPER · normalização de nome (comparação da blacklist)
-- ══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION va_norm_nome(txt text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(regexp_replace(
    translate(
      COALESCE(txt,''),
      'áàâãäÁÀÂÃÄéèêëÉÈÊËíìîïÍÌÎÏóòôõöÓÒÔÕÖúùûüÚÙÛÜçÇñÑ',
      'aaaaaAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUcCnN'
    ),
    '[^a-z0-9 ]', '', 'g'
  ));
$$;

-- ══════════════════════════════════════════════════════════════════════
-- 6 · TRIGGER · enforcement de blacklist
--   BEFORE INSERT/UPDATE em va_leads · se bater, força status='bloqueado'
--   e blacklist_hit=true. Override: linha inserida/atualizada com
--   override_blacklist=true na MESMA operação pula o trigger.
-- ══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION va_leads_blacklist_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  bl_row RECORD;
  nome_norm text;
  dominio_lead text;
BEGIN
  -- Override explícito · pula o trigger (log é responsabilidade da function)
  IF NEW.override_blacklist THEN RETURN NEW; END IF;

  nome_norm := va_norm_nome(COALESCE(NEW.razao_social, NEW.nome_fantasia, ''));
  dominio_lead := lower(NULLIF(split_part(COALESCE(NEW.email,''), '@', 2), ''));

  -- Match: cnpj exato OU nome contido/contendo (normalizado) OU domínio exato
  SELECT b.id, b.nome, b.motivo
  INTO bl_row
  FROM va_projeto_blacklist b
  WHERE b.projeto_id = NEW.projeto_id
    AND (
      (b.cnpj IS NOT NULL AND NEW.cnpj IS NOT NULL AND regexp_replace(b.cnpj,'\D','','g') = regexp_replace(NEW.cnpj,'\D','','g'))
      OR (nome_norm <> '' AND (
            va_norm_nome(b.nome) = nome_norm
            OR (length(va_norm_nome(b.nome)) >= 4 AND position(va_norm_nome(b.nome) IN nome_norm) > 0)
            OR (length(nome_norm) >= 4 AND position(nome_norm IN va_norm_nome(b.nome)) > 0)
      ))
      OR (b.dominio IS NOT NULL AND dominio_lead IS NOT NULL AND lower(b.dominio) = dominio_lead)
    )
  LIMIT 1;

  IF bl_row.id IS NOT NULL THEN
    NEW.status := 'bloqueado';
    NEW.blacklist_hit := true;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_va_leads_blacklist ON va_leads;
CREATE TRIGGER trg_va_leads_blacklist
  BEFORE INSERT OR UPDATE ON va_leads
  FOR EACH ROW EXECUTE FUNCTION va_leads_blacklist_check();

-- ══════════════════════════════════════════════════════════════════════
-- 7 · TRIGGER · portão exige custo_creditos > 0 pra virar 'aprovado'
--   Bloqueia aprovações silenciosas (só passa pelo /api/va-portao-leads).
-- ══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION va_leads_custo_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'aprovado' AND (OLD.status IS DISTINCT FROM 'aprovado' OR TG_OP = 'INSERT') THEN
    IF NEW.custo_creditos IS NULL OR NEW.custo_creditos <= 0 THEN
      RAISE EXCEPTION 'CAPT_CUSTO: lead aprovado exige custo_creditos > 0 (recebeu %). Use /api/va-portao-leads.', COALESCE(NEW.custo_creditos::text, 'NULL')
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.aprovado_em IS NULL THEN NEW.aprovado_em := now(); END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_va_leads_custo ON va_leads;
CREATE TRIGGER trg_va_leads_custo
  BEFORE INSERT OR UPDATE ON va_leads
  FOR EACH ROW EXECUTE FUNCTION va_leads_custo_check();

-- ══════════════════════════════════════════════════════════════════════
-- 8 · TRIGGER · log automático em mudanças de status
--   INSERT bloqueado → 'bloqueado_blacklist'
--   UPDATE bloqueado→aprovado (só com override) → 'override_blacklist'
--   UPDATE * → aprovado → 'aprovado'
--   UPDATE * → descartado → 'descartado'
-- ══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION va_leads_log_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'bloqueado' AND NEW.blacklist_hit THEN
      INSERT INTO va_leads_log(lead_id, acao, detalhe)
      VALUES (NEW.id, 'bloqueado_blacklist', 'INSERT · bloqueado pela blacklist');
    ELSE
      INSERT INTO va_leads_log(lead_id, acao, detalhe)
      VALUES (NEW.id, 'inserido', 'INSERT status=' || NEW.status);
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'bloqueado' AND NEW.status = 'aprovado' THEN
      INSERT INTO va_leads_log(lead_id, acao, detalhe)
      VALUES (NEW.id, 'override_blacklist',
              'override do bloqueio · custo=' || COALESCE(NEW.custo_creditos::text,'?'));
    ELSIF NEW.status = 'aprovado' THEN
      INSERT INTO va_leads_log(lead_id, acao, detalhe)
      VALUES (NEW.id, 'aprovado',
              'aprovado · custo=' || COALESCE(NEW.custo_creditos::text,'?'));
    ELSIF NEW.status = 'descartado' THEN
      INSERT INTO va_leads_log(lead_id, acao, detalhe)
      VALUES (NEW.id, 'descartado', COALESCE(NEW.motivo_descarte, '(sem motivo)'));
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_va_leads_log ON va_leads;
CREATE TRIGGER trg_va_leads_log
  AFTER INSERT OR UPDATE OF status ON va_leads
  FOR EACH ROW EXECUTE FUNCTION va_leads_log_status();

-- ══════════════════════════════════════════════════════════════════════
-- 9 · GRANT (RLS já protege · authenticated)
-- ══════════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, UPDATE, DELETE ON va_projeto_blacklist TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON va_extracoes         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON va_leads             TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON va_leads_log         TO authenticated;
