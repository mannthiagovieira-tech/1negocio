-- Migration 016: Tabela anuncios_v2 — fonte única de verdade dos anúncios
-- Substitui: anuncios (antiga) + colunas de anúncio em negocios

BEGIN;

CREATE TABLE anuncios_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo TEXT UNIQUE NOT NULL,                      -- 1N-AN-XXXXX

  -- Lastreio em cadeia
  negocio_id UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  laudo_v2_id UUID REFERENCES laudos_v2(id),
  vendedor_id UUID REFERENCES auth.users(id),

  -- Conteúdo editável
  titulo TEXT,
  descricao_card TEXT,
  valor_pedido NUMERIC(15,2),

  -- Cache das sugestões IA
  titulo_sugestoes_ia JSONB DEFAULT '[]'::jsonb,
  descricao_sugerida_ia TEXT,
  ia_geradas_em TIMESTAMPTZ,

  -- Status
  status TEXT NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho','aguardando_aprovacao','publicado','pausado','vendido','expirado')),

  -- Termo de adesão
  termo_adesao_id UUID REFERENCES termos_adesao(id),
  termo_assinado_em TIMESTAMPTZ,

  -- Arquivo HTML estático
  arquivo_html_path TEXT,
  arquivo_gerado_em TIMESTAMPTZ,
  arquivo_versao INT DEFAULT 0,

  -- Métricas (cache; fonte da verdade fica em eventos próprios)
  views_total INT DEFAULT 0,
  shares_total INT DEFAULT 0,
  info_requests_total INT DEFAULT 0,

  -- Datas
  publicado_em TIMESTAMPTZ,
  pausado_em TIMESTAMPTZ,
  vendido_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_anuncios_v2_codigo ON anuncios_v2(codigo);
CREATE INDEX idx_anuncios_v2_negocio ON anuncios_v2(negocio_id);
CREATE INDEX idx_anuncios_v2_vendedor ON anuncios_v2(vendedor_id);
CREATE INDEX idx_anuncios_v2_status ON anuncios_v2(status);
CREATE INDEX idx_anuncios_v2_publicado ON anuncios_v2(publicado_em DESC)
  WHERE status = 'publicado';

-- Trigger atualizado_em
CREATE OR REPLACE FUNCTION atualizar_anuncios_v2_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_anuncios_v2_atualizado
  BEFORE UPDATE ON anuncios_v2
  FOR EACH ROW EXECUTE FUNCTION atualizar_anuncios_v2_timestamp();

-- RLS
ALTER TABLE anuncios_v2 ENABLE ROW LEVEL SECURITY;

CREATE POLICY anuncios_v2_service_all ON anuncios_v2
  FOR ALL TO service_role USING (true);

CREATE POLICY anuncios_v2_anon_read_published ON anuncios_v2
  FOR SELECT TO anon, authenticated
  USING (status = 'publicado');

CREATE POLICY anuncios_v2_owner_read ON anuncios_v2
  FOR SELECT TO authenticated
  USING (vendedor_id = auth.uid());

COMMIT;
