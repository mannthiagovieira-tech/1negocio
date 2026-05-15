-- Migration · pecas_geradas (Painel v3 · Gerador de Conteúdo)
-- Data: 2026-05-03
-- Cria tabela pra histórico de peças geradas pelo gerador-de-conteudo

CREATE TABLE IF NOT EXISTS pecas_geradas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id UUID REFERENCES negocios(id) ON DELETE SET NULL,
  formato TEXT NOT NULL CHECK (formato IN ('feed-insta','story-insta','post-linkedin')),
  tipo_imagem TEXT NOT NULL CHECK (tipo_imagem IN ('html-svg','dalle-3')),
  tom TEXT NOT NULL CHECK (tom IN ('direto','editorial','convidativo')),
  texto_principal TEXT,
  hashtags JSONB,
  imagem_dados TEXT,                          -- SVG inline ou URL DALL-E
  tokens_usados INT,
  criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  criada_por UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_pecas_geradas_negocio ON pecas_geradas(negocio_id);
CREATE INDEX IF NOT EXISTS idx_pecas_geradas_criada  ON pecas_geradas(criada_em DESC);
CREATE INDEX IF NOT EXISTS idx_pecas_geradas_autor   ON pecas_geradas(criada_por);

ALTER TABLE pecas_geradas ENABLE ROW LEVEL SECURITY;

-- anon BLOQUEADO (só edge function service_role insere)
CREATE POLICY "pecas_no_anon" ON pecas_geradas FOR ALL TO anon USING (false) WITH CHECK (false);

-- admin pode ler/escrever via service_role (default)

COMMENT ON TABLE pecas_geradas IS 'Histórico de peças de conteúdo geradas pela Edge Function gerar-conteudo-post (painel-v3)';
