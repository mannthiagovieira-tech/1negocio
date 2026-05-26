-- Adiciona coluna is_simulating em hermes_sessoes
-- Boss usa /asclient pra entrar em simulação e /astheboss pra sair
-- Aplicada via MCP apply_migration

ALTER TABLE hermes_sessoes
  ADD COLUMN IF NOT EXISTS is_simulating BOOLEAN DEFAULT false;
