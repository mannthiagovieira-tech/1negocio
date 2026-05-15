-- Migration · Cowork esqueletos B-G · 7 tabelas restantes
-- Data: 2026-05-04 · aplicada via MCP apply_migration
-- Tabelas vazias · prontas pra uso quando edge functions correspondentes
-- forem implementadas (hoje só stubs)

-- Etapa E · roteiros
CREATE TABLE IF NOT EXISTS cowork_roteiros_stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data DATE NOT NULL UNIQUE,
  negocio_id UUID REFERENCES negocios(id),
  roteiro_completo TEXT,
  gancho TEXT, contexto TEXT, dados TEXT, valor TEXT, cta TEXT,
  duracao_estimada_seg INT,
  status TEXT DEFAULT 'pendente',
  gravado_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cowork_roteiros_youtube (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data DATE NOT NULL,
  negocio_id UUID REFERENCES negocios(id),
  roteiro_completo TEXT,
  duracao_estimada_min INT,
  status TEXT DEFAULT 'pendente',
  gravado_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

-- Etapa F · monitoramento Instagram
CREATE TABLE IF NOT EXISTS ig_posts_monitorados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT UNIQUE NOT NULL,
  apelido TEXT,
  frequencia_horas INT DEFAULT 24,
  capturar_likers BOOLEAN DEFAULT true,
  capturar_commenters BOOLEAN DEFAULT true,
  ativo BOOLEAN DEFAULT true,
  ultimo_scrap TIMESTAMPTZ,
  total_snapshots INT DEFAULT 0,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ig_posts_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES ig_posts_monitorados(id) ON DELETE CASCADE,
  capturado_em TIMESTAMPTZ DEFAULT NOW(),
  likes INT, comments INT, saves INT, views_reel INT,
  raw_json JSONB
);

CREATE TABLE IF NOT EXISTS ig_perfis_monitorados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  plataforma TEXT DEFAULT 'instagram',
  frequencia_horas INT DEFAULT 24,
  ultimo_post_id_detectado TEXT,
  ativo BOOLEAN DEFAULT true,
  ultima_verificacao TIMESTAMPTZ,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS instagram_engajamento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES ig_posts_monitorados(id),
  username TEXT NOT NULL,
  tipo TEXT,
  bio_capturada TEXT,
  classificacao_ia TEXT,
  classificado_em TIMESTAMPTZ,
  capturado_em TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(post_id, username, tipo)
);

-- Etapa G · ads snapshots
CREATE TABLE IF NOT EXISTS ads_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concorrente_id UUID REFERENCES ads_concorrentes_monitorados(id) ON DELETE CASCADE,
  capturado_em TIMESTAMPTZ DEFAULT NOW(),
  total_ativos INT,
  novos_desde_ultimo INT,
  pararam_desde_ultimo INT,
  ads_ativos JSONB,
  analise_ia TEXT
);

CREATE INDEX IF NOT EXISTS idx_ig_posts_snap_post ON ig_posts_snapshots(post_id, capturado_em DESC);
CREATE INDEX IF NOT EXISTS idx_ig_engaj_post ON instagram_engajamento(post_id, classificacao_ia);
CREATE INDEX IF NOT EXISTS idx_ads_snap_concorrente ON ads_snapshots(concorrente_id, capturado_em DESC);

ALTER TABLE cowork_roteiros_stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE cowork_roteiros_youtube ENABLE ROW LEVEL SECURITY;
ALTER TABLE ig_posts_monitorados ENABLE ROW LEVEL SECURITY;
ALTER TABLE ig_posts_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE ig_perfis_monitorados ENABLE ROW LEVEL SECURITY;
ALTER TABLE instagram_engajamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cwrst_admin"  ON cowork_roteiros_stories  FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "cwryt_admin"  ON cowork_roteiros_youtube  FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "igpm_admin"   ON ig_posts_monitorados     FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "igps_admin"   ON ig_posts_snapshots       FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "igperfm_admin" ON ig_perfis_monitorados   FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "igeng_admin"  ON instagram_engajamento    FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "adss_admin"   ON ads_snapshots            FOR ALL USING (auth.uid() IS NOT NULL);
