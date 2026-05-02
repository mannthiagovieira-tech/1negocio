-- Tabela de auditoria de acessos ao dossiê do comprador (Camada 3 pós-NDA)
CREATE TABLE IF NOT EXISTS dossie_acessos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id UUID NOT NULL REFERENCES negocios(id),
  comprador_id UUID NOT NULL REFERENCES usuarios(id),
  solicitacao_info_id UUID REFERENCES solicitacoes_info(id),
  ip TEXT,
  user_agent TEXT,
  referrer TEXT,
  acessado_em TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dossie_acessos_negocio_idx ON dossie_acessos(negocio_id);
CREATE INDEX IF NOT EXISTS dossie_acessos_comprador_idx ON dossie_acessos(comprador_id);
CREATE INDEX IF NOT EXISTS dossie_acessos_acessado_em_idx ON dossie_acessos(acessado_em DESC);

COMMENT ON TABLE dossie_acessos IS
  'Auditoria de cada acesso ao dossiê pós-NDA. 1 row por sessão de visualização.';

ALTER TABLE dossie_acessos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dossie_acessos_insert_self ON dossie_acessos;
CREATE POLICY dossie_acessos_insert_self ON dossie_acessos
  FOR INSERT TO authenticated
  WITH CHECK (comprador_id = auth.uid());

DROP POLICY IF EXISTS dossie_acessos_select_self ON dossie_acessos;
CREATE POLICY dossie_acessos_select_self ON dossie_acessos
  FOR SELECT TO authenticated
  USING (comprador_id = auth.uid());

DROP POLICY IF EXISTS dossie_acessos_service_all ON dossie_acessos;
CREATE POLICY dossie_acessos_service_all ON dossie_acessos
  FOR ALL TO public
  USING (auth.role() = 'service_role'::text)
  WITH CHECK (auth.role() = 'service_role'::text);
