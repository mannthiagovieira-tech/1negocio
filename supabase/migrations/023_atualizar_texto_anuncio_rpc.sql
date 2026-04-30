-- Migration 023: RPC atomic pra atualizar anuncios_v2.textos_negocio
-- Resolve race condition: 7 chamadas paralelas da Edge gerar_textos_anuncio
-- estavam fazendo last-writer-wins porque cada uma fazia
-- (read + spread + write) num jsonb inteiro.
-- Esta RPC usa jsonb_set atômico — escreve só a chave específica.

BEGIN;

CREATE OR REPLACE FUNCTION atualizar_texto_anuncio(
  p_anuncio_id UUID,
  p_chave TEXT,
  p_valor JSONB
) RETURNS VOID AS $$
BEGIN
  UPDATE anuncios_v2
  SET
    textos_negocio = jsonb_set(
      COALESCE(textos_negocio, '{}'::jsonb),
      ARRAY[p_chave],
      p_valor,
      true
    ),
    textos_negocio_geradas_em = NOW()
  WHERE id = p_anuncio_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Anúncio % não encontrado', p_anuncio_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMIT;
