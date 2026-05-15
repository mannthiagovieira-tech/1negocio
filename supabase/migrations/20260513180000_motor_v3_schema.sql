-- v9.34.0 · Sprint 1 · Motor V3 schema · sem features visíveis · só fundação
-- 1. projetos_originacao · campos de tese versionada · lista semanal · orçamento/gastos
-- 2. arquetipos_compradores · tipo
-- 3. pool_contatos_uso · 5 status V3 + notas array + Lusha + ciclo de vida
-- 4. conteudo_gtm · tabela nova
-- 5. queries_busca · comentário documentando schema V3

-- =============================================================
-- 1.1 · projetos_originacao · novas colunas
-- =============================================================
ALTER TABLE projetos_originacao
  ADD COLUMN IF NOT EXISTS tese_jsonb JSONB,
  ADD COLUMN IF NOT EXISTS tese_versao INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS tese_chat_historico JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS lista_semanal_jsonb JSONB,
  ADD COLUMN IF NOT EXISTS lista_gerada_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS orcamento_leads_mensal DECIMAL(10,2) DEFAULT 50.00,
  ADD COLUMN IF NOT EXISTS orcamento_conteudo_mensal DECIMAL(10,2) DEFAULT 20.00,
  ADD COLUMN IF NOT EXISTS gasto_leads_mes DECIMAL(10,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS gasto_anthropic_mes DECIMAL(10,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS gasto_dalle_mes DECIMAL(10,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS gasto_lusha_creditos_mes INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS orcamento_reset_em DATE;

-- =============================================================
-- 1.2 · arquetipos_compradores · tipo
-- =============================================================
ALTER TABLE arquetipos_compradores
  ADD COLUMN IF NOT EXISTS tipo TEXT
  CHECK (tipo IN (
    'horizontal',
    'vertical_antes',
    'vertical_depois',
    'adjacente',
    'clientes_negocio',
    'investidor_financeiro',
    'profissional_setor'
  ));

-- =============================================================
-- 1.3 · pool_contatos_uso · CHECK status V3 + novos campos
-- =============================================================

-- (a) Drop CHECK antigo
ALTER TABLE pool_contatos_uso
  DROP CONSTRAINT IF EXISTS pool_contatos_uso_status_check;

-- (b) CHECK híbrido temporário (legado + V3) · permite UPDATE de migração
ALTER TABLE pool_contatos_uso
  ADD CONSTRAINT pool_contatos_uso_status_check
  CHECK (status IN (
    'novo','em_contato','em_negociacao','convertido','descartado',
    'bruto','util','irrelevante','contatado','respondeu'
  ));

-- (c) Migrar rows existentes · mapeamento legado → V3
UPDATE pool_contatos_uso SET status = 'novo'         WHERE status = 'bruto';
UPDATE pool_contatos_uso SET status = 'em_contato'   WHERE status = 'contatado';
UPDATE pool_contatos_uso SET status = 'em_negociacao' WHERE status = 'util';
UPDATE pool_contatos_uso SET status = 'convertido'   WHERE status = 'respondeu';
UPDATE pool_contatos_uso SET status = 'descartado'   WHERE status = 'irrelevante';

-- (d) Drop CHECK híbrido e adicionar CHECK final (só V3)
ALTER TABLE pool_contatos_uso
  DROP CONSTRAINT IF EXISTS pool_contatos_uso_status_check;

ALTER TABLE pool_contatos_uso
  ADD CONSTRAINT pool_contatos_uso_status_check
  CHECK (status IN ('novo','em_contato','em_negociacao','convertido','descartado'));

-- (e) Novos campos · ciclo de vida + Lusha
ALTER TABLE pool_contatos_uso
  ADD COLUMN IF NOT EXISTS notas JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS motivo_descarte TEXT,
  ADD COLUMN IF NOT EXISTS ultima_atividade TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mensagem_enviada TEXT,
  ADD COLUMN IF NOT EXISTS respondeu BOOLEAN,
  ADD COLUMN IF NOT EXISTS lusha_enriquecido BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS lusha_creditos_usados INTEGER DEFAULT 0;

-- (f) Migrar nota_admin existente para array notas
UPDATE pool_contatos_uso
SET notas = jsonb_build_array(
  jsonb_build_object(
    'data', NOW(),
    'texto', nota_admin,
    'autor', 'migration_v3'
  )
)
WHERE nota_admin IS NOT NULL AND nota_admin != '' AND (notas IS NULL OR notas = '[]'::jsonb);

-- =============================================================
-- 1.4 · conteudo_gtm · tabela nova
-- =============================================================
CREATE TABLE IF NOT EXISTS conteudo_gtm (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gtm_id UUID REFERENCES projetos_originacao(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'roteiro_video',
    'short',
    'blog',
    'carrossel',
    'legenda',
    'imagem_dalle',
    'imagem_canva'
  )),
  conteudo_texto TEXT,
  conteudo_url TEXT,
  tokens_anthropic INTEGER,
  custo_estimado DECIMAL(8,4),
  aprovado BOOLEAN DEFAULT false,
  aprovado_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conteudo_gtm_gtm_id ON conteudo_gtm(gtm_id);
CREATE INDEX IF NOT EXISTS idx_conteudo_gtm_tipo ON conteudo_gtm(tipo);
CREATE INDEX IF NOT EXISTS idx_conteudo_gtm_aprovado ON conteudo_gtm(aprovado);

ALTER TABLE conteudo_gtm ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_full_conteudo_gtm" ON conteudo_gtm;
CREATE POLICY "admin_full_conteudo_gtm" ON conteudo_gtm
  FOR ALL USING (true) WITH CHECK (true);

-- =============================================================
-- 1.5 · queries_busca · comentário schema V3
-- =============================================================
COMMENT ON COLUMN arquetipos_compradores.queries_busca IS
'Schema V3: {
  gmaps: string[],
  gmaps_corretores: string[],
  fb_grupos: string[],
  ig_influenciadores: string[],
  ig_corretores: string[],
  web_compradores: string[],
  web_influenciadores: string[],
  web_eventos: string[],
  web_corretores: string[],
  web_profissionais: string[],
  lusha_filtros: { jobTitles: string[], setor: string[], cidade: string },
  raciocinio: string,
  gerado_em: iso_string
}';
