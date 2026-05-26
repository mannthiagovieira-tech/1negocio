-- Tabela hermes_agendamentos · pedidos de reunião / Assessorada / agendamento Boss
-- Aplicada via MCP apply_migration (db push está divergente)

CREATE TABLE IF NOT EXISTS hermes_agendamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_nome TEXT,
  lead_telefone TEXT NOT NULL,
  negocio_id UUID REFERENCES negocios(id) ON DELETE SET NULL,
  caminho TEXT, -- vendedor / comprador / parceiro
  plano_interesse TEXT,
  horario_preferido TEXT,
  contexto TEXT,
  status TEXT DEFAULT 'pendente',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hermes_agend_status ON hermes_agendamentos(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hermes_agend_phone ON hermes_agendamentos(lead_telefone);
