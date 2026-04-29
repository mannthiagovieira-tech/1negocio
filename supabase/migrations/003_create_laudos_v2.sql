-- Bloco SQL #3 (revisado): Criar tabela laudos_v2 ao lado da v1
-- Decisao #21: estrategia paralela, sem dropar v1

CREATE TABLE laudos_v2 (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id            UUID NOT NULL,
  versao                INTEGER NOT NULL DEFAULT 1,
  ativo                 BOOLEAN NOT NULL DEFAULT true,
  calc_json             JSONB NOT NULL,
  criado_em             TIMESTAMPTZ NOT NULL DEFAULT now(),
  parametros_versao_id  TEXT NOT NULL REFERENCES parametros_versoes(id)
);

-- Foreign key para negocios (separado para flexibilidade)
ALTER TABLE laudos_v2
  ADD CONSTRAINT fk_laudos_v2_negocio
  FOREIGN KEY (negocio_id) REFERENCES negocios(id);

-- Indice para o laudo ativo de cada negocio (so 1 ativo por negocio)
CREATE UNIQUE INDEX idx_laudos_v2_negocio_ativo
  ON laudos_v2(negocio_id)
  WHERE ativo = true;

-- Indice para busca de historico
CREATE INDEX idx_laudos_v2_negocio
  ON laudos_v2(negocio_id);

-- Verificacao
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'laudos_v2'
ORDER BY ordinal_position;
