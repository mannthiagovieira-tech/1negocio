-- Slice P5 · A · Criativos gerados no sistema · evolui va_criativos in-place.

ALTER TABLE va_criativos
  ADD COLUMN IF NOT EXISTS arquetipo_id uuid REFERENCES va_arquetipos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS formato text,
  ADD COLUMN IF NOT EXISTS layout text,
  ADD COLUMN IF NOT EXISTS headline text,
  ADD COLUMN IF NOT EXISTS texto text,
  ADD COLUMN IF NOT EXISTS cta text,
  ADD COLUMN IF NOT EXISTS png_path text,
  ADD COLUMN IF NOT EXISTS html_snapshot text,
  ADD COLUMN IF NOT EXISTS versao integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'ia';

ALTER TABLE va_criativos DROP CONSTRAINT IF EXISTS va_criativos_formato_check;
ALTER TABLE va_criativos ADD CONSTRAINT va_criativos_formato_check
  CHECK (formato IS NULL OR formato IN ('feed_1080','story_1080x1920','link_1200x628'));
ALTER TABLE va_criativos DROP CONSTRAINT IF EXISTS va_criativos_layout_check;
ALTER TABLE va_criativos ADD CONSTRAINT va_criativos_layout_check
  CHECK (layout IS NULL OR layout IN ('tipografico_a','tipografico_b','dado_destaque'));
ALTER TABLE va_criativos DROP CONSTRAINT IF EXISTS va_criativos_origem_check;
ALTER TABLE va_criativos ADD CONSTRAINT va_criativos_origem_check
  CHECK (origem IN ('ia','manual'));

CREATE OR REPLACE FUNCTION va_criativos_trg_imutavel() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'aprovado' AND (
    NEW.headline IS DISTINCT FROM OLD.headline OR
    NEW.texto IS DISTINCT FROM OLD.texto OR
    NEW.cta IS DISTINCT FROM OLD.cta OR
    NEW.layout IS DISTINCT FROM OLD.layout OR
    NEW.png_path IS DISTINCT FROM OLD.png_path
  ) THEN
    IF NEW.status <> 'arquivado' THEN
      RAISE EXCEPTION 'CRIATIVO_APROVADO_IMUTAVEL · alteração só via nova versão';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS va_criativos_imutavel ON va_criativos;
CREATE TRIGGER va_criativos_imutavel BEFORE UPDATE ON va_criativos
  FOR EACH ROW EXECUTE FUNCTION va_criativos_trg_imutavel();

CREATE INDEX IF NOT EXISTS va_criativos_arquetipo_idx ON va_criativos(arquetipo_id) WHERE arquetipo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS va_criativos_status_idx ON va_criativos(projeto_id, status);
