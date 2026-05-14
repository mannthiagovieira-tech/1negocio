-- v9.34.5 · Sprint 6 · rastreia cada execução de canal × arquétipo (ou nível projeto)
CREATE TABLE IF NOT EXISTS originacao_buscas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  originacao_id UUID NOT NULL REFERENCES projetos_originacao(id) ON DELETE CASCADE,
  arquetipo_id UUID REFERENCES arquetipos_compradores(id) ON DELETE CASCADE,
  canal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente','rodando','concluido','erro')),
  leads_encontrados INTEGER DEFAULT 0,
  leads_aprovados INTEGER DEFAULT 0,
  custo_brl DECIMAL(8,4) DEFAULT 0,
  erro_msg TEXT,
  resultado_jsonb JSONB,
  rodado_em TIMESTAMPTZ,
  aprovado_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_originacao_buscas_originacao ON originacao_buscas(originacao_id);
CREATE INDEX IF NOT EXISTS idx_originacao_buscas_status ON originacao_buscas(status);
CREATE INDEX IF NOT EXISTS idx_originacao_buscas_canal ON originacao_buscas(canal);

-- Único por célula da matriz (1 row por arquetipo × canal · ou projeto × canal)
CREATE UNIQUE INDEX IF NOT EXISTS uq_originacao_buscas_celula
  ON originacao_buscas(originacao_id, COALESCE(arquetipo_id, '00000000-0000-0000-0000-000000000000'::uuid), canal);

ALTER TABLE originacao_buscas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_full_originacao_buscas" ON originacao_buscas;
CREATE POLICY "admin_full_originacao_buscas" ON originacao_buscas FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE originacao_buscas IS
'Rastreia cada execução de canal por arquétipo. arquetipo_id = null para canais de nível projeto (corretores · associações · eventos). resultado_jsonb = leads brutos retornados antes de aprovação.';
