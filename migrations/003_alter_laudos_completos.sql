-- Bloco SQL #3: Adicionar versionamento na tabela laudos_completos
-- Construtivo - apenas adiciona colunas (nullable em registros existentes)

ALTER TABLE laudos_completos
  ADD COLUMN IF NOT EXISTS versao INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS parametros_versao_id TEXT REFERENCES parametros_versoes(id);

-- Indice para buscas rapidas do laudo ativo de cada negocio
CREATE INDEX IF NOT EXISTS idx_laudos_negocio_ativo
  ON laudos_completos(negocio_id, ativo)
  WHERE ativo = true;

-- Indice geral por negocio (para historico)
CREATE INDEX IF NOT EXISTS idx_laudos_negocio
  ON laudos_completos(negocio_id);

-- Verificacao - lista as colunas da tabela apos o ALTER
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'laudos_completos'
  AND column_name IN ('versao', 'ativo', 'parametros_versao_id')
ORDER BY column_name;
