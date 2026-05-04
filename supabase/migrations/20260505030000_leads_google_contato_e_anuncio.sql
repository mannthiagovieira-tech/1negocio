-- Migration · campos de contato + dados completos do anúncio em leads_google
-- Data: 2026-05-04 · aplicada via MCP apply_migration

ALTER TABLE leads_google ADD COLUMN IF NOT EXISTS abordado_em TIMESTAMPTZ;
ALTER TABLE leads_google ADD COLUMN IF NOT EXISTS tentou_contato_em TIMESTAMPTZ;
ALTER TABLE leads_google ADD COLUMN IF NOT EXISTS telefone_buscado_em TIMESTAMPTZ;
ALTER TABLE leads_google ADD COLUMN IF NOT EXISTS status_contato TEXT;
ALTER TABLE leads_google ADD COLUMN IF NOT EXISTS observacoes_contato TEXT;
ALTER TABLE leads_google ADD COLUMN IF NOT EXISTS data_publicacao TIMESTAMPTZ;
ALTER TABLE leads_google ADD COLUMN IF NOT EXISTS valor_anuncio NUMERIC;
ALTER TABLE leads_google ADD COLUMN IF NOT EXISTS setor TEXT;
ALTER TABLE leads_google ADD COLUMN IF NOT EXISTS url_anuncio TEXT;
ALTER TABLE leads_google ADD COLUMN IF NOT EXISTS revisar_depois BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_leads_google_pendente_abord
  ON leads_google(origem, classificacao_ia, abordado_em)
  WHERE abordado_em IS NULL;

COMMENT ON COLUMN leads_google.status_contato IS 'mandei_whatsapp | liguei | nao_falou | falou_comigo | NULL';
COMMENT ON COLUMN leads_google.url_anuncio IS 'URL completo do anúncio na origem (OLX/FB/etc)';
