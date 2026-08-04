-- Slice 4.6 · modo manual/auto na config de cadência. Default manual
-- (disparador automático fica dormindo até operador ligar explicitamente).
ALTER TABLE va_cadencia_config
  ADD COLUMN IF NOT EXISTS modo text NOT NULL DEFAULT 'manual';

ALTER TABLE va_cadencia_config
  DROP CONSTRAINT IF EXISTS va_cadencia_config_modo_check;
ALTER TABLE va_cadencia_config
  ADD CONSTRAINT va_cadencia_config_modo_check CHECK (modo IN ('manual','auto'));

COMMENT ON COLUMN va_cadencia_config.modo IS
  '4.6 · manual (default) = tick não envia · botão wa.me + copy template no card. auto = tick automático (envia via Z-API respeitando teto/janela).';
