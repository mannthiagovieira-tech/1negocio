-- P5.1 · biblioteca GLOBAL de templates de criativo (não vinculada a projeto)
CREATE TABLE IF NOT EXISTS va_criativo_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  nome text NOT NULL,
  descricao text,
  formato text NOT NULL CHECK (formato IN ('feed_1080','story_1080x1920','link_1200x628')),
  layout text NOT NULL,
  campos_suportados jsonb NOT NULL DEFAULT '[]',
  campos_obrigatorios jsonb NOT NULL DEFAULT '[]',
  copy_default jsonb NOT NULL DEFAULT '{}',
  cta_default text,
  preview_png_path text,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','arquivado')),
  criado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE va_criativos
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES va_criativo_templates(id) ON DELETE SET NULL;

ALTER TABLE va_criativos DROP CONSTRAINT IF EXISTS va_criativos_origem_check;
ALTER TABLE va_criativos ADD CONSTRAINT va_criativos_origem_check
  CHECK (origem IN ('ia','manual','template','upload'));

CREATE INDEX IF NOT EXISTS va_criativos_template_idx ON va_criativos(template_id) WHERE template_id IS NOT NULL;

INSERT INTO va_criativo_templates (slug, nome, descricao, formato, layout, campos_suportados, campos_obrigatorios, cta_default)
VALUES
  ('classificado_feed', 'Classificado · feed', 'VENDE-SE gigante topo + tipo + região + 2 âncoras + CTA. Formato feed 1:1.',
    'feed_1080', 'classificado',
    '["titulo_vende_se","tipo_negocio","regiao_macro","faixa_valor","faixa_faturamento","ebitda_pct","cta"]',
    '["tipo_negocio","regiao_macro"]', 'Falar com o assessor'),
  ('card_financeiro_feed', 'Card financeiro · feed', 'Estilo cards do 1negocio.com.br · dados numéricos em grid, faixa valor, contexto.',
    'feed_1080', 'card_financeiro',
    '["tipo_negocio","regiao_macro","faixa_valor","faixa_faturamento","ebitda_pct","destaque_1","cta"]',
    '["tipo_negocio","regiao_macro","faixa_valor"]', 'Quero ver o dossiê'),
  ('teaser_dado_story', 'Teaser de dado · story', 'Um número gigante (faixa valor OU faturamento OU EBITDA) + linha de contexto.',
    'story_1080x1920', 'teaser_dado',
    '["dado_principal","dado_label","contexto","cta"]',
    '["dado_principal"]', 'Saiba mais'),
  ('chamada_comprador_feed', 'Chamada de comprador · feed', 'PROCURAMOS COMPRADOR · [tipo] · [região] · inverte a voz.',
    'feed_1080', 'chamada_comprador',
    '["tipo_negocio","regiao_macro","destaque_1","cta"]',
    '["tipo_negocio","regiao_macro"]', 'Sou comprador')
ON CONFLICT (slug) DO UPDATE SET
  nome=EXCLUDED.nome, descricao=EXCLUDED.descricao, formato=EXCLUDED.formato, layout=EXCLUDED.layout,
  campos_suportados=EXCLUDED.campos_suportados, campos_obrigatorios=EXCLUDED.campos_obrigatorios,
  cta_default=EXCLUDED.cta_default;

GRANT SELECT ON va_criativo_templates TO anon, authenticated;
