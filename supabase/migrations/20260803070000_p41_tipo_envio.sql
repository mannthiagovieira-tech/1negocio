-- P4.1 · va_disparos ganha tipo_envio (cadencia vs resposta personalizada)
ALTER TABLE va_disparos
  ADD COLUMN IF NOT EXISTS tipo_envio text NOT NULL DEFAULT 'cadencia'
    CHECK (tipo_envio IN ('cadencia','resposta'));
CREATE INDEX IF NOT EXISTS idx_disp_tipo ON va_disparos(projeto_id, tipo_envio);
