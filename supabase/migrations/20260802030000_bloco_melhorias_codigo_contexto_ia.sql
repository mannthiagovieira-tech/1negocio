-- (1) Código VA-XXXX único
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS codigo text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_va_projetos_codigo ON va_projetos(codigo) WHERE codigo IS NOT NULL;

CREATE OR REPLACE FUNCTION va_gerar_codigo_projeto()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text; i int; existe int;
BEGIN
  LOOP
    c := 'VA-';
    FOR i IN 1..4 LOOP c := c || substr(chars, 1 + floor(random() * length(chars))::int, 1); END LOOP;
    SELECT COUNT(*) INTO existe FROM va_projetos WHERE codigo = c;
    EXIT WHEN existe = 0;
  END LOOP;
  RETURN c;
END; $$;

CREATE OR REPLACE FUNCTION va_projetos_codigo_va_bi()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.codigo IS NULL THEN NEW.codigo := va_gerar_codigo_projeto(); END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS va_projetos_codigo_va_tg ON va_projetos;
CREATE TRIGGER va_projetos_codigo_va_tg BEFORE INSERT ON va_projetos
  FOR EACH ROW EXECUTE FUNCTION va_projetos_codigo_va_bi();
UPDATE va_projetos SET codigo = va_gerar_codigo_projeto() WHERE codigo IS NULL;

-- (2) CPM/CTR/conversão pra bloco expectativa · defaults conservadores
ALTER TABLE va_precos_versao_config ADD COLUMN IF NOT EXISTS cpm_estimado numeric DEFAULT 25.00;
ALTER TABLE va_precos_versao_config ADD COLUMN IF NOT EXISTS ctr_estimado_pct numeric DEFAULT 1.50;
ALTER TABLE va_precos_versao_config ADD COLUMN IF NOT EXISTS taxa_conversa_pct numeric DEFAULT 12.00;
ALTER TABLE va_precos_versao_config ADD COLUMN IF NOT EXISTS taxa_interesse_real_pct numeric DEFAULT 15.00;

-- (4) Contexto do negócio
CREATE TABLE IF NOT EXISTS va_projeto_contexto (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('reuniao','nota','documento','foto','video','link')),
  titulo text, data_referencia date,
  conteudo text, arquivo_path text, url_externa text,
  categoria text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por text
);
GRANT SELECT, INSERT, UPDATE, DELETE ON va_projeto_contexto TO authenticated, service_role;

INSERT INTO storage.buckets (id, name, public) VALUES ('projeto-contexto', 'projeto-contexto', false) ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "va_read_contexto" ON storage.objects;
DROP POLICY IF EXISTS "va_write_contexto" ON storage.objects;
CREATE POLICY "va_read_contexto" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'projeto-contexto');
CREATE POLICY "va_write_contexto" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'projeto-contexto');

-- (5) Descrição versionada
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS descricao_negocio text;
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS descricao_negocio_versao int DEFAULT 0;
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS descricao_negocio_gerado_em timestamptz;
CREATE TABLE IF NOT EXISTS va_projeto_descricao_hist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  versao int NOT NULL,
  texto text NOT NULL,
  gerado_por text,
  gerado_em timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON va_projeto_descricao_hist TO authenticated, service_role;

-- (6) Teaser versionado
CREATE TABLE IF NOT EXISTS va_projeto_teaser (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  versao int NOT NULL,
  angulo text, texto text NOT NULL,
  aprovado boolean NOT NULL DEFAULT false,
  aprovado_em timestamptz, aprovado_por text,
  gerado_por text,
  gerado_em timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON va_projeto_teaser TO authenticated, service_role;
