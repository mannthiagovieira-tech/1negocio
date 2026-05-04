-- Migration · scrap_configs (configs persistentes dos scrapers)
-- Data: 2026-05-04
-- Substitui localStorage do browser pra compartilhar entre admins/máquinas.
-- Aplicada em produção via MCP apply_migration em 2026-05-04.

CREATE TABLE IF NOT EXISTS scrap_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scraper TEXT NOT NULL,
  tipo TEXT NOT NULL,
  valor TEXT NOT NULL,
  ativo BOOLEAN DEFAULT true,
  criado_por UUID REFERENCES auth.users(id),
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(scraper, tipo, valor)
);

CREATE INDEX IF NOT EXISTS idx_scrap_configs_scraper ON scrap_configs(scraper, tipo) WHERE ativo;

ALTER TABLE scrap_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scrap_configs_admin_only" ON scrap_configs
  FOR ALL USING (auth.uid() IS NOT NULL);

COMMENT ON TABLE scrap_configs IS 'Configs persistentes dos scrapers (OLX/Gmaps/FB/IG) · substitui localStorage';
COMMENT ON COLUMN scrap_configs.scraper IS 'olx | gmaps | fb_search | fb_pages | instagram';
COMMENT ON COLUMN scrap_configs.tipo    IS 'keyword | cidade | campanha';

-- Seed inicial · 17 keywords OLX + 15 cidades
INSERT INTO scrap_configs (scraper, tipo, valor) VALUES
  ('olx', 'keyword', 'vendo restaurante'),
  ('olx', 'keyword', 'passo ponto comercial'),
  ('olx', 'keyword', 'vendo padaria'),
  ('olx', 'keyword', 'vendo lanchonete em funcionamento'),
  ('olx', 'keyword', 'vendo clínica'),
  ('olx', 'keyword', 'passo academia'),
  ('olx', 'keyword', 'vendo loja com ponto'),
  ('olx', 'keyword', 'passo barbearia'),
  ('olx', 'keyword', 'vendo pet shop'),
  ('olx', 'keyword', 'vendo farmácia'),
  ('olx', 'keyword', 'passo salão de beleza'),
  ('olx', 'keyword', 'vendo oficina mecânica'),
  ('olx', 'keyword', 'vendo escola de idiomas'),
  ('olx', 'keyword', 'passo pizzaria'),
  ('olx', 'keyword', 'vendo distribuidora'),
  ('olx', 'keyword', 'vendo posto de gasolina'),
  ('olx', 'keyword', 'passo ponto comercial em funcionamento'),
  ('olx', 'cidade', 'brasil'),
  ('olx', 'cidade', 'sao-paulo'),
  ('olx', 'cidade', 'rio-de-janeiro'),
  ('olx', 'cidade', 'belo-horizonte'),
  ('olx', 'cidade', 'curitiba'),
  ('olx', 'cidade', 'porto-alegre'),
  ('olx', 'cidade', 'florianopolis'),
  ('olx', 'cidade', 'joinville'),
  ('olx', 'cidade', 'blumenau'),
  ('olx', 'cidade', 'balneario-camboriu'),
  ('olx', 'cidade', 'salvador'),
  ('olx', 'cidade', 'recife'),
  ('olx', 'cidade', 'fortaleza'),
  ('olx', 'cidade', 'goiania'),
  ('olx', 'cidade', 'brasilia')
ON CONFLICT (scraper, tipo, valor) DO NOTHING;
