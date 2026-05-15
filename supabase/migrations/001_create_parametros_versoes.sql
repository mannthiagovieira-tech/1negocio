CREATE TABLE parametros_versoes (
  id            TEXT PRIMARY KEY,
  ativo         BOOLEAN NOT NULL DEFAULT false,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por    TEXT,
  promovido_em  TIMESTAMPTZ,
  promovido_por TEXT,
  nota          TEXT,
  snapshot      JSONB NOT NULL
);

CREATE UNIQUE INDEX idx_parametros_versoes_unica_ativa
  ON parametros_versoes (ativo)
  WHERE ativo = true;
