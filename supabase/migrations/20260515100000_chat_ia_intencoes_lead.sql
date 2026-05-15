-- v9.36.1 · chat-ia · armazenar intenções identificadas pela IA
-- intencoes[]: avaliar · comprar · vender · ser_parceiro · duvida
ALTER TABLE leads_google ADD COLUMN IF NOT EXISTS intencoes TEXT[] DEFAULT '{}';
ALTER TABLE leads_interessado_ia ADD COLUMN IF NOT EXISTS intencoes TEXT[] DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_leads_google_intencoes ON leads_google USING gin(intencoes);
CREATE INDEX IF NOT EXISTS idx_leads_interessado_ia_intencoes ON leads_interessado_ia USING gin(intencoes);
