-- Kipflow devolve faixas textuais ("02 A 05", "30000 OU MAIS") e
-- classificações qualitativas (segmento/ramo). Colunas dedicadas
-- pra não sobrecarregar `funcionarios` (integer) e `porte_*`.
ALTER TABLE va_empresas ADD COLUMN IF NOT EXISTS faixa_funcionarios text;
ALTER TABLE va_empresas ADD COLUMN IF NOT EXISTS faixa_faturamento  text;
ALTER TABLE va_empresas ADD COLUMN IF NOT EXISTS segmento           text;
ALTER TABLE va_empresas ADD COLUMN IF NOT EXISTS ramo_atividade     text;
