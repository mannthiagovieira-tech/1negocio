-- v9.31.1 · fix view com desempate determinístico
-- Aplicada via MCP apply_migration em 2026-05-12 · arquivo aqui só pra histórico em git
--
-- Bug encontrado: havia 3 rows projetos_originacao pro mesmo projeto Forste
-- (versao=1 em todas · criadas por sessões antigas com edges deprecated).
-- View original tinha `ORDER BY projeto_id, versao DESC` sem desempate →
-- DISTINCT ON retornava qualquer uma · non-determinístico. Edge fazia UPDATE
-- na row "A" e frontend re-fetchava e via row "B" sem briefing → empty state.
--
-- Fix:
-- 1. Drop+recreate view com `ORDER BY projeto_id, versao DESC, created_at DESC`
--    (desempate por mais recente)
-- 2. Arquiva rows órfãs sem briefing nem tese pros projetos que já têm uma row
--    com briefing/tese (limpa duplicatas históricas)

DROP VIEW IF EXISTS projetos_originacao_atual;

CREATE VIEW projetos_originacao_atual AS
SELECT
  o.*,
  (SELECT count(*) FROM arquetipos_compradores
   WHERE originacao_id = o.id AND status IN ('aprovado','editado_admin','criado_admin')) AS arquetipos_aprovados_count,
  (SELECT count(*) FROM arquetipos_compradores
   WHERE originacao_id = o.id AND status = 'candidato') AS arquetipos_pendentes_count,
  (SELECT count(*) FROM originacao_leads_brutos
   WHERE originacao_id = o.id) AS leads_brutos_count,
  (SELECT count(*) FROM originacao_leads_brutos
   WHERE originacao_id = o.id AND enriquecido = true) AS leads_enriquecidos_count,
  (SELECT count(*) FROM originacao_chat_mensagens
   WHERE originacao_id = o.id) AS chat_mensagens_count
FROM (
  SELECT DISTINCT ON (projeto_id) *
  FROM projetos_originacao
  WHERE status != 'arquivado'
  ORDER BY projeto_id, versao DESC, created_at DESC
) o;

-- Cleanup: arquiva rows órfãs (sem briefing E sem tese) pra projetos que já têm
-- ao menos 1 row com briefing/tese
UPDATE projetos_originacao
SET status = 'arquivado', updated_at = now()
WHERE briefing_jsonb IS NULL
  AND tese_texto IS NULL
  AND status = 'rascunho'
  AND projeto_id IN (
    SELECT projeto_id FROM projetos_originacao
    WHERE briefing_jsonb IS NOT NULL OR tese_texto IS NOT NULL
  );
