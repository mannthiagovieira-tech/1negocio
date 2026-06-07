-- F1 · campo keywords_busca em anuncios_v2 (oculto do público).
-- Preenchido pelo consultor na tela admin-anuncios.html. Camada extra na busca do Rafa.
ALTER TABLE public.anuncios_v2 ADD COLUMN IF NOT EXISTS keywords_busca text;

-- Índice trigram pra ILIKE rápido na busca do Rafa
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_anuncios_v2_keywords_trgm
  ON public.anuncios_v2 USING gin (keywords_busca gin_trgm_ops);

-- F2 · vínculo idempotente chat_ia_leads → negocio rascunho.
-- Permite UPDATE em vez de INSERT quando o lead refaz a faixa rápida.
ALTER TABLE public.chat_ia_leads ADD COLUMN IF NOT EXISTS negocio_rascunho_id uuid
  REFERENCES public.negocios(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_chat_ia_leads_negocio_rascunho
  ON public.chat_ia_leads (negocio_rascunho_id) WHERE negocio_rascunho_id IS NOT NULL;
