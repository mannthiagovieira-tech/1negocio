-- Migration 022: Coluna textos_negocio em anuncios_v2
-- Cache dos 7 textos focados em comprador (6 públicos + 1 pós-NDA)
-- Gerados sob demanda pela Edge Function gerar_textos_anuncio

BEGIN;

ALTER TABLE anuncios_v2
ADD COLUMN textos_negocio JSONB DEFAULT '{}'::jsonb;

ALTER TABLE anuncios_v2
ADD COLUMN textos_negocio_geradas_em TIMESTAMPTZ;

COMMENT ON COLUMN anuncios_v2.textos_negocio IS
'Textos do anúncio focados em comprador. Gerados sob demanda via Edge gerar_textos_anuncio. Schema: {titulo_negocio: {conteudo, modelo, gerado_em}, descricao_publica: {...}, ...}';

COMMIT;
