-- Vincular avaliação (laudos_v2) ao projeto VA · sem trigger, sob demanda.
-- Não altera negocios/laudos_v2. Só lê + espelha em va_projetos e congela snapshot.

ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS avaliacao_origem_id uuid;
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS laudo_v2_id uuid;
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS valor_avaliacao numeric;
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS valor_avaliacao_min numeric;
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS valor_avaliacao_max numeric;
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS avaliacao_setor text;
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS avaliacao_cidade text;
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS avaliacao_uf text;
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS avaliacao_vinculada_em timestamptz;

CREATE TABLE IF NOT EXISTS va_projeto_avaliacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  negocio_id uuid,
  laudo_v2_id uuid,
  parametros_versao_id text,
  calc_json_snapshot jsonb NOT NULL,
  codigo_diagnostico text,
  vinculada_em timestamptz NOT NULL DEFAULT now(),
  vinculada_por text,
  UNIQUE (projeto_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON va_projeto_avaliacao TO authenticated, service_role;

CREATE OR REPLACE FUNCTION va_vincular_avaliacao(p_projeto_id uuid, p_busca text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE
  v_busca text := trim(p_busca);
  v_negocio_id uuid; v_codigo text;
  v_negocio record; v_laudo record; v_calc jsonb;
  v_vv numeric; v_vv_min numeric; v_vv_max numeric;
BEGIN
  IF v_busca ~* '[?&]id=' THEN
    v_busca := regexp_replace(v_busca, '.*[?&]id=([0-9a-fA-F-]{36}).*', '\1', 'g');
  END IF;
  IF v_busca ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_negocio_id := v_busca::uuid;
  ELSIF v_busca ~* '^1N-[A-Z0-9]{5,8}$' THEN
    v_codigo := upper(v_busca);
    SELECT id INTO v_negocio_id FROM negocios WHERE upper(codigo_diagnostico) = v_codigo LIMIT 1;
    IF v_negocio_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'código não encontrado', 'busca', v_busca);
    END IF;
  ELSE
    RETURN jsonb_build_object('ok', false, 'erro', 'formato inválido · use código 1N-XXXX, UUID ou URL do laudo', 'busca', v_busca);
  END IF;

  SELECT * INTO v_negocio FROM negocios WHERE id = v_negocio_id;
  IF v_negocio IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'negócio não encontrado', 'id', v_negocio_id);
  END IF;

  SELECT id, calc_json, parametros_versao_id INTO v_laudo
    FROM laudos_v2 WHERE negocio_id = v_negocio_id AND ativo = true LIMIT 1;
  IF v_laudo IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_laudo_v2',
      'mensagem', 'este negócio ainda não tem avaliação v2 · precisa fazer no diagnóstico primeiro',
      'negocio_id', v_negocio_id, 'codigo_diagnostico', v_negocio.codigo_diagnostico);
  END IF;

  v_calc := v_laudo.calc_json;
  v_vv := (v_calc->'valuation'->>'valor_venda')::numeric;
  IF v_vv IS NULL OR v_vv = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'valor_venda_ausente',
      'mensagem', 'o calc_json existe mas não tem valor_venda · avaliação incompleta',
      'negocio_id', v_negocio_id, 'codigo_diagnostico', v_negocio.codigo_diagnostico);
  END IF;
  v_vv_min := ROUND(v_vv * 0.85, 2);
  v_vv_max := ROUND(v_vv * 1.15, 2);

  UPDATE va_projetos SET
    avaliacao_origem_id = v_negocio_id,
    laudo_v2_id = v_laudo.id,
    valor_avaliacao = v_vv,
    valor_avaliacao_min = v_vv_min,
    valor_avaliacao_max = v_vv_max,
    avaliacao_setor = COALESCE(v_calc->'identificacao'->'setor'->>'code', v_negocio.setor),
    avaliacao_cidade = COALESCE(v_calc->'identificacao'->'localizacao'->>'cidade', v_negocio.cidade),
    avaliacao_uf = COALESCE(v_calc->'identificacao'->'localizacao'->>'estado', v_negocio.estado::text),
    avaliacao_vinculada_em = now()
  WHERE id = p_projeto_id;

  INSERT INTO va_projeto_avaliacao
    (projeto_id, negocio_id, laudo_v2_id, parametros_versao_id, calc_json_snapshot, codigo_diagnostico, vinculada_por)
  VALUES (p_projeto_id, v_negocio_id, v_laudo.id, v_laudo.parametros_versao_id, v_calc,
          v_negocio.codigo_diagnostico, COALESCE(current_setting('request.jwt.claims',true)::jsonb->>'email','admin'))
  ON CONFLICT (projeto_id) DO UPDATE SET
    negocio_id = EXCLUDED.negocio_id, laudo_v2_id = EXCLUDED.laudo_v2_id,
    parametros_versao_id = EXCLUDED.parametros_versao_id,
    calc_json_snapshot = EXCLUDED.calc_json_snapshot,
    codigo_diagnostico = EXCLUDED.codigo_diagnostico,
    vinculada_em = now(), vinculada_por = EXCLUDED.vinculada_por;

  RETURN jsonb_build_object(
    'ok', true, 'negocio_id', v_negocio_id, 'codigo_diagnostico', v_negocio.codigo_diagnostico,
    'valor_venda', v_vv, 'valor_min', v_vv_min, 'valor_max', v_vv_max,
    'setor', v_calc->'identificacao'->'setor'->>'label',
    'ise_total', (v_calc->'ise'->>'ise_total')::int,
    'atratividade', (v_calc->'atratividade'->>'total')::int,
    'parametros_versao', v_laudo.parametros_versao_id
  );
END; $$;
GRANT EXECUTE ON FUNCTION va_vincular_avaliacao(uuid, text) TO authenticated, service_role;
