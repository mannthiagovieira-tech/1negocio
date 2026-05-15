-- ============================================================================
-- Migration: socio_parceiro_leads
-- Tabela de leads da landing /socio-parceiro.html
-- ============================================================================

CREATE TABLE IF NOT EXISTS socio_parceiro_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  email TEXT NOT NULL,
  profissao TEXT,
  cidade TEXT,
  estado TEXT,
  network_descricao TEXT,
  papel_escolhido TEXT NOT NULL CHECK (papel_escolhido IN ('parceiro','socio')),
  origem TEXT DEFAULT 'landing-socio-parceiro',
  status TEXT DEFAULT 'novo' CHECK (status IN ('novo','contatado','aprovado','rejeitado','convertido')),
  notas_admin TEXT,
  contatado_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS socio_parceiro_leads_created_idx ON socio_parceiro_leads(created_at DESC);
CREATE INDEX IF NOT EXISTS socio_parceiro_leads_status_idx ON socio_parceiro_leads(status);

ALTER TABLE socio_parceiro_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS socio_parceiro_leads_insert_anyone ON socio_parceiro_leads;
CREATE POLICY socio_parceiro_leads_insert_anyone
  ON socio_parceiro_leads FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS socio_parceiro_leads_admin_all ON socio_parceiro_leads;
CREATE POLICY socio_parceiro_leads_admin_all
  ON socio_parceiro_leads FOR ALL
  TO service_role
  USING (true);
