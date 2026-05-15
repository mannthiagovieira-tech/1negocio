-- v9.33.5 · leads_status_score · prepara UI completa de leads
-- Schema state atual:
--   score_ia integer (já existe · CHECK 0-100)
--   razao_score text (já existe · usado como score_motivo)
--   status text (CHECK ['bruto','classificado','aprovado','rejeitado','no_pool']) · vai trocar
-- 106 leads existentes · todos status='bruto' · CHECK trocável sem migrar dados.

-- 1) CHECK status novo (5 valores canônicos do operador)
ALTER TABLE originacao_leads_brutos
  DROP CONSTRAINT IF EXISTS originacao_leads_brutos_status_check;

ALTER TABLE originacao_leads_brutos
  ADD CONSTRAINT originacao_leads_brutos_status_check
  CHECK (status IS NULL OR status IN (
    'bruto', 'util', 'irrelevante', 'contatado', 'respondeu'
  ));

-- 2) Campos novos · tags + nota + timestamps de ações
ALTER TABLE originacao_leads_brutos
  ADD COLUMN IF NOT EXISTS tags_ia jsonb,
  ADD COLUMN IF NOT EXISTS nota_admin text,
  ADD COLUMN IF NOT EXISTS marcado_em timestamptz,
  ADD COLUMN IF NOT EXISTS contatado_em timestamptz;

-- 3) Indexes pra filtros rápidos na aba "Leads"
CREATE INDEX IF NOT EXISTS idx_leads_brutos_status_orig
  ON originacao_leads_brutos (originacao_id, status);

CREATE INDEX IF NOT EXISTS idx_leads_brutos_score
  ON originacao_leads_brutos (originacao_id, score_ia DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_leads_brutos_arquetipo
  ON originacao_leads_brutos (originacao_id, arquetipo_id);
