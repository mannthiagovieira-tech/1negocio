-- Adiciona network_volume (volume estimado de empresas que o lead pode trazer no 1º ano)
-- Usado pelo formulário /socio-parceiro-cadastro.html
ALTER TABLE socio_parceiro_leads
ADD COLUMN IF NOT EXISTS network_volume TEXT
CHECK (network_volume IS NULL OR network_volume IN ('ate_5','5_20','20_50','50_mais'));
