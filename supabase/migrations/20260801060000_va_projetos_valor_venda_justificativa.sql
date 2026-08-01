-- Bloco 1 · valor de venda definido para operação (pode diferir da avaliação)
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS valor_venda_justificativa text;
