-- v9.34.6 final · drop situacao_bp depois do deploy da edge v9.34.6 (não usa mais)
ALTER TABLE propostas_comerciais DROP COLUMN IF EXISTS situacao_bp;
