-- Tabela de logs das Edge Functions
-- Spec rev3 §12.6

CREATE TABLE IF NOT EXISTS logs_edge_functions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name   TEXT NOT NULL,
  negocio_id      UUID REFERENCES negocios(id),
  contexto        TEXT,
  texto_gerado    TEXT,
  status          TEXT NOT NULL CHECK (status IN ('iniciado', 'sucesso', 'erro', 'timeout')),
  modelo_usado    TEXT,
  tokens_input    INTEGER,
  tokens_output   INTEGER,
  custo_estimado  NUMERIC(10, 6),
  erro_mensagem   TEXT,
  duracao_ms      INTEGER,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_logs_function_name ON logs_edge_functions(function_name);
CREATE INDEX idx_logs_negocio_id ON logs_edge_functions(negocio_id);
CREATE INDEX idx_logs_criado_em ON logs_edge_functions(criado_em DESC);
CREATE INDEX idx_logs_status ON logs_edge_functions(status);

COMMENT ON TABLE logs_edge_functions IS 'Logs de execução das Edge Functions de geração de textos IA';
