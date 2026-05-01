ALTER TABLE config_plataforma ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS config_plataforma_select_authenticated ON config_plataforma;
CREATE POLICY config_plataforma_select_authenticated
  ON config_plataforma
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS config_plataforma_insert_authenticated ON config_plataforma;
CREATE POLICY config_plataforma_insert_authenticated
  ON config_plataforma
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS config_plataforma_update_authenticated ON config_plataforma;
CREATE POLICY config_plataforma_update_authenticated
  ON config_plataforma
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE config_plataforma IS
  'Configurações globais. RLS: leitura authenticated, escrita authenticated (refinar pra admin only quando houver perfis).';
