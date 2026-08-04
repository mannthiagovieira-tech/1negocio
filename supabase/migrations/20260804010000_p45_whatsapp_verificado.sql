-- Slice 4.5 · Verificação de WhatsApp na esteira de contato.
-- Todo telefone passa por get-iswhatsapp-batch da Z-API antes de virar
-- elegível pra cadência. Inclui fixos (muita PME tem WhatsApp Business
-- no fixo, especialmente com o BOT WhatsApp Business rodando no roteador).

ALTER TABLE va_leads
  ADD COLUMN IF NOT EXISTS whatsapp_verificado boolean,
  ADD COLUMN IF NOT EXISTS verificado_em timestamptz;

COMMENT ON COLUMN va_leads.whatsapp_verificado IS
  '4.5 · null = nunca checado · true = tem WhatsApp · false = número não registrado';
COMMENT ON COLUMN va_leads.verificado_em IS
  '4.5 · timestamp do último check via Z-API get-iswhatsapp-batch';

-- Índice pro disparador filtrar rápido (funil_etapa + verificado)
CREATE INDEX IF NOT EXISTS idx_va_leads_verificado_elegivel
  ON va_leads (projeto_id, funil_etapa) WHERE whatsapp_verificado = true;
