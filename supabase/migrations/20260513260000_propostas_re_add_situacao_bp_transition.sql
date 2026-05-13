-- v9.34.6 transição · re-adiciona situacao_bp como nullable até deploy da edge nova (cota Supabase)
-- Quando edge v9.34.6 for deployada (não envia mais situacao_bp), rodar:
--   ALTER TABLE propostas_comerciais DROP COLUMN situacao_bp;
ALTER TABLE propostas_comerciais ADD COLUMN IF NOT EXISTS situacao_bp text;
