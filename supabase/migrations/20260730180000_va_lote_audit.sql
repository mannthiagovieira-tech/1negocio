-- Audit imutável do lote (sem FK · projeto_id text) · sobrevive à deleção do projeto.
CREATE TABLE IF NOT EXISTS va_lote_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id text NOT NULL,
  semana_inicio date NOT NULL,
  arquetipo_codigo text,
  cnpj_semente text,
  filtros_aplicados jsonb NOT NULL,
  breakdown jsonb NOT NULL,
  meta_quantidade int NOT NULL,
  gerados int NOT NULL DEFAULT 0,
  importados int NOT NULL DEFAULT 0,
  skip_sem_telefone int NOT NULL DEFAULT 0,
  custo_total numeric(12,2) NOT NULL DEFAULT 0,
  cnpjs_importados jsonb,
  kipflow_response_amostra jsonb,
  status text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS va_lote_audit_projeto_idx ON va_lote_audit (projeto_id, semana_inicio DESC);
