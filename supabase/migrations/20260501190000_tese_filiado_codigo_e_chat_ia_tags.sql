-- v3.4: vínculo tese × filiado + tags de interesse no chat_ia_leads

ALTER TABLE teses_investimento
  ADD COLUMN IF NOT EXISTS filiado_codigo text;

COMMENT ON COLUMN teses_investimento.filiado_codigo IS
  'Código do filiado (FIL-XXXXX) que trouxe a tese, se houver';

CREATE INDEX IF NOT EXISTS idx_teses_filiado_codigo
  ON teses_investimento(filiado_codigo)
  WHERE filiado_codigo IS NOT NULL;

ALTER TABLE chat_ia_leads
  ADD COLUMN IF NOT EXISTS tag_interesse text,
  ADD COLUMN IF NOT EXISTS perfil_relatado text,
  ADD COLUMN IF NOT EXISTS interesse_relatado text;

CREATE INDEX IF NOT EXISTS idx_chat_ia_leads_tag_interesse
  ON chat_ia_leads(tag_interesse)
  WHERE tag_interesse IS NOT NULL;
