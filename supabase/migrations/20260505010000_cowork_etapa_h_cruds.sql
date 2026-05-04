-- Migration · Cowork Etapa H · tabelas pra CRUDs admin
-- Data: 2026-05-05 · aplicada via MCP apply_migration

CREATE TABLE IF NOT EXISTS cowork_cidades_alvo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cidade TEXT NOT NULL,
  uf TEXT NOT NULL,
  regiao TEXT,
  ordem INT DEFAULT 0,
  ativo BOOLEAN DEFAULT true,
  ultima_rodada DATE,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cidade, uf)
);

CREATE TABLE IF NOT EXISTS ig_perfis_ancora (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  descricao TEXT,
  tipo TEXT,
  ultima_captura TIMESTAMPTZ,
  total_followers_capturados INT DEFAULT 0,
  ativo BOOLEAN DEFAULT true,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ads_concorrentes_monitorados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_pagina TEXT NOT NULL,
  pagina_id_meta TEXT,
  pais TEXT DEFAULT 'BR',
  frequencia_dias INT DEFAULT 7,
  ativo BOOLEAN DEFAULT true,
  ultima_analise TIMESTAMPTZ,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(nome_pagina, pais)
);

ALTER TABLE cowork_cidades_alvo ENABLE ROW LEVEL SECURITY;
ALTER TABLE ig_perfis_ancora ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads_concorrentes_monitorados ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cowork_cidades_admin" ON cowork_cidades_alvo FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "ig_perfis_ancora_admin" ON ig_perfis_ancora FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "ads_concorrentes_admin" ON ads_concorrentes_monitorados FOR ALL USING (auth.uid() IS NOT NULL);

INSERT INTO cowork_cidades_alvo (cidade, uf, regiao, ordem) VALUES
  ('Porto Alegre','RS','Sul',1),('Caxias do Sul','RS','Sul',2),('Pelotas','RS','Sul',3),('Santa Maria','RS','Sul',4),('Novo Hamburgo','RS','Sul',5),
  ('Florianópolis','SC','Sul',6),('Joinville','SC','Sul',7),('Blumenau','SC','Sul',8),('Balneário Camboriú','SC','Sul',9),('Itajaí','SC','Sul',10),
  ('Chapecó','SC','Sul',11),('Criciúma','SC','Sul',12),('Lages','SC','Sul',13),
  ('Curitiba','PR','Sul',14),('Londrina','PR','Sul',15),('Maringá','PR','Sul',16),('Cascavel','PR','Sul',17),('Foz do Iguaçu','PR','Sul',18)
ON CONFLICT (cidade, uf) DO NOTHING;
