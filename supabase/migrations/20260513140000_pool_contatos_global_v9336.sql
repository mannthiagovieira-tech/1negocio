-- v9.33.6 · banco interno híbrido · pool_contatos_global + pool_contatos_uso
-- Substitui originacao_leads_brutos (marcado DEPRECATED) · permite reutilização cross-projeto.

-- 1) Tabela principal · 1 row por empresa única globalmente
CREATE TABLE IF NOT EXISTS pool_contatos_global (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identificador_canonico text NOT NULL,
  fonte_origem text NOT NULL CHECK (fonte_origem IN (
    'apify_gmaps', 'apify_facebook', 'apify_instagram',
    'manual_admin', 'corretor_local'
  )),
  nome text NOT NULL,
  telefone text,
  email text,
  website text,
  endereco_completo text,
  cidade text,
  estado text,
  cep text,
  latitude numeric,
  longitude numeric,
  categoria_setorial text,
  tags_consolidadas jsonb DEFAULT '[]'::jsonb,
  setores text[] DEFAULT '{}',
  porte_estimado text,
  dados_brutos jsonb,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW(),
  last_seen_at timestamptz DEFAULT NOW(),
  refresh_check_after timestamptz DEFAULT (NOW() + INTERVAL '12 months'),
  UNIQUE (identificador_canonico, fonte_origem)
);

CREATE INDEX IF NOT EXISTS idx_pool_global_cidade ON pool_contatos_global (cidade);
CREATE INDEX IF NOT EXISTS idx_pool_global_setores ON pool_contatos_global USING GIN (setores);
CREATE INDEX IF NOT EXISTS idx_pool_global_tags ON pool_contatos_global USING GIN (tags_consolidadas);
CREATE INDEX IF NOT EXISTS idx_pool_global_categoria ON pool_contatos_global (categoria_setorial);
CREATE INDEX IF NOT EXISTS idx_pool_global_refresh ON pool_contatos_global (refresh_check_after);

-- 2) M:N · qual projeto usou qual contato · com contexto
CREATE TABLE IF NOT EXISTS pool_contatos_uso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contato_id uuid NOT NULL REFERENCES pool_contatos_global(id) ON DELETE CASCADE,
  originacao_id uuid NOT NULL REFERENCES projetos_originacao(id) ON DELETE CASCADE,
  arquetipo_id uuid REFERENCES arquetipos_compradores(id) ON DELETE SET NULL,
  canal text NOT NULL CHECK (canal IN (
    'gmaps', 'facebook', 'instagram', 'interno', 'corretores_locais'
  )),
  status text DEFAULT 'bruto' CHECK (status IN (
    'bruto', 'util', 'irrelevante', 'contatado', 'respondeu'
  )),
  score_ia integer CHECK (score_ia IS NULL OR (score_ia >= 0 AND score_ia <= 100)),
  score_motivo text,
  tags_ia jsonb,
  nota_admin text,
  visto_em timestamptz DEFAULT NOW(),
  marcado_em timestamptz,
  contatado_em timestamptz,
  UNIQUE (contato_id, originacao_id, arquetipo_id)
);

CREATE INDEX IF NOT EXISTS idx_pool_uso_orig_status ON pool_contatos_uso (originacao_id, status);
CREATE INDEX IF NOT EXISTS idx_pool_uso_orig_score ON pool_contatos_uso (originacao_id, score_ia DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_pool_uso_orig_arq ON pool_contatos_uso (originacao_id, arquetipo_id);
CREATE INDEX IF NOT EXISTS idx_pool_uso_contato ON pool_contatos_uso (contato_id);

-- 3) View conveniente · uso + dados globais (substitui originacao_leads_brutos no UI)
CREATE OR REPLACE VIEW pool_leads_originacao AS
SELECT
  uso.id,
  uso.originacao_id,
  uso.arquetipo_id,
  uso.canal,
  uso.status,
  uso.score_ia,
  uso.score_motivo,
  uso.tags_ia,
  uso.nota_admin,
  uso.visto_em,
  uso.marcado_em,
  uso.contatado_em,
  global.id AS contato_id,
  global.identificador_canonico,
  global.fonte_origem,
  global.nome,
  global.telefone,
  global.email,
  global.website,
  global.endereco_completo,
  global.cidade,
  global.estado,
  global.categoria_setorial,
  global.dados_brutos,
  global.last_seen_at,
  global.refresh_check_after,
  global.tags_consolidadas,
  global.setores,
  global.porte_estimado
FROM pool_contatos_uso uso
JOIN pool_contatos_global global ON global.id = uso.contato_id;

-- 4) Migra 106 leads existentes de originacao_leads_brutos · todos canal='gmaps'
DO $$
DECLARE
  lead RECORD;
  contato_id_v uuid;
BEGIN
  FOR lead IN SELECT * FROM originacao_leads_brutos LOOP
    INSERT INTO pool_contatos_global (
      identificador_canonico, fonte_origem, nome, telefone,
      endereco_completo, dados_brutos, categoria_setorial,
      cidade, last_seen_at, created_at, updated_at
    ) VALUES (
      COALESCE(lead.identificador_canal, lead.nome || '|' || COALESCE(lead.dados_brutos->>'address', 'sem_endereco')),
      'apify_' || lead.canal,
      COALESCE(lead.nome, '(sem nome)'),
      lead.telefone,
      lead.dados_brutos->>'address',
      lead.dados_brutos,
      lead.dados_brutos->>'categoryName',
      'Belo Horizonte',
      COALESCE(lead.created_at, NOW()),
      COALESCE(lead.created_at, NOW()),
      COALESCE(lead.updated_at, NOW())
    )
    ON CONFLICT (identificador_canonico, fonte_origem) DO UPDATE
      SET last_seen_at = EXCLUDED.last_seen_at,
          dados_brutos = EXCLUDED.dados_brutos
    RETURNING id INTO contato_id_v;

    INSERT INTO pool_contatos_uso (
      contato_id, originacao_id, arquetipo_id, canal,
      status, score_ia, score_motivo, tags_ia, nota_admin,
      visto_em, marcado_em, contatado_em
    ) VALUES (
      contato_id_v, lead.originacao_id, lead.arquetipo_id, lead.canal,
      COALESCE(lead.status, 'bruto'), lead.score_ia, lead.razao_score,
      lead.tags_ia, lead.nota_admin,
      COALESCE(lead.created_at, NOW()), lead.marcado_em, lead.contatado_em
    )
    ON CONFLICT (contato_id, originacao_id, arquetipo_id) DO NOTHING;
  END LOOP;
END $$;

-- 5) Marca originacao_leads_brutos como DEPRECATED
COMMENT ON TABLE originacao_leads_brutos IS 'DEPRECATED v9.33.6 · migrado pra pool_contatos_global + pool_contatos_uso · não inserir mais aqui';
