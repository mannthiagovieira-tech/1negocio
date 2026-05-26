-- HERMES v4 · tabelas base + seeds + sequence pra códigos de autorização
-- Aplicada via MCP apply_migration (db push está divergente — ver memória)

-- 1) hermes_conversas · histórico de mensagens (user/assistant)
CREATE TABLE IF NOT EXISTS hermes_conversas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hermes_conv_phone_created
  ON hermes_conversas(phone, created_at DESC);

-- 2) hermes_sessoes · estado por telefone (1 row por phone)
CREATE TABLE IF NOT EXISTS hermes_sessoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT UNIQUE NOT NULL,
  is_boss BOOLEAN DEFAULT false,
  perfil TEXT DEFAULT 'desconhecido'
    CHECK (perfil IN ('vendedor','comprador','desconhecido')),
  fluxo_ativo TEXT,
  step_atual INTEGER DEFAULT 0,
  usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  dados_coletados JSONB DEFAULT '{}'::jsonb,
  ultima_atividade TIMESTAMPTZ DEFAULT now(),
  arquivada BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hermes_sessoes_ultima ON hermes_sessoes(ultima_atividade DESC);

-- 3) hermes_config · key/value (config dinâmica)
CREATE TABLE IF NOT EXISTS hermes_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);
INSERT INTO hermes_config (key, value) VALUES
  ('hermes_ativo', 'true'),
  ('boss_phone', '5548999279320'),
  ('historico_limit', '30'),
  ('followup_horas', '24'),
  ('outbound_delay_segundos', '45'),
  ('outbound_horario_inicio', '08:00'),
  ('outbound_horario_fim', '20:00')
ON CONFLICT (key) DO NOTHING;

-- 4) hermes_treinamento · CAMADA 2 (objeções, scripts, conhecimento)
CREATE TABLE IF NOT EXISTS hermes_treinamento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria TEXT,
  gatilho TEXT,
  conteudo TEXT NOT NULL,
  ativo BOOLEAN DEFAULT true,
  criado_por TEXT DEFAULT 'boss',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hermes_treinamento_ativo ON hermes_treinamento(ativo);

-- 5) hermes_autorizacoes + sequence + função pra AUTH-XXX atômico
CREATE SEQUENCE IF NOT EXISTS hermes_auth_seq START 1;
CREATE OR REPLACE FUNCTION hermes_gen_auth_codigo() RETURNS TEXT
  LANGUAGE sql VOLATILE AS
  $$ SELECT 'AUTH-' || lpad(nextval('hermes_auth_seq')::text, 3, '0') $$;

CREATE TABLE IF NOT EXISTS hermes_autorizacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo TEXT UNIQUE NOT NULL DEFAULT hermes_gen_auth_codigo(),
  tipo TEXT NOT NULL,
  descricao TEXT NOT NULL,
  descricao_curta TEXT,
  negocio_id UUID REFERENCES negocios(id) ON DELETE SET NULL,
  lead_phone TEXT,
  payload JSONB DEFAULT '{}'::jsonb,
  status TEXT DEFAULT 'pendente'
    CHECK (status IN ('pendente','aprovada','rejeitada','expirada')),
  respondida_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hermes_auth_status ON hermes_autorizacoes(status);
CREATE INDEX IF NOT EXISTS idx_hermes_auth_created ON hermes_autorizacoes(created_at DESC);

-- 6) hermes_outbound_log · log de toda mensagem ativa
CREATE TABLE IF NOT EXISTS hermes_outbound_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  mensagem TEXT NOT NULL,
  contexto TEXT,
  status TEXT DEFAULT 'enviado'
    CHECK (status IN ('enviado','falhou','opt_out')),
  job_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hermes_outbound_phone ON hermes_outbound_log(phone, created_at DESC);

-- 7) hermes_apify_jobs · polling assíncrono de scrapers
CREATE TABLE IF NOT EXISTS hermes_apify_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  run_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending','done','failed')),
  resultado JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  entregue_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_hermes_apify_status ON hermes_apify_jobs(status, created_at);
