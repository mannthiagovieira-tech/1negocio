-- v9.34.6 · cidade/estado opcionais (Fix 6) + telefone proprietário opcional (Fix 10)
ALTER TABLE propostas_comerciais ADD COLUMN IF NOT EXISTS cidade text;
ALTER TABLE propostas_comerciais ADD COLUMN IF NOT EXISTS estado text;
ALTER TABLE propostas_comerciais ADD COLUMN IF NOT EXISTS telefone_proprietario text;
