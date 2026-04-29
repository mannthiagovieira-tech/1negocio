-- RPC functions atômicas pra Edge Function gerar_textos_laudo
-- Resolvem concorrência: 9 fetches paralelos modificam calc_json sem
-- last-writer-wins porque jsonb_set é atômico no UPDATE.

-- Atualiza UM texto específico em calc_json
CREATE OR REPLACE FUNCTION atualizar_texto_calc_json(
  p_negocio_id UUID,
  p_path TEXT,        -- ex: '{textos_ia,texto_parecer_tecnico}'
  p_valor JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE laudos_v2
  SET calc_json = jsonb_set(
    calc_json,
    p_path::text[],
    p_valor,
    true
  )
  WHERE negocio_id = p_negocio_id
    AND ativo = true;
END;
$$;

-- Atualiza metadados (timestamp + modelo) em um único UPDATE atômico
CREATE OR REPLACE FUNCTION atualizar_metadados_textos(
  p_negocio_id UUID,
  p_ramo TEXT,        -- 'textos_ia' ou 'textos_anuncio'
  p_chave TEXT,       -- ex: 'texto_parecer_tecnico'
  p_modelo TEXT,
  p_timestamp TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE laudos_v2
  SET calc_json = jsonb_set(
    jsonb_set(
      calc_json,
      ARRAY[p_ramo, '_modelos_usados', p_chave],
      to_jsonb(p_modelo),
      true
    ),
    ARRAY[p_ramo, '_gerados_em'],
    to_jsonb(p_timestamp),
    true
  )
  WHERE negocio_id = p_negocio_id
    AND ativo = true;
END;
$$;

GRANT EXECUTE ON FUNCTION atualizar_texto_calc_json TO anon, authenticated;
GRANT EXECUTE ON FUNCTION atualizar_metadados_textos TO anon, authenticated;

COMMENT ON FUNCTION atualizar_texto_calc_json IS
  'Atualiza UM texto específico em calc_json atômicamente. Usado pela Edge Function gerar_textos_laudo.';
COMMENT ON FUNCTION atualizar_metadados_textos IS
  'Atualiza _modelos_usados e _gerados_em atômicamente. Usado pela Edge Function.';
