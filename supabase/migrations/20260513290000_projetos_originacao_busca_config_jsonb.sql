-- v9.34.4 · Sprint 5 · Passo B config (CNPJ + CNAEs + queries corretores + eventos)
ALTER TABLE projetos_originacao ADD COLUMN IF NOT EXISTS busca_config_jsonb jsonb DEFAULT '{}'::jsonb;
COMMENT ON COLUMN projetos_originacao.busca_config_jsonb IS
  'Passo B · { cnpj_referencia, cnaes:[], queries_corretores_gmaps:[], queries_corretores_web:[], queries_ig_corretores:[], eventos_selecionados:[{nome,data,cidade}] }';
