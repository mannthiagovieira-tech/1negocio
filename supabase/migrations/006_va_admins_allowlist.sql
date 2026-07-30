-- ═══════════════════════════════════════════════════════════════════
-- HOTFIX RLS · va_admins allowlist explícita
-- Substitui heurística "auth.jwt()->>'email' IS NOT NULL" (que liberava
-- tabelas VA pra qualquer usuário logado com email — incluindo compradores/
-- vendedores do marketplace via index.html) por allowlist controlada.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS va_admins (
  usuario_id uuid PRIMARY KEY,
  nome text,
  criado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE va_admins ENABLE ROW LEVEL SECURITY;

-- Helper SECURITY DEFINER pra evitar recursão em policies self-referential
CREATE OR REPLACE FUNCTION va_is_admin() RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM va_admins WHERE usuario_id = auth.uid());
$$ LANGUAGE sql STABLE SECURITY DEFINER;
REVOKE ALL ON FUNCTION va_is_admin() FROM public;
GRANT EXECUTE ON FUNCTION va_is_admin() TO authenticated;

-- Popular com humanos reais (SEED aaaaaaaa-... fica de fora)
INSERT INTO va_admins (usuario_id, nome) VALUES
  ('df3b3f91-8887-494a-a854-738b88a6538d','admin@1negocio.com.br'),
  ('32beecae-7784-48e5-b6dd-64c89983dea7','mannthiagovieira@gmail.com'),
  ('08505fe2-d1d4-4c7e-a99e-1fb3d89026e9','thiago@1negocio.com.br')
ON CONFLICT (usuario_id) DO NOTHING;

-- Drop das policies "email IS NOT NULL" (frágeis)
DROP POLICY IF EXISTS va_admins_self                ON va_admins;
DROP POLICY IF EXISTS va_projetos_admin             ON va_projetos;
DROP POLICY IF EXISTS va_projeto_etapas_admin       ON va_projeto_etapas;
DROP POLICY IF EXISTS va_projeto_kickoff_admin      ON va_projeto_kickoff;
DROP POLICY IF EXISTS va_projeto_parcelas_admin     ON va_projeto_parcelas;
DROP POLICY IF EXISTS va_projeto_blacklist_admin    ON va_projeto_blacklist;
DROP POLICY IF EXISTS va_projeto_arquetipos_admin   ON va_projeto_arquetipos;
DROP POLICY IF EXISTS va_projeto_anexos_admin       ON va_projeto_anexos;
DROP POLICY IF EXISTS va_projeto_teaser_admin       ON va_projeto_teaser;
DROP POLICY IF EXISTS va_projeto_plano_admin        ON va_projeto_plano;
DROP POLICY IF EXISTS va_projeto_razao_admin        ON va_projeto_razao;
DROP POLICY IF EXISTS va_precos_read_admin          ON va_precos;
DROP POLICY IF EXISTS va_precos_update_admin        ON va_precos;
DROP POLICY IF EXISTS va_contatos_admin             ON va_contatos;
DROP POLICY IF EXISTS va_contato_interacoes_admin   ON va_contato_interacoes;
DROP POLICY IF EXISTS va_projeto_acesso_admin       ON va_projeto_acesso;
DROP POLICY IF EXISTS va_arquetipos_catalogo_admin  ON va_arquetipos_catalogo;

-- Recria: TODAS via va_is_admin()
CREATE POLICY va_admins_self                ON va_admins               FOR ALL    TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
CREATE POLICY va_projetos_admin             ON va_projetos             FOR ALL    TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
CREATE POLICY va_projeto_etapas_admin       ON va_projeto_etapas       FOR ALL    TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
CREATE POLICY va_projeto_kickoff_admin      ON va_projeto_kickoff      FOR ALL    TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
CREATE POLICY va_projeto_parcelas_admin     ON va_projeto_parcelas     FOR ALL    TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
CREATE POLICY va_projeto_blacklist_admin    ON va_projeto_blacklist    FOR ALL    TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
CREATE POLICY va_projeto_arquetipos_admin   ON va_projeto_arquetipos   FOR ALL    TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
CREATE POLICY va_projeto_anexos_admin       ON va_projeto_anexos       FOR ALL    TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
CREATE POLICY va_projeto_teaser_admin       ON va_projeto_teaser       FOR ALL    TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
CREATE POLICY va_projeto_plano_admin        ON va_projeto_plano        FOR ALL    TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
CREATE POLICY va_projeto_razao_admin        ON va_projeto_razao        FOR ALL    TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
CREATE POLICY va_precos_read_admin          ON va_precos               FOR SELECT TO authenticated USING (va_is_admin());
CREATE POLICY va_precos_update_admin        ON va_precos               FOR UPDATE TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
CREATE POLICY va_contatos_admin             ON va_contatos             FOR ALL    TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
CREATE POLICY va_contato_interacoes_admin   ON va_contato_interacoes   FOR ALL    TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
CREATE POLICY va_projeto_acesso_admin       ON va_projeto_acesso       FOR ALL    TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
CREATE POLICY va_arquetipos_catalogo_admin  ON va_arquetipos_catalogo  FOR SELECT TO authenticated USING (va_is_admin());

-- RPCs va_cli_* são SECURITY DEFINER → continuam funcionando (bypass RLS).
