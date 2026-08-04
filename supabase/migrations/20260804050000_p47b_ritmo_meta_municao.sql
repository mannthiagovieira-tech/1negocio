-- Slice 4.7 adendo · segunda meta: MUNIÇÃO (leads prontos pra puxar).
ALTER TABLE va_cadencia_config
  ADD COLUMN IF NOT EXISTS meta_fila_minima integer NOT NULL DEFAULT 10;
ALTER TABLE va_cadencia_config
  DROP CONSTRAINT IF EXISTS va_cadencia_config_meta_fila_check;
ALTER TABLE va_cadencia_config
  ADD CONSTRAINT va_cadencia_config_meta_fila_check
    CHECK (meta_fila_minima >= 0 AND meta_fila_minima <= 10000);
COMMENT ON COLUMN va_cadencia_config.meta_fila_minima IS
  '4.7 · meta de MUNIÇÃO · quantos leads na_fila+whatsapp_verificado o operador quer sempre disponíveis. Alerta quando fila cai abaixo disso.';

-- Reescreve va_ritmo_mandato pra incluir meta_fila, antessala e ultima_extracao_dias.
CREATE OR REPLACE FUNCTION va_ritmo_mandato(p_projeto uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cfg AS (
    SELECT COALESCE(meta_toques_dia, 4)     AS meta_dia,
           COALESCE(meta_fila_minima, 10)   AS meta_fila
    FROM va_cadencia_config
    WHERE projeto_id = p_projeto
    LIMIT 1
  ),
  b AS (
    SELECT (date_trunc('week', now() AT TIME ZONE 'America/Sao_Paulo')) AT TIME ZONE 'America/Sao_Paulo' AS inicio_semana
  ),
  toques_manual AS (
    SELECT ll.lead_id, (ll.criado_em AT TIME ZONE 'America/Sao_Paulo')::date AS dia
    FROM va_leads_log ll JOIN va_leads l ON l.id = ll.lead_id
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
  ),
  antessala AS (
    SELECT COUNT(*) AS n FROM va_leads
    WHERE projeto_id = p_projeto AND status = 'antessala'
      AND (blacklist_hit = false OR override_blacklist = true)
  ),
  extr AS (
    SELECT EXTRACT(EPOCH FROM (now() - MAX(criado_em)))/86400 AS dias
    FROM va_extracoes WHERE projeto_id = p_projeto
  )
  SELECT jsonb_build_object(
    'meta_dia',    COALESCE((SELECT meta_dia FROM cfg), 4),
    'meta_semana', COALESCE((SELECT meta_dia FROM cfg), 4) * 5,
    'meta_fila',   COALESCE((SELECT meta_fila FROM cfg), 10),
    'hoje',        (SELECT COUNT(*) FROM toques_dia WHERE dia = ((now() AT TIME ZONE 'America/Sao_Paulo')::date)),
    'semana',      (SELECT COUNT(*) FROM toques_dia),
    'fila_pronta', (SELECT n FROM fila),
    'antessala',   (SELECT n FROM antessala),
    'ultima_extracao_dias', (SELECT COALESCE(ROUND(dias)::int, NULL) FROM extr)
  );
$$;
GRANT EXECUTE ON FUNCTION va_ritmo_mandato(uuid) TO anon, authenticated;
