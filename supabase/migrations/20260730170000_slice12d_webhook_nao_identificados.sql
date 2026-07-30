-- Caixa de mensagens Z-API que não casaram com contato ativo.
CREATE TABLE IF NOT EXISTS va_nao_identificados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telefone_normalizado text NOT NULL,
  telefone_bruto text,
  nome text,
  mensagem text,
  zapi_message_id text UNIQUE,
  vinculado_contato_id uuid REFERENCES va_contatos(id) ON DELETE SET NULL,
  vinculado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS va_nao_identificados_tel_idx ON va_nao_identificados (telefone_normalizado);
CREATE INDEX IF NOT EXISTS va_nao_identificados_criado_idx ON va_nao_identificados (criado_em DESC);
