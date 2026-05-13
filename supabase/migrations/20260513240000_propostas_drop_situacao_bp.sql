-- v9.34.6 · remove campo situacao_bp da proposta (não usado mais no template)
ALTER TABLE propostas_comerciais DROP COLUMN IF EXISTS situacao_bp;
