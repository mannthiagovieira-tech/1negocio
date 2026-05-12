-- v9.27 · Motor de Originação V2 · refactor schema completo
-- Aplicada via MCP apply_migration em 2026-05-12 · arquivo aqui só pra histórico em git
-- Workflow conversacional multi-fase com aprovação humana

-- Step 1 · Limpeza (V1 deletado pelo operador)
DELETE FROM arquetipos_compradores;
DELETE FROM projetos_originacao;
DROP VIEW IF EXISTS projetos_originacao_atual;

-- Step 2 · Refactor projetos_originacao (V1 cols dropped · V2 cols added)
ALTER TABLE projetos_originacao
  DROP COLUMN IF EXISTS contexto_adicional,
  DROP COLUMN IF EXISTS hipotese_comprador,
  DROP COLUMN IF EXISTS restricoes,
  DROP COLUMN IF EXISTS urgencia,
  DROP COLUMN IF EXISTS orcamento_midia_diario,
  DROP COLUMN IF EXISTS canais_excluidos,
  DROP COLUMN IF EXISTS foco_pj_pf,
  DROP COLUMN IF EXISTS conteudo,
  DROP COLUMN IF EXISTS web_search_usado,
  DROP COLUMN IF EXISTS input_tokens,
  DROP COLUMN IF EXISTS output_tokens,
  DROP COLUMN IF EXISTS duracao_ms,
  DROP COLUMN IF EXISTS erro_msg;

ALTER TABLE projetos_originacao
  DROP CONSTRAINT IF EXISTS projetos_originacao_status_check;

ALTER TABLE projetos_originacao
  ADD COLUMN fase_atual text NOT NULL DEFAULT 'tese'
    CHECK (fase_atual IN ('tese','arquetipos','leads','enriquecimento','concluido')),
  ADD COLUMN tese_texto text,
  ADD COLUMN tese_fechada_em timestamptz,
  ADD COLUMN faixa_capacidade_min numeric,
  ADD COLUMN faixa_capacidade_max numeric,
  ADD COLUMN perfis_comprador_desejados text[],
  ADD COLUMN observacao_escala text,
  ADD COLUMN arquetipos_fechados_em timestamptz,
  ADD COLUMN leads_executados_em timestamptz,
  ADD COLUMN concluido_em timestamptz;

ALTER TABLE projetos_originacao
  ALTER COLUMN status SET DEFAULT 'rascunho';

ALTER TABLE projetos_originacao
  ADD CONSTRAINT projetos_originacao_status_check
  CHECK (status IN ('rascunho','concluido','arquivado'));

-- Step 3 · Chat mensagens (NOVA tabela)
CREATE TABLE originacao_chat_mensagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  originacao_id uuid NOT NULL REFERENCES projetos_originacao(id) ON DELETE CASCADE,
  papel text NOT NULL CHECK (papel IN ('admin','ia','sistema')),
  conteudo text NOT NULL,
  tokens_in int,
  tokens_out int,
  duracao_ms int,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_chat_origin_orig ON originacao_chat_mensagens(originacao_id, created_at);

-- Step 4 · Arquétipos refatorado (DROP + CREATE com workflow status)
DROP TABLE arquetipos_compradores;

CREATE TABLE arquetipos_compradores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  originacao_id uuid NOT NULL REFERENCES projetos_originacao(id) ON DELETE CASCADE,
  projeto_id uuid NOT NULL REFERENCES projeto_metadata(id) ON DELETE CASCADE,
  nome text NOT NULL,
  vetor text CHECK (vetor IN ('horizontal','vertical')),
  perfil text,
  motivacao text,
  capacidade_financeira text,
  exemplos text,
  status text NOT NULL DEFAULT 'candidato'
    CHECK (status IN ('candidato','aprovado','editado_admin','rejeitado','criado_admin')),
  razao_rejeicao text,
  criado_pela_ia boolean DEFAULT true,
  ordem int DEFAULT 0,
  aprovado_em timestamptz,
  aprovado_por_admin_id uuid REFERENCES admins(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX idx_arquetipos_v2_projeto ON arquetipos_compradores(projeto_id);
CREATE INDEX idx_arquetipos_v2_originacao ON arquetipos_compradores(originacao_id);
CREATE INDEX idx_arquetipos_v2_status ON arquetipos_compradores(originacao_id, status);

-- Step 5 · Leads brutos (NOVA tabela · output scrapers · enriquecimento · pool)
CREATE TABLE originacao_leads_brutos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  originacao_id uuid NOT NULL REFERENCES projetos_originacao(id) ON DELETE CASCADE,
  arquetipo_id uuid REFERENCES arquetipos_compradores(id) ON DELETE SET NULL,
  canal text NOT NULL CHECK (canal IN ('gmaps','fb_search','fb_pages','instagram','linkedin','manual')),
  nome text,
  identificador_canal text,
  dados_brutos jsonb,
  telefone text,
  email text,
  linkedin_url text,
  whatsapp text,
  enriquecido boolean DEFAULT false,
  enriquecido_em timestamptz,
  score_ia int CHECK (score_ia BETWEEN 0 AND 100),
  razao_score text,
  status text NOT NULL DEFAULT 'bruto'
    CHECK (status IN ('bruto','classificado','aprovado','rejeitado','no_pool')),
  adicionado_ao_pool boolean DEFAULT false,
  pool_contato_id uuid REFERENCES projeto_pool_contatos(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (originacao_id, canal, identificador_canal)
);
CREATE INDEX idx_leads_brutos_origin ON originacao_leads_brutos(originacao_id);
CREATE INDEX idx_leads_brutos_arquetipo ON originacao_leads_brutos(arquetipo_id);
CREATE INDEX idx_leads_brutos_status ON originacao_leads_brutos(originacao_id, status);
CREATE INDEX idx_leads_brutos_canal ON originacao_leads_brutos(canal);

-- Step 6 · View consolidada (com counts agregados)
CREATE OR REPLACE VIEW projetos_originacao_atual AS
SELECT
  o.*,
  (SELECT count(*) FROM arquetipos_compradores
   WHERE originacao_id = o.id AND status IN ('aprovado','editado_admin','criado_admin')) AS arquetipos_aprovados_count,
  (SELECT count(*) FROM arquetipos_compradores
   WHERE originacao_id = o.id AND status = 'candidato') AS arquetipos_pendentes_count,
  (SELECT count(*) FROM originacao_leads_brutos
   WHERE originacao_id = o.id) AS leads_brutos_count,
  (SELECT count(*) FROM originacao_leads_brutos
   WHERE originacao_id = o.id AND enriquecido = true) AS leads_enriquecidos_count,
  (SELECT count(*) FROM originacao_chat_mensagens
   WHERE originacao_id = o.id) AS chat_mensagens_count
FROM projetos_originacao o
WHERE status != 'arquivado';

-- Step 7 · RLS admin-only nas 2 novas + recria arquetipos_compradores
ALTER TABLE originacao_chat_mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE originacao_leads_brutos ENABLE ROW LEVEL SECURITY;

CREATE POLICY admins_chat_all ON originacao_chat_mensagens FOR ALL
  TO authenticated USING (is_admin_atual()) WITH CHECK (is_admin_atual());
CREATE POLICY admins_leads_brutos_all ON originacao_leads_brutos FOR ALL
  TO authenticated USING (is_admin_atual()) WITH CHECK (is_admin_atual());

ALTER TABLE arquetipos_compradores ENABLE ROW LEVEL SECURITY;
CREATE POLICY admins_arquetipos_all ON arquetipos_compradores FOR ALL
  TO authenticated USING (is_admin_atual()) WITH CHECK (is_admin_atual());
