-- Fix migration anterior (20260802030000) · CREATE TABLE IF NOT EXISTS foi no-op
-- em va_projeto_teaser porque a tabela já existia (002_arquetipos_anexos_teaser.sql).
-- Adiciona colunas de teaser gerado por IA e fecha RLS de contexto/hist.

ALTER TABLE va_projeto_teaser ADD COLUMN IF NOT EXISTS angulo text;
ALTER TABLE va_projeto_teaser ADD COLUMN IF NOT EXISTS gerado_por text;
ALTER TABLE va_projeto_teaser ADD COLUMN IF NOT EXISTS gerado_em timestamptz;

ALTER TABLE va_projeto_contexto ENABLE ROW LEVEL SECURITY;
ALTER TABLE va_projeto_descricao_hist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS va_projeto_contexto_admin ON va_projeto_contexto;
DROP POLICY IF EXISTS va_projeto_descricao_hist_admin ON va_projeto_descricao_hist;
CREATE POLICY va_projeto_contexto_admin ON va_projeto_contexto
  FOR ALL TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
CREATE POLICY va_projeto_descricao_hist_admin ON va_projeto_descricao_hist
  FOR ALL TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
