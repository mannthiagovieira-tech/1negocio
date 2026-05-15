-- v9.35.0 motor V3.5 · 5 tabelas + extensões em projeto_metadata
-- Aplicado via MCP apply_migration em 2026-05-15
-- Assessores por projeto
CREATE TABLE IF NOT EXISTS projeto_assessores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_metadata_id UUID REFERENCES projeto_metadata(id) ON DELETE CASCADE,
  usuario_id UUID,
  nome TEXT NOT NULL,
  cargo TEXT DEFAULT 'Assessor',
  ativo BOOLEAN DEFAULT true,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  criado_por UUID
);
CREATE INDEX IF NOT EXISTS idx_proj_assessores_meta ON projeto_assessores(projeto_metadata_id);
ALTER TABLE projeto_assessores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_full_assessores" ON projeto_assessores;
CREATE POLICY "admin_full_assessores" ON projeto_assessores FOR ALL USING (true) WITH CHECK (true);

-- Ondas do projeto
CREATE TABLE IF NOT EXISTS projeto_ondas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_metadata_id UUID REFERENCES projeto_metadata(id) ON DELETE CASCADE,
  numero_onda INTEGER NOT NULL DEFAULT 1,
  data_inicio DATE,
  data_fim DATE,
  status TEXT DEFAULT 'pendente' CHECK (status IN ('pendente','ativa','concluida','cancelada')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proj_ondas_meta ON projeto_ondas(projeto_metadata_id);
ALTER TABLE projeto_ondas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_full_ondas" ON projeto_ondas;
CREATE POLICY "admin_full_ondas" ON projeto_ondas FOR ALL USING (true) WITH CHECK (true);

-- Atividades/cronograma
CREATE TABLE IF NOT EXISTS projeto_atividades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  onda_id UUID REFERENCES projeto_ondas(id) ON DELETE CASCADE,
  projeto_metadata_id UUID REFERENCES projeto_metadata(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  descricao TEXT,
  tipo TEXT DEFAULT 'gerencial' CHECK (tipo IN ('gerencial','entrega')),
  prazo DATE,
  dias_offset INTEGER,
  concluida BOOLEAN DEFAULT false,
  concluida_em TIMESTAMPTZ,
  concluida_por UUID,
  visivel_cliente BOOLEAN DEFAULT false,
  ordem INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proj_ativ_meta ON projeto_atividades(projeto_metadata_id);
CREATE INDEX IF NOT EXISTS idx_proj_ativ_onda ON projeto_atividades(onda_id);
ALTER TABLE projeto_atividades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_full_atividades" ON projeto_atividades;
CREATE POLICY "admin_full_atividades" ON projeto_atividades FOR ALL USING (true) WITH CHECK (true);

-- Dataroom
CREATE TABLE IF NOT EXISTS projeto_dataroom (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_metadata_id UUID REFERENCES projeto_metadata(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  descricao TEXT,
  categoria TEXT DEFAULT 'outros' CHECK (categoria IN ('societario','financeiro','operacional','fotos','laudos','outros')),
  url TEXT,
  tamanho_bytes INTEGER,
  mime_type TEXT,
  status TEXT DEFAULT 'pendente' CHECK (status IN ('pendente','enviado','aprovado','rejeitado')),
  solicitado_em TIMESTAMPTZ DEFAULT NOW(),
  enviado_em TIMESTAMPTZ,
  aprovado_em TIMESTAMPTZ,
  aprovado_por UUID,
  motivo_rejeicao TEXT,
  acessos JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dataroom_meta ON projeto_dataroom(projeto_metadata_id);
ALTER TABLE projeto_dataroom ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_full_dataroom" ON projeto_dataroom;
CREATE POLICY "admin_full_dataroom" ON projeto_dataroom FOR ALL USING (true) WITH CHECK (true);

-- Sugestões para o dono
CREATE TABLE IF NOT EXISTS projeto_sugestoes_dono (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_metadata_id UUID REFERENCES projeto_metadata(id) ON DELETE CASCADE,
  tipo TEXT CHECK (tipo IN ('evento','grupo','associacao')),
  nome TEXT NOT NULL,
  descricao TEXT,
  url TEXT,
  cidade TEXT,
  data_evento DATE,
  plataforma TEXT,
  membros_estimados INTEGER,
  arquetipo_relacionado TEXT,
  motivo TEXT,
  visivel_cliente BOOLEAN DEFAULT true,
  gerado_por_ia BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sugestoes_meta ON projeto_sugestoes_dono(projeto_metadata_id);
ALTER TABLE projeto_sugestoes_dono ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_full_sugestoes" ON projeto_sugestoes_dono;
CREATE POLICY "admin_full_sugestoes" ON projeto_sugestoes_dono FOR ALL USING (true) WITH CHECK (true);

-- Campos adicionais em projeto_metadata
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'projeto_metadata') THEN
    ALTER TABLE projeto_metadata
      ADD COLUMN IF NOT EXISTS markup_lead_cobrado DECIMAL(10,2) DEFAULT 5.00,
      ADD COLUMN IF NOT EXISTS markup_conteudo_cobrado DECIMAL(10,2) DEFAULT 10.00,
      ADD COLUMN IF NOT EXISTS perc_ads DECIMAL(5,2) DEFAULT 30.00,
      ADD COLUMN IF NOT EXISTS perc_leads DECIMAL(5,2) DEFAULT 16.00,
      ADD COLUMN IF NOT EXISTS perc_conteudo DECIMAL(5,2) DEFAULT 10.00,
      ADD COLUMN IF NOT EXISTS meta_contatos_mes INTEGER DEFAULT 20,
      ADD COLUMN IF NOT EXISTS historico_financeiro JSONB DEFAULT '[]',
      ADD COLUMN IF NOT EXISTS data_inicio_projeto DATE,
      ADD COLUMN IF NOT EXISTS assessor_responsavel TEXT;
  END IF;
END $$;
