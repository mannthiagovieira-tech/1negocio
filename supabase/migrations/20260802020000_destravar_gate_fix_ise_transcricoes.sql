-- 3 correções aplicadas via MCP · rastro versionado
-- (a) va_onda_operacional passa a retornar SEMPRE operacional=true
-- (b) va_vincular_avaliacao · casts pra numeric (era int e quebrava com 71.4)
-- (c) bucket + tabela pra transcrições do projeto

-- (a)
CREATE OR REPLACE FUNCTION va_onda_operacional(p_projeto_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE o record;
BEGIN
  SELECT * INTO o FROM va_projeto_ondas WHERE projeto_id = p_projeto_id ORDER BY numero DESC LIMIT 1;
  RETURN jsonb_build_object('operacional', true, 'mensagem', 'ok · gate financeiro desativado (registro apenas)',
    'onda_id', o.id, 'status', COALESCE(o.status, 'sem_onda'), 'numero', o.numero);
END; $$;

-- (b) só mudança dos casts finais (::int -> ::numeric) no return jsonb
CREATE OR REPLACE FUNCTION va_vincular_avaliacao(p_projeto_id uuid, p_busca text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE
  v_busca text := trim(p_busca);
  v_negocio_id uuid; v_codigo text;
  v_negocio record; v_laudo record; v_calc jsonb;
  v_vv numeric; v_vv_min numeric; v_vv_max numeric;
BEGIN
  IF v_busca ~* '[?&]id=' THEN v_busca := regexp_replace(v_busca, '.*[?&]id=([0-9a-fA-F-]{36}).*', '\1', 'g'); END IF;
  IF v_busca ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_negocio_id := v_busca::uuid;
  ELSIF v_busca ~* '^1N-[A-Z0-9]{5,8}$' THEN
    v_codigo := upper(v_busca);
    SELECT id INTO v_negocio_id FROM negocios WHERE upper(codigo_diagnostico) = v_codigo LIMIT 1;
    IF v_negocio_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'código não encontrado', 'busca', v_busca); END IF;
  ELSE
    RETURN jsonb_build_object('ok', false, 'erro', 'formato inválido · use código 1N-XXXX, UUID ou URL do laudo', 'busca', v_busca);
  END IF;
  SELECT * INTO v_negocio FROM negocios WHERE id = v_negocio_id;
  IF v_negocio IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'negócio não encontrado', 'id', v_negocio_id); END IF;
  SELECT id, calc_json, parametros_versao_id INTO v_laudo FROM laudos_v2 WHERE negocio_id = v_negocio_id AND ativo = true LIMIT 1;
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
  v_vv_min := ROUND(v_vv * 0.85, 2); v_vv_max := ROUND(v_vv * 1.15, 2);
  UPDATE va_projetos SET
    avaliacao_origem_id = v_negocio_id, laudo_v2_id = v_laudo.id,
    valor_avaliacao = v_vv, valor_avaliacao_min = v_vv_min, valor_avaliacao_max = v_vv_max,
    avaliacao_setor = COALESCE(v_calc->'identificacao'->'setor'->>'code', v_negocio.setor),
    avaliacao_cidade = COALESCE(v_calc->'identificacao'->'localizacao'->>'cidade', v_negocio.cidade),
    avaliacao_uf = COALESCE(v_calc->'identificacao'->'localizacao'->>'estado', v_negocio.estado::text),
    avaliacao_vinculada_em = now()
  WHERE id = p_projeto_id;
  INSERT INTO va_projeto_avaliacao (projeto_id, negocio_id, laudo_v2_id, parametros_versao_id, calc_json_snapshot, codigo_diagnostico, vinculada_por)
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
    'ise_total', (v_calc->'ise'->>'ise_total')::numeric,
    'atratividade', (v_calc->'atratividade'->>'total')::numeric,
    'parametros_versao', v_laudo.parametros_versao_id
  );
END; $$;
GRANT EXECUTE ON FUNCTION va_vincular_avaliacao(uuid, text) TO authenticated, service_role;

-- (c) transcrições
INSERT INTO storage.buckets (id, name, public) VALUES ('projeto-transcricoes', 'projeto-transcricoes', false) ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "va_admin_read_transcricoes" ON storage.objects;
DROP POLICY IF EXISTS "va_admin_write_transcricoes" ON storage.objects;
CREATE POLICY "va_admin_read_transcricoes" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'projeto-transcricoes');
CREATE POLICY "va_admin_write_transcricoes" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'projeto-transcricoes');
CREATE TABLE IF NOT EXISTS va_projeto_transcricoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  titulo text, data_reuniao date,
  origem text NOT NULL CHECK (origem IN ('upload','colado')),
  arquivo_path text, conteudo text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por text
);
GRANT SELECT, INSERT, UPDATE, DELETE ON va_projeto_transcricoes TO authenticated, service_role;
