-- Migration 020: Permite INSERT/UPDATE de anuncios_v2 via anon
-- Mesmo padrão da Migration 012 pra laudos_v2 — destrava maquininha
-- e fluxo do painel admin (que usa anon via Edge Function admin-api).

BEGIN;

CREATE POLICY anuncios_v2_insert_anon ON anuncios_v2
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY anuncios_v2_update_anon ON anuncios_v2
  FOR UPDATE TO anon, authenticated
  USING (true)
  WITH CHECK (true);

COMMIT;
