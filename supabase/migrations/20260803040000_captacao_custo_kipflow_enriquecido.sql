-- Slice 3.1 · custo Kipflow rastreável + flag de enriquecimento por lead
ALTER TABLE va_extracoes
  ADD COLUMN IF NOT EXISTS custo_kipflow_total numeric NULL,
  ADD COLUMN IF NOT EXISTS custo_kipflow_moeda text NULL,
  ADD COLUMN IF NOT EXISTS datasets_usados text[] NULL;

ALTER TABLE va_leads
  ADD COLUMN IF NOT EXISTS enriquecido_em timestamptz NULL,
  ADD COLUMN IF NOT EXISTS custo_enriquecimento_kipflow numeric NULL,
  ADD COLUMN IF NOT EXISTS dados_enriquecimento jsonb NULL;

COMMENT ON COLUMN va_extracoes.custo_kipflow_total IS 'Soma dos parsed.cost das paginas Kipflow.';
COMMENT ON COLUMN va_leads.enriquecido_em IS 'Timestamp do enriquecimento sob demanda (partners+debts). NULL = ainda nao enriquecido.';
