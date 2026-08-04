-- Slice P5 · B · va_campanhas evolução (regra 4 · evoluir, não duplicar).
ALTER TABLE va_campanhas
  ADD COLUMN IF NOT EXISTS criativo_id uuid REFERENCES va_criativos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS arquetipo_id uuid REFERENCES va_arquetipos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS publico jsonb,
  ADD COLUMN IF NOT EXISTS instancia_whatsapp text,
  ADD COLUMN IF NOT EXISTS meta_campaign_id text,
  ADD COLUMN IF NOT EXISTS meta_adset_id text,
  ADD COLUMN IF NOT EXISTS meta_ad_id text,
  ADD COLUMN IF NOT EXISTS meta_creative_id text,
  ADD COLUMN IF NOT EXISTS gasto_acumulado numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS objetivo_meta text,
  ADD COLUMN IF NOT EXISTS publicado_em timestamptz,
  ADD COLUMN IF NOT EXISTS aprovado_em timestamptz;

ALTER TABLE va_campanhas DROP CONSTRAINT IF EXISTS va_campanhas_status_check;
ALTER TABLE va_campanhas ADD CONSTRAINT va_campanhas_status_check
  CHECK (status IN ('rascunho','aprovada','publicada','ativa','pausada','encerrada'));

ALTER TABLE va_campanhas DROP CONSTRAINT IF EXISTS va_campanhas_objetivo_meta_check;
ALTER TABLE va_campanhas ADD CONSTRAINT va_campanhas_objetivo_meta_check
  CHECK (objetivo_meta IS NULL OR objetivo_meta IN ('ctwa','leadgen','trafego'));

CREATE OR REPLACE VIEW va_projetos_metricas_campanhas AS
SELECT
  c.projeto_id,
  COUNT(*) AS n_campanhas,
  COUNT(*) FILTER (WHERE c.status IN ('ativa','publicada')) AS n_ativas,
  COALESCE(SUM(c.gasto_acumulado), 0) AS gasto_total,
  COALESCE(SUM(c.orcamento_total), 0) AS orcamento_total,
  (SELECT COUNT(*) FROM va_leads l WHERE l.projeto_id = c.projeto_id AND l.origem = 'campanha') AS conversas_geradas,
  CASE WHEN (SELECT COUNT(*) FROM va_leads l WHERE l.projeto_id = c.projeto_id AND l.origem = 'campanha') > 0
       THEN ROUND(COALESCE(SUM(c.gasto_acumulado), 0) / (SELECT COUNT(*) FROM va_leads l WHERE l.projeto_id = c.projeto_id AND l.origem = 'campanha')::numeric, 2)
       ELSE NULL END AS custo_medio_por_conversa
FROM va_campanhas c
GROUP BY c.projeto_id;

GRANT SELECT ON va_projetos_metricas_campanhas TO anon, authenticated;
