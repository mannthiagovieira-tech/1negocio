-- Migration · Cowork Etapa A · infra base
-- Data: 2026-05-05
-- Aplicada em produção via MCP apply_migration em 2026-05-05.

CREATE TABLE IF NOT EXISTS cowork_planos_diarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data DATE NOT NULL UNIQUE,
  contexto JSONB,
  prioridades JSONB,
  performance_negocio JSONB,
  estrutural JSONB,
  alertas JSONB,
  proximos_dias JSONB,
  texto_completo TEXT,
  gerado_em TIMESTAMPTZ DEFAULT NOW(),
  enviado_whatsapp BOOLEAN DEFAULT false,
  tokens_usados INT
);

CREATE TABLE IF NOT EXISTS cowork_tarefas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plano_id UUID REFERENCES cowork_planos_diarios(id) ON DELETE CASCADE,
  categoria TEXT,
  titulo TEXT,
  descricao TEXT,
  link_acao TEXT,
  feita BOOLEAN DEFAULT false,
  feita_em TIMESTAMPTZ,
  ordem INT DEFAULT 0,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cowork_tarefas_plano ON cowork_tarefas(plano_id, ordem);
CREATE INDEX IF NOT EXISTS idx_cowork_planos_data ON cowork_planos_diarios(data DESC);

ALTER TABLE cowork_planos_diarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE cowork_tarefas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cowork_planos_admin" ON cowork_planos_diarios FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "cowork_tarefas_admin" ON cowork_tarefas FOR ALL USING (auth.uid() IS NOT NULL);

COMMENT ON TABLE cowork_planos_diarios IS 'Plano diário gerado pelo cowork-gerar-plano-diario · 1 linha por dia';
COMMENT ON TABLE cowork_tarefas IS 'Tarefas do plano · admin marca feita=true ao completar';

ALTER TABLE leads_google ADD COLUMN IF NOT EXISTS classificacao_ia TEXT;
ALTER TABLE leads_google ADD COLUMN IF NOT EXISTS classificado_em TIMESTAMPTZ;
ALTER TABLE ig_seguidores_raw ADD COLUMN IF NOT EXISTS classificacao_ia TEXT;
ALTER TABLE ig_seguidores_raw ADD COLUMN IF NOT EXISTS distribuido_em DATE;

COMMENT ON COLUMN leads_google.classificacao_ia IS 'negocio_funcionamento | imovel_residencial | ponto_vazio | corretor | concorrente | ambiguo';
