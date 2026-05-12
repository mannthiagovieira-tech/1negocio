-- v9.23 · Motor de Originação de Compradores · backend tables
-- Aplicada via MCP apply_migration em 2026-05-12 · arquivo aqui só pra histórico em git

-- 1) Tabela principal · projetos_originacao (versionada)
CREATE TABLE projetos_originacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES projeto_metadata(id) ON DELETE CASCADE,
  versao int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'gerando'
    CHECK (status IN ('gerando', 'gerado', 'erro', 'em_revisao', 'aprovado')),

  -- Inputs do admin
  contexto_adicional text NOT NULL,
  hipotese_comprador text,
  restricoes text,
  urgencia text NOT NULL DEFAULT 'normal'
    CHECK (urgencia IN ('sem_pressa', 'normal', 'urgente', 'critico')),
  orcamento_midia_diario numeric DEFAULT 50,
  canais_excluidos text[] DEFAULT ARRAY[]::text[],
  foco_pj_pf text NOT NULL DEFAULT 'ambos'
    CHECK (foco_pj_pf IN ('pj', 'pf', 'ambos')),

  -- Output IA
  conteudo jsonb,
  web_search_usado boolean DEFAULT false,
  input_tokens int,
  output_tokens int,
  duracao_ms int,

  -- Audit
  gerado_por_admin_id uuid REFERENCES admins(id) ON DELETE SET NULL,
  gerado_em timestamptz DEFAULT now(),
  revisado_em timestamptz,
  revisado_por_admin_id uuid REFERENCES admins(id) ON DELETE SET NULL,
  notas_admin text,

  -- Erro
  erro_msg text,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_proj_origin_projeto ON projetos_originacao(projeto_id, versao DESC);
CREATE INDEX idx_proj_origin_status  ON projetos_originacao(status) WHERE status IN ('gerando', 'gerado');

-- 2) View · última versão por projeto
CREATE OR REPLACE VIEW projetos_originacao_atual AS
SELECT DISTINCT ON (projeto_id) *
FROM projetos_originacao
ORDER BY projeto_id, versao DESC;

-- 3) Tabela arquetipos_compradores (extraídos do JSON · facilita queries)
CREATE TABLE arquetipos_compradores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  originacao_id uuid NOT NULL REFERENCES projetos_originacao(id) ON DELETE CASCADE,
  projeto_id uuid NOT NULL REFERENCES projeto_metadata(id) ON DELETE CASCADE,
  nome text NOT NULL,
  vetor text CHECK (vetor IN ('horizontal', 'vertical')),
  fit text CHECK (fit IN ('alto', 'medio', 'baixo')),
  perfil text,
  motivacao text,
  capacidade_financeira text,
  exemplos text,
  ordem int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_arquetipos_projeto    ON arquetipos_compradores(projeto_id);
CREATE INDEX idx_arquetipos_originacao ON arquetipos_compradores(originacao_id);

-- 4) ALTER projeto_pool_contatos · novos valores de origem
ALTER TABLE projeto_pool_contatos
  DROP CONSTRAINT IF EXISTS projeto_pool_contatos_origem_check;

ALTER TABLE projeto_pool_contatos
  ADD CONSTRAINT projeto_pool_contatos_origem_check
  CHECK (origem IS NULL OR origem = ANY(ARRAY[
    'linkedin', 'indicacao', 'cold_outreach', 'evento', 'midia',
    'outro', 'matchmaking_ia', 'pediu_info',
    'originacao_arquetipo', 'originacao_gmaps', 'originacao_fb_search',
    'originacao_fb_pages', 'originacao_instagram', 'originacao_econodata',
    'originacao_manual', 'originacao_meta_ads', 'originacao_google_ads'
  ]));

-- 5) RLS · admin-only
ALTER TABLE projetos_originacao   ENABLE ROW LEVEL SECURITY;
ALTER TABLE arquetipos_compradores ENABLE ROW LEVEL SECURITY;

CREATE POLICY admins_origin_all
  ON projetos_originacao FOR ALL
  TO authenticated
  USING (is_admin_atual())
  WITH CHECK (is_admin_atual());

CREATE POLICY admins_arquetipos_all
  ON arquetipos_compradores FOR ALL
  TO authenticated
  USING (is_admin_atual())
  WITH CHECK (is_admin_atual());
