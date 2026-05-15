-- Migration 018: Trigger pra gerar código de anuncios_v2 automaticamente
-- Permite INSERT sem precisar passar codigo explicitamente

BEGIN;

CREATE OR REPLACE FUNCTION setar_codigo_anuncio_se_vazio()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.codigo IS NULL OR NEW.codigo = '' THEN
    NEW.codigo := gerar_codigo_anuncio();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_anuncios_v2_codigo_auto
  BEFORE INSERT ON anuncios_v2
  FOR EACH ROW EXECUTE FUNCTION setar_codigo_anuncio_se_vazio();

COMMIT;
