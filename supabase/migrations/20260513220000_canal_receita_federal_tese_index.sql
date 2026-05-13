-- v9.34.3 · Sprint 4 · adiciona canal receita_federal + index tese_versao
-- Suporta:
--   1. originacao-buscar-cnae (busca via CNPJ.ws filtrando CNAE)
--   2. tese-agente-chat (queries em tese_versao pra histórico)

-- 1) Canal receita_federal no CHECK
ALTER TABLE pool_contatos_uso DROP CONSTRAINT IF EXISTS pool_contatos_uso_canal_check;

ALTER TABLE pool_contatos_uso ADD CONSTRAINT pool_contatos_uso_canal_check
CHECK (canal IN (
  'gmaps','facebook','instagram','linkedin','google_search','twitter','olx',
  'corretores_locais','interno','manual','matchmaking',
  'web_compradores','web_influenciadores','web_eventos','web_corretores','web_profissionais',
  'receita_federal'
));

-- 2) Index em tese_versao pra query rápida de versão atual
CREATE INDEX IF NOT EXISTS idx_projetos_originacao_tese_versao
ON projetos_originacao(tese_versao);
