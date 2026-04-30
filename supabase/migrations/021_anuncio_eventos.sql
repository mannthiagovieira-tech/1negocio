-- Migration 021: Tabela de eventos pra analytics dos anúncios
-- Substitui (futuramente): negocio_views, negocio_cliques, cta_clicks (parcial)

BEGIN;

CREATE TABLE anuncio_eventos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Anúncio referenciado
  anuncio_id UUID REFERENCES anuncios_v2(id) ON DELETE CASCADE,
  anuncio_codigo TEXT NOT NULL,        -- 1N-AN-XXX (denormalizado)

  -- Tipo do evento
  tipo TEXT NOT NULL,
  -- Valores aceitos:
  -- 'view_card', 'click_card',
  -- 'view_pagina',
  -- 'click_aba_resumo', 'click_aba_financeiro', 'click_aba_indicadores', 'click_aba_analise',
  -- 'scroll_25', 'scroll_50', 'scroll_75', 'scroll_100',
  -- 'tempo_sessao',
  -- 'click_solicitar_info', 'click_compartilhar', 'click_whatsapp', 'click_voltar_home',
  -- 'nda_solicitado', 'nda_assinado', 'mesa_aberta'

  -- Quem
  user_id UUID REFERENCES auth.users(id),
  session_id TEXT,
  visitor_id TEXT,

  -- Origem
  origem TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  referrer TEXT,

  -- Contexto técnico
  user_agent TEXT,
  ip_hash TEXT,
  device TEXT,

  -- Dados do evento
  metadata JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_eventos_anuncio_data ON anuncio_eventos(anuncio_id, created_at DESC);
CREATE INDEX idx_eventos_codigo ON anuncio_eventos(anuncio_codigo);
CREATE INDEX idx_eventos_tipo_data ON anuncio_eventos(tipo, created_at DESC);
CREATE INDEX idx_eventos_session ON anuncio_eventos(session_id);
CREATE INDEX idx_eventos_visitor ON anuncio_eventos(visitor_id);

ALTER TABLE anuncio_eventos ENABLE ROW LEVEL SECURITY;

CREATE POLICY eventos_service_all ON anuncio_eventos
  FOR ALL TO service_role USING (true);

CREATE POLICY eventos_anon_insert ON anuncio_eventos
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY eventos_owner_read ON anuncio_eventos
  FOR SELECT TO authenticated
  USING (
    anuncio_id IN (
      SELECT id FROM anuncios_v2 WHERE vendedor_id = auth.uid()
    )
  );

COMMENT ON TABLE anuncio_eventos IS
'Eventos de tracking dos anúncios pra analytics. Single source of truth substituindo (futuramente) negocio_views, negocio_cliques, cta_clicks parcial.';

COMMIT;
