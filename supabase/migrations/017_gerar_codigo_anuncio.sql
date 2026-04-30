-- Migration 017: Função gerar_codigo_anuncio — código único anti-colisão
-- Formato: 1N-AN-XXXXX (5 chars uppercase de md5)

CREATE OR REPLACE FUNCTION gerar_codigo_anuncio()
RETURNS TEXT AS $$
DECLARE
  novo_codigo TEXT;
  tentativas INT := 0;
BEGIN
  LOOP
    novo_codigo := '1N-AN-' || upper(substring(md5(random()::text || clock_timestamp()::text) for 5));

    IF NOT EXISTS (SELECT 1 FROM anuncios_v2 WHERE codigo = novo_codigo) THEN
      RETURN novo_codigo;
    END IF;

    tentativas := tentativas + 1;
    IF tentativas > 10 THEN
      RAISE EXCEPTION 'Não foi possível gerar código único após 10 tentativas';
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
