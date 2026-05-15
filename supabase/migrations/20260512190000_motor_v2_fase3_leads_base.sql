-- v9.33.1 · Motor V2 Fase 3 · base pra execução de scrapers
-- 1. arquetipos_compradores.queries_busca jsonb  (populado por gerar-queries-arquetipo · v9.33.2)
-- 2. projetos_originacao.leads_executando_em timestamptz  (lock orquestrador)
-- 3. originacao_leads_brutos · CHECK canal expandido + categoria + 3 indexes
-- Tabela originacao_leads_brutos está vazia (0 rows) · CHECK pode ser substituído sem migrar dados.

ALTER TABLE arquetipos_compradores
  ADD COLUMN IF NOT EXISTS queries_busca jsonb;

ALTER TABLE projetos_originacao
  ADD COLUMN IF NOT EXISTS leads_executando_em timestamptz;

ALTER TABLE originacao_leads_brutos
  DROP CONSTRAINT IF EXISTS originacao_leads_brutos_canal_check;

ALTER TABLE originacao_leads_brutos
  ADD CONSTRAINT originacao_leads_brutos_canal_check
  CHECK (canal IN ('gmaps','facebook','instagram','linkedin',
                    'google_search','twitter','olx','corretores_locais'));

ALTER TABLE originacao_leads_brutos
  ADD COLUMN IF NOT EXISTS categoria text
    CHECK (categoria IS NULL OR categoria IN ('comprador_potencial','parceiro_local'));

CREATE INDEX IF NOT EXISTS idx_arquetipos_queries_busca_not_null
  ON arquetipos_compradores (id) WHERE queries_busca IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_brutos_categoria
  ON originacao_leads_brutos (categoria) WHERE categoria IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orig_leads_exec
  ON projetos_originacao (leads_executando_em) WHERE leads_executando_em IS NOT NULL;
