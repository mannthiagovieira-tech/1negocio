-- P5.3 · trava de orçamento por ciclo do mandato

ALTER TABLE va_projetos
  ADD COLUMN IF NOT EXISTS credito_ciclo numeric,
  ADD COLUMN IF NOT EXISTS ciclo_inicio date;

COMMENT ON COLUMN va_projetos.credito_ciclo IS
  'P5.3 · crédito liberado por ciclo de 30 dias · null = sem trava (legado)';
COMMENT ON COLUMN va_projetos.ciclo_inicio IS
  'P5.3 · data do início do 1º ciclo · ciclos rolam 30 dias';

-- Arte Deli · R$ 750/ciclo
UPDATE va_projetos
SET credito_ciclo = 750.00,
    ciclo_inicio = COALESCE(ciclo_inicio, data_inicio, CURRENT_DATE)
WHERE id = 'b676073a-6074-48d4-a608-7947de006dff';

-- RPC saldo do ciclo · ciclo 0 = do ciclo_inicio +0..29d · próximos +30d
CREATE OR REPLACE FUNCTION va_saldo_ciclo(p_projeto uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH p AS (SELECT credito_ciclo, ciclo_inicio FROM va_projetos WHERE id = p_projeto),
  b AS (SELECT COALESCE((SELECT credito_ciclo FROM p), 0)::numeric AS credito,
               COALESCE((SELECT ciclo_inicio FROM p), CURRENT_DATE)::date AS inicio_base),
  ciclo AS (SELECT GREATEST(0, FLOOR(((now() AT TIME ZONE 'America/Sao_Paulo')::date - inicio_base) / 30.0))::int AS n,
                   inicio_base FROM b),
  bordas AS (SELECT (ciclo.inicio_base + (ciclo.n * 30))::date AS ciclo_de,
                    (ciclo.inicio_base + ((ciclo.n + 1) * 30) - 1)::date AS ciclo_ate FROM ciclo),
  consumo AS (SELECT COALESCE(SUM(valor_total), 0)::numeric AS c FROM va_projeto_razao r, bordas
              WHERE r.projeto_id = p_projeto
                AND (r.criado_em AT TIME ZONE 'America/Sao_Paulo')::date >= bordas.ciclo_de
                AND (r.criado_em AT TIME ZONE 'America/Sao_Paulo')::date <= bordas.ciclo_ate)
  SELECT jsonb_build_object('credito', (SELECT credito FROM b), 'consumido', (SELECT c FROM consumo),
    'saldo', (SELECT credito FROM b) - (SELECT c FROM consumo), 'ciclo_de', (SELECT ciclo_de FROM bordas),
    'ciclo_ate', (SELECT ciclo_ate FROM bordas), 'ciclo_n', (SELECT n FROM ciclo));
$$;
GRANT EXECUTE ON FUNCTION va_saldo_ciclo(uuid) TO anon, authenticated;

-- Wrapper com gate · credito_ciclo NULL = retrocompat sem trava
CREATE OR REPLACE FUNCTION va_debitar_seguro(
  p_projeto uuid, p_tipo text, p_qtd numeric, p_referencia text,
  p_ciclo integer DEFAULT NULL, p_excedente_autorizado boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_credito numeric; v_saldo_num numeric; v_saldo jsonb; v_razao_id uuid; v_ref text;
BEGIN
  SELECT credito_ciclo INTO v_credito FROM va_projetos WHERE id = p_projeto;
  IF v_credito IS NOT NULL THEN
    v_saldo := va_saldo_ciclo(p_projeto);
    v_saldo_num := (v_saldo->>'saldo')::numeric;
    IF v_saldo_num <= 0 AND NOT p_excedente_autorizado THEN
      RAISE EXCEPTION 'CREDITO_CICLO_ESGOTADO · consumido % de %', (v_saldo->>'consumido'), v_credito USING ERRCODE = 'P0001';
    END IF;
  END IF;
  v_ref := CASE WHEN p_excedente_autorizado THEN '[EXCEDENTE_AUTORIZADO] ' || p_referencia ELSE p_referencia END;
  v_razao_id := va_debitar(p_projeto, p_tipo, p_qtd, v_ref, p_ciclo);
  RETURN jsonb_build_object('razao_id', v_razao_id, 'excedente_autorizado', p_excedente_autorizado, 'saldo_pos', va_saldo_ciclo(p_projeto));
END; $$;
GRANT EXECUTE ON FUNCTION va_debitar_seguro(uuid, text, numeric, text, integer, boolean) TO anon, authenticated;
