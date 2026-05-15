-- ===========================================================
-- Migration: chat_ia_leads — campos pra avaliação rápida da IA
-- Data: 01/05/2026
-- Contexto: IA atendente faz estimativa de valuation com 6 dados
-- ===========================================================

-- Vínculo com usuário cadastrado (se logado)
ALTER TABLE chat_ia_leads
  ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES usuarios(id);

-- Dados coletados pela IA (6 perguntas obrigatórias)
ALTER TABLE chat_ia_leads
  ADD COLUMN IF NOT EXISTS dados_coletados jsonb DEFAULT '{}'::jsonb;

-- Resultado do cálculo
ALTER TABLE chat_ia_leads
  ADD COLUMN IF NOT EXISTS valuation_central numeric;

ALTER TABLE chat_ia_leads
  ADD COLUMN IF NOT EXISTS valuation_min numeric;

ALTER TABLE chat_ia_leads
  ADD COLUMN IF NOT EXISTS valuation_max numeric;

-- Versão do snapshot de parâmetros usado no cálculo (auditoria)
ALTER TABLE chat_ia_leads
  ADD COLUMN IF NOT EXISTS parametros_versao_id text;

-- Múltiplo aplicado (auditoria)
ALTER TABLE chat_ia_leads
  ADD COLUMN IF NOT EXISTS multiplo_aplicado numeric;

-- Setor identificado (código padronizado da skill v2)
ALTER TABLE chat_ia_leads
  ADD COLUMN IF NOT EXISTS setor_code text;

-- Status de coleta (✓ admin precisa enxergar isso fácil)
ALTER TABLE chat_ia_leads
  ADD COLUMN IF NOT EXISTS status_coleta text
    DEFAULT 'iniciou'
    CHECK (status_coleta IN (
      'iniciou',           -- só conversou, sem dado nenhum
      'nome_capturado',    -- só nome
      'lead_capturado',    -- nome + telefone validado
      'avaliacao_completa' -- nome + telefone + 6 dados + cálculo feito
    ));

-- Floor aplicado? (auditoria — se valuation_central foi recalculado
-- por causa de PL muito negativo)
ALTER TABLE chat_ia_leads
  ADD COLUMN IF NOT EXISTS floor_aplicado boolean DEFAULT false;

-- Trigger pra atualizar status_coleta automaticamente
CREATE OR REPLACE FUNCTION update_chat_ia_status_coleta()
RETURNS TRIGGER AS $$
BEGIN
  -- Status escalonado, do mais avançado pro menos
  IF NEW.valuation_central IS NOT NULL THEN
    NEW.status_coleta = 'avaliacao_completa';
  ELSIF NEW.whatsapp IS NOT NULL AND NEW.whatsapp != '' AND NEW.nome IS NOT NULL THEN
    NEW.status_coleta = 'lead_capturado';
  ELSIF NEW.nome IS NOT NULL AND NEW.nome != '' THEN
    NEW.status_coleta = 'nome_capturado';
  ELSE
    NEW.status_coleta = 'iniciou';
  END IF;

  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chat_ia_status_coleta ON chat_ia_leads;
CREATE TRIGGER trg_chat_ia_status_coleta
  BEFORE INSERT OR UPDATE ON chat_ia_leads
  FOR EACH ROW
  EXECUTE FUNCTION update_chat_ia_status_coleta();

-- Índices pra tela admin filtrar rápido
CREATE INDEX IF NOT EXISTS idx_chat_ia_status_coleta
  ON chat_ia_leads(status_coleta);

CREATE INDEX IF NOT EXISTS idx_chat_ia_usuario_id
  ON chat_ia_leads(usuario_id) WHERE usuario_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_ia_created_at
  ON chat_ia_leads(created_at DESC);

-- Tornar nome e whatsapp NULLABLE (hoje são NOT NULL, mas precisamos
-- gravar conversa desde o início mesmo sem ter coletado ainda)
ALTER TABLE chat_ia_leads
  ALTER COLUMN nome DROP NOT NULL;

ALTER TABLE chat_ia_leads
  ALTER COLUMN whatsapp DROP NOT NULL;

ALTER TABLE chat_ia_leads
  ALTER COLUMN perfil DROP NOT NULL;

-- Backfill: registros existentes (já têm nome+whatsapp+perfil)
-- recebem status 'lead_capturado' (não tinham avaliação)
UPDATE chat_ia_leads
SET status_coleta = 'lead_capturado'
WHERE nome IS NOT NULL
  AND whatsapp IS NOT NULL
  AND status_coleta IS NULL;

COMMENT ON COLUMN chat_ia_leads.dados_coletados IS
  'JSON com as 6 respostas: {nome_negocio, cidade_uf, setor_code, faturamento_anual, sobra_anual, ativos_relevantes, dividas_total, forma_atuacao}';

COMMENT ON COLUMN chat_ia_leads.status_coleta IS
  'Estagio do funil: iniciou < nome_capturado < lead_capturado < avaliacao_completa';

COMMENT ON COLUMN chat_ia_leads.parametros_versao_id IS
  'ID da versao de parametros_versoes usada no calculo. Permite auditoria historica caso parametros mudem.';
