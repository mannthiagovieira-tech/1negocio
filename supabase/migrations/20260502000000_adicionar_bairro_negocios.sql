ALTER TABLE negocios ADD COLUMN IF NOT EXISTS bairro TEXT;
COMMENT ON COLUMN negocios.bairro IS
  'Bairro coletado no diagnóstico. Opcional. Usado pra precisão de localização no dossiê pós-NDA.';
