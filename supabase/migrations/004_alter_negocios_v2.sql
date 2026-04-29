-- Bloco SQL #4: Adicionar campos v2 e hooks da Rede de Parceiros
-- Decisao #21: estrategia paralela, apenas ADD COLUMN nullable

ALTER TABLE negocios
  ADD COLUMN IF NOT EXISTS dossie_json JSONB,
  ADD COLUMN IF NOT EXISTS parceiro_origem_id UUID,
  ADD COLUMN IF NOT EXISTS parceiro_destino_id UUID,
  ADD COLUMN IF NOT EXISTS tese_id UUID;

-- Indices para os hooks da Rede (apenas onde tem valor preenchido)
CREATE INDEX IF NOT EXISTS idx_negocios_parceiro_origem
  ON negocios(parceiro_origem_id)
  WHERE parceiro_origem_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_negocios_parceiro_destino
  ON negocios(parceiro_destino_id)
  WHERE parceiro_destino_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_negocios_tese
  ON negocios(tese_id)
  WHERE tese_id IS NOT NULL;

-- Verificacao - lista as 4 colunas adicionadas
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'negocios'
  AND column_name IN ('dossie_json', 'parceiro_origem_id', 'parceiro_destino_id', 'tese_id')
ORDER BY column_name;
