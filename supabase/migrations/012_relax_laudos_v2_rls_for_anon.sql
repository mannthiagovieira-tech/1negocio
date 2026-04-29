-- Permitir INSERT e UPDATE em laudos_v2 pelo role anon
-- Espelha pattern de laudos_completos (v1) que já funciona assim
-- Necessário porque skill v2 roda no front com SUPABASE_ANON_KEY

-- Remover policies antigas (que só permitem authenticated)
DROP POLICY IF EXISTS laudos_v2_insert_authenticated ON laudos_v2;
DROP POLICY IF EXISTS laudos_v2_update_authenticated ON laudos_v2;

-- Criar policies permitindo anon (igual laudos_completos)
CREATE POLICY laudos_v2_insert_anon ON laudos_v2
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY laudos_v2_update_anon ON laudos_v2
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

COMMENT ON POLICY laudos_v2_insert_anon ON laudos_v2 IS
  'Permite INSERT pelo front (skill v2 com anon key). Mesmo padrão de laudos_completos.';
COMMENT ON POLICY laudos_v2_update_anon ON laudos_v2 IS
  'Permite UPDATE pelo front (skill v2 marca laudos antigos como ativo=false antes de inserir novo).';
