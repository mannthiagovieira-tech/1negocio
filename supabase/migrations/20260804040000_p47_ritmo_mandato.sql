-- Slice 4.7 · Termômetro de ritmo do mandato.
-- meta_toques_dia = quantos leads o operador se compromete a "puxar" por dia.
-- Meta semanal derivada = meta_dia × 5 (dias úteis). Editável no painel de
-- cadência hoje · FUTURO: será setada no wizard de criação do mandato.

ALTER TABLE va_cadencia_config
  ADD COLUMN IF NOT EXISTS meta_toques_dia integer NOT NULL DEFAULT 4;
ALTER TABLE va_cadencia_config
  DROP CONSTRAINT IF EXISTS va_cadencia_config_meta_toques_check;
ALTER TABLE va_cadencia_config
  ADD CONSTRAINT va_cadencia_config_meta_toques_check
    CHECK (meta_toques_dia >= 0 AND meta_toques_dia <= 200);
COMMENT ON COLUMN va_cadencia_config.meta_toques_dia IS
  '4.7 · meta diária de toques (WhatsApp manual + disparo auto + resposta). Semanal = ×5. Dedupe: 1 lead conta 1 toque no dia.';

-- Função de ritmo · retorna JSON com meta_dia, meta_semana, hoje, semana,
-- fila_pronta (na_fila + whatsapp_verificado=true). Dedupe por (lead_id, data).
-- Fontes contadas como toque outbound do dia:
--   1. va_leads_log acao='contato_manual_iniciado' (clique wa.me)
--   2. va_disparos.status='enviado' de qualquer tipo_envio (cadência + resposta)
-- 'semana' = da segunda-feira ATÉ agora (America/Sao_Paulo). Hoje conta dentro.
CREATE OR REPLACE FUNCTION va_ritmo_mandato(p_projeto uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cfg AS (
    SELECT COALESCE(meta_toques_dia, 4) AS meta_dia
    FROM va_cadencia_config
    WHERE projeto_id = p_projeto
    LIMIT 1
  ),
  b AS (
    SELECT
      (date_trunc('day',  now() AT TIME ZONE 'America/Sao_Paulo')) AT TIME ZONE 'America/Sao_Paulo' AS inicio_dia,
      (date_trunc('week', now() AT TIME ZONE 'America/Sao_Paulo')) AT TIME ZONE 'America/Sao_Paulo' AS inicio_semana
  ),
  toques_manual AS (
    SELECT ll.lead_id, (ll.criado_em AT TIME ZONE 'America/Sao_Paulo')::date AS dia
    FROM va_leads_log ll
    JOIN va_leads l ON l.id = ll.lead_id
    WHERE l.projeto_id = p_projeto
      AND ll.acao = 'contato_manual_iniciado'
      AND ll.criado_em >= (SELECT inicio_semana FROM b)
  ),
  toques_disparo AS (
    SELECT d.lead_id, (d.enviado_em AT TIME ZONE 'America/Sao_Paulo')::date AS dia
    FROM va_disparos d
    WHERE d.projeto_id = p_projeto
      AND d.status = 'enviado'
      AND d.enviado_em >= (SELECT inicio_semana FROM b)
  ),
  toques_dia AS (
    SELECT DISTINCT lead_id, dia FROM toques_manual
    UNION
    SELECT DISTINCT lead_id, dia FROM toques_disparo
  ),
  fila AS (
    SELECT COUNT(*) AS n FROM va_leads
    WHERE projeto_id = p_projeto AND funil_etapa = 'na_fila'
      AND pausado = false AND whatsapp_verificado = true
  )
  SELECT jsonb_build_object(
    'meta_dia',    COALESCE((SELECT meta_dia FROM cfg), 4),
    'meta_semana', COALESCE((SELECT meta_dia FROM cfg), 4) * 5,
    'hoje',        (SELECT COUNT(*) FROM toques_dia WHERE dia = ((now() AT TIME ZONE 'America/Sao_Paulo')::date)),
    'semana',      (SELECT COUNT(*) FROM toques_dia),
    'fila_pronta', (SELECT n FROM fila)
  );
$$;
GRANT EXECUTE ON FUNCTION va_ritmo_mandato(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION va_ritmo_carteira(p_projetos uuid[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_object_agg(pid::text, va_ritmo_mandato(pid)), '{}'::jsonb)
  FROM unnest(p_projetos) AS pid;
$$;
GRANT EXECUTE ON FUNCTION va_ritmo_carteira(uuid[]) TO anon, authenticated;
