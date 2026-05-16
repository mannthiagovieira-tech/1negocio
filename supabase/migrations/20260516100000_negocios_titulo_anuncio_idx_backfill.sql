-- v9.38.7 · garante coluna · backfill nulls · índice GIN
-- Aplicada via MCP apply_migration em 2026-05-16
ALTER TABLE negocios ADD COLUMN IF NOT EXISTS titulo_anuncio TEXT;
UPDATE negocios SET titulo_anuncio = nome WHERE titulo_anuncio IS NULL;
CREATE INDEX IF NOT EXISTS idx_negocios_titulo_anuncio
  ON negocios USING gin(to_tsvector('portuguese', coalesce(titulo_anuncio,'')));
