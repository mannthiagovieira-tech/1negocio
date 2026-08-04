-- Slice P5 · C · desemboque · rastreio da origem da campanha no lead.
ALTER TABLE va_leads
  ADD COLUMN IF NOT EXISTS campanha_id uuid REFERENCES va_campanhas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS criativo_id uuid REFERENCES va_criativos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ad_ref jsonb;

CREATE INDEX IF NOT EXISTS va_leads_campanha_idx ON va_leads(campanha_id) WHERE campanha_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS va_leads_origem_campanha ON va_leads(projeto_id) WHERE origem='campanha';

CREATE OR REPLACE VIEW va_campanhas_metricas AS
SELECT
  c.id AS campanha_id,
  c.projeto_id,
  c.nome,
  c.status,
  c.gasto_acumulado,
  c.orcamento_total,
  COUNT(l.id) FILTER (WHERE l.origem='campanha') AS conversas_geradas,
  CASE WHEN COUNT(l.id) FILTER (WHERE l.origem='campanha') > 0
       THEN ROUND(c.gasto_acumulado / COUNT(l.id) FILTER (WHERE l.origem='campanha')::numeric, 2)
       ELSE NULL END AS custo_por_conversa,
  COUNT(l.id) FILTER (WHERE l.origem='campanha' AND l.funil_etapa='respondeu') AS respondeu,
  COUNT(l.id) FILTER (WHERE l.origem='campanha' AND l.funil_etapa='em_conversa') AS em_conversa,
  COUNT(l.id) FILTER (WHERE l.origem='campanha' AND l.funil_etapa='promovido') AS promovidos
FROM va_campanhas c
LEFT JOIN va_leads l ON l.campanha_id = c.id
GROUP BY c.id, c.projeto_id, c.nome, c.status, c.gasto_acumulado, c.orcamento_total;

GRANT SELECT ON va_campanhas_metricas TO anon, authenticated;
