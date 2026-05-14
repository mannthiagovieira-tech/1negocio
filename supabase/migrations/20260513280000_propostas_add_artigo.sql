-- v9.34.7b · artigo (o/a) opcional pra construção gramatical correta no template
ALTER TABLE propostas_comerciais ADD COLUMN IF NOT EXISTS artigo text DEFAULT 'o' CHECK (artigo IN ('o','a'));
