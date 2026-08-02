-- Zona ATIVO · fontes qualitativas (reuniões, anotações, documentos colados).
-- Alimentam as gerações IA de arquétipos e teaser como CONTEXTO QUALITATIVO.
-- Não é anexo de arquivo (isso é outro fluxo) — é texto colado direto.

CREATE TABLE IF NOT EXISTS va_projeto_fontes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('reuniao','anotacao','documento')),
  titulo text,
  conteudo text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_va_projeto_fontes_projeto_recente
  ON va_projeto_fontes(projeto_id, criado_em DESC);
ALTER TABLE va_projeto_fontes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS va_projeto_fontes_admin ON va_projeto_fontes;
CREATE POLICY va_projeto_fontes_admin ON va_projeto_fontes
  FOR ALL TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
GRANT SELECT, INSERT, UPDATE, DELETE ON va_projeto_fontes TO authenticated;

-- Adendo v2: destilação IA quando o conteúdo é transcript bruto.
-- conteudo mantém o cru (transcript inteiro); conteudo_destilado é o output
-- do Sonnet estruturado em FATOS/MOTIVAÇÃO/RESTRIÇÕES/COMPRADORES/etc.
-- As gerações leem conteudo_destilado quando existir, senão conteudo.
ALTER TABLE va_projeto_fontes ADD COLUMN IF NOT EXISTS conteudo_destilado text NULL;
ALTER TABLE va_projeto_fontes ADD COLUMN IF NOT EXISTS destilado_em timestamptz NULL;
ALTER TABLE va_projeto_fontes ADD COLUMN IF NOT EXISTS formato_detectado text NULL
  CHECK (formato_detectado IS NULL OR formato_detectado IN ('gemini','transcript','livre'));
