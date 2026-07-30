-- ═══════════════════════════════════════════════════════════════════
-- VENDA ASSESSORADA · SLICE 8 · atendimento, NDA e dossiê
-- ═══════════════════════════════════════════════════════════════════

-- 1) codigo_atendimento em va_projetos + trigger BEFORE INSERT ─────
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS codigo_atendimento text;
CREATE UNIQUE INDEX IF NOT EXISTS va_projetos_codigo_uk ON va_projetos (codigo_atendimento);

CREATE OR REPLACE FUNCTION va_gerar_codigo_atendimento() RETURNS text AS $$
DECLARE v_cod text; v_tent int := 0;
BEGIN
  LOOP
    v_cod := lpad((floor(random() * 10000))::int::text, 4, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM va_projetos WHERE codigo_atendimento = v_cod);
    v_tent := v_tent + 1;
    IF v_tent > 200 THEN RAISE EXCEPTION 'não achou código único'; END IF;
  END LOOP;
  RETURN v_cod;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION va_projetos_codigo_bi() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.codigo_atendimento IS NULL THEN
    NEW.codigo_atendimento := va_gerar_codigo_atendimento();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS va_projetos_codigo ON va_projetos;
CREATE TRIGGER va_projetos_codigo BEFORE INSERT ON va_projetos
  FOR EACH ROW EXECUTE FUNCTION va_projetos_codigo_bi();

-- Backfill
UPDATE va_projetos SET codigo_atendimento = va_gerar_codigo_atendimento()
WHERE codigo_atendimento IS NULL;

-- 2) va_canais_origem ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS va_canais_origem (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  sufixo text NOT NULL,
  rotulo text NOT NULL,
  tipo text CHECK (tipo IN ('campanha','criativo','parceiro','organico','outro')),
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (projeto_id, sufixo)
);

-- 3) va_atendimentos ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS va_atendimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  contato_id uuid REFERENCES va_contatos(id) ON DELETE SET NULL,
  canal_sufixo text,
  primeira_mensagem text,
  iniciado_em timestamptz NOT NULL DEFAULT now(),
  respondido_em timestamptz,
  tempo_resposta_min int,
  desfecho text NOT NULL DEFAULT 'em_andamento'
    CHECK (desfecho IN ('em_andamento','qualificado','descartado','nda_enviado')),
  motivo_descarte text,
  observacao text,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS va_atendimentos_proj_dt ON va_atendimentos (projeto_id, iniciado_em DESC);

-- 4) va_ndas ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS va_ndas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  contato_id uuid NOT NULL REFERENCES va_contatos(id) ON DELETE CASCADE,
  template_versao int,
  corpo_gerado text NOT NULL,
  status text NOT NULL DEFAULT 'gerado'
    CHECK (status IN ('gerado','enviado','assinado','recusado','expirado')),
  enviado_em timestamptz,
  assinado_em timestamptz,
  assinado_nome text,
  assinado_documento text,
  assinado_ip text,
  token_publico text UNIQUE,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS va_ndas_proj ON va_ndas (projeto_id);

-- 5) va_dossie_acessos ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS va_dossie_acessos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  contato_id uuid NOT NULL REFERENCES va_contatos(id) ON DELETE CASCADE,
  nda_id uuid REFERENCES va_ndas(id),
  liberado_em timestamptz NOT NULL DEFAULT now(),
  liberado_por text,
  nivel text NOT NULL CHECK (nivel IN ('parcial','completo')),
  visualizacoes int NOT NULL DEFAULT 0,
  ultima_visualizacao timestamptz
);
CREATE INDEX IF NOT EXISTS va_dossie_proj_ct ON va_dossie_acessos (projeto_id, contato_id);

-- 6) va_documento_templates + SEED NDA ────────────────────────────
CREATE TABLE IF NOT EXISTS va_documento_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('nda','mandato','termo_adesao','carta_intencao')),
  nome text NOT NULL,
  corpo text NOT NULL,
  versao int NOT NULL DEFAULT 1,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now()
);

INSERT INTO va_documento_templates (tipo, nome, corpo, versao, ativo)
SELECT 'nda', 'NDA padrão v1', $NDA$
TERMO DE CONFIDENCIALIDADE E NÃO DIVULGAÇÃO

Pelo presente instrumento, {{contato_nome}}, inscrito(a) no CPF/CNPJ
{{contato_documento}} (doravante "RECEPTOR"), e a 1NEGÓCIO,
representando o vendedor de negócio no setor de {{negocio_setor}} em
{{negocio_cidade}}, ajustam o seguinte:

1. OBJETO
O RECEPTOR receberá informações sobre um negócio em processo de venda,
com o propósito exclusivo de avaliar interesse em adquiri-lo.

2. INFORMAÇÃO CONFIDENCIAL
Toda informação recebida — verbal, escrita, digital ou visual — sobre
o negócio, seus donos, clientes, fornecedores, contratos, números
financeiros, operações, marcas, sistemas ou qualquer dado não público,
é confidencial ("Informação Confidencial").

3. OBRIGAÇÕES DO RECEPTOR
3.1 Manter a Informação Confidencial em sigilo absoluto.
3.2 Usar a Informação Confidencial apenas para a avaliação do negócio.
3.3 Não copiar, reproduzir, distribuir, ceder ou compartilhar com
terceiros sem autorização prévia e escrita.
3.4 Não abordar diretamente clientes, fornecedores, funcionários ou
sócios do negócio identificado sem intermediação da 1NEGÓCIO.
3.5 Devolver ou destruir todo material recebido caso desista da compra
ou seja solicitado.

4. EXCEÇÕES
Não é considerada Informação Confidencial aquela que (a) já era pública
antes deste termo, (b) o RECEPTOR já possuía comprovadamente, ou (c)
for divulgada por obrigação legal ou judicial.

5. PRAZO
As obrigações deste termo valem por {{prazo_meses}} meses a partir da
assinatura, mesmo que as tratativas de aquisição sejam encerradas antes.

6. PENALIDADE
O descumprimento sujeita o RECEPTOR à multa não compensatória de
R$ 100.000,00 (cem mil reais), sem prejuízo de perdas e danos apurados.

7. FORO
Fica eleito o foro da comarca de {{negocio_cidade}} para dirimir
questões deste termo, com renúncia a qualquer outro.

Assinado eletronicamente em {{data_extenso}}.

RECEPTOR: {{contato_nome}} · CPF/CNPJ {{contato_documento}}
$NDA$, 1, true
WHERE NOT EXISTS (SELECT 1 FROM va_documento_templates WHERE tipo='nda' AND versao=1);

-- 7) FUNÇÕES ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION va_gerar_nda(p_contato uuid) RETURNS jsonb AS $$
DECLARE
  v_c va_contatos%ROWTYPE;
  v_p va_projetos%ROWTYPE;
  v_tpl va_documento_templates%ROWTYPE;
  v_corpo text;
  v_token text;
  v_id uuid;
BEGIN
  SELECT * INTO v_c FROM va_contatos WHERE id = p_contato;
  IF v_c.id IS NULL THEN RAISE EXCEPTION 'contato não encontrado'; END IF;
  SELECT * INTO v_p FROM va_projetos WHERE id = v_c.projeto_id;
  SELECT * INTO v_tpl FROM va_documento_templates
   WHERE tipo='nda' AND ativo=true ORDER BY versao DESC LIMIT 1;
  IF v_tpl.id IS NULL THEN RAISE EXCEPTION 'sem template NDA ativo'; END IF;

  v_corpo := v_tpl.corpo;
  v_corpo := replace(v_corpo, '{{contato_nome}}',      COALESCE(v_c.nome, '—'));
  v_corpo := replace(v_corpo, '{{contato_documento}}', COALESCE(v_c.cnpj, '—'));
  v_corpo := replace(v_corpo, '{{negocio_setor}}',     COALESCE(v_p.setor, '—'));
  v_corpo := replace(v_corpo, '{{negocio_cidade}}',    COALESCE(v_p.cidade, '—'));
  v_corpo := replace(v_corpo, '{{data_extenso}}',      to_char(CURRENT_DATE, 'DD/MM/YYYY'));
  v_corpo := replace(v_corpo, '{{prazo_meses}}',       '24');

  v_token := encode(gen_random_bytes(16), 'hex');

  INSERT INTO va_ndas (projeto_id, contato_id, template_versao, corpo_gerado, status, token_publico, enviado_em)
  VALUES (v_c.projeto_id, v_c.id, v_tpl.versao, v_corpo, 'enviado', v_token, now())
  RETURNING id INTO v_id;

  INSERT INTO va_contato_interacoes (contato_id, projeto_id, tipo, conteudo, autor)
  VALUES (v_c.id, v_c.projeto_id, 'nda_enviado', 'Token: ' || left(v_token, 8) || '...', 'admin');

  PERFORM va_debitar(v_c.projeto_id, 'nda_gerado', 1,
    'NDA · contato #' || left(replace(v_c.id::text,'-',''), 6), NULL);

  RETURN jsonb_build_object(
    'ok', true, 'nda_id', v_id, 'token', v_token,
    'link', 'https://www.1negocio.com.br/nda.html?t=' || v_token
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION va_registrar_assinatura_nda(
  p_token text, p_nome text, p_documento text, p_ip text
) RETURNS jsonb AS $$
DECLARE v_nda va_ndas%ROWTYPE;
BEGIN
  IF p_nome IS NULL OR btrim(p_nome) = '' THEN RAISE EXCEPTION 'nome obrigatório'; END IF;
  IF p_documento IS NULL OR btrim(p_documento) = '' THEN RAISE EXCEPTION 'documento obrigatório'; END IF;
  SELECT * INTO v_nda FROM va_ndas WHERE token_publico = p_token;
  IF v_nda.id IS NULL THEN RAISE EXCEPTION 'nda não encontrado'; END IF;
  IF v_nda.status = 'assinado' THEN
    RETURN jsonb_build_object('ok', true, 'ja_assinado', true, 'assinado_em', v_nda.assinado_em);
  END IF;
  IF v_nda.status IN ('recusado','expirado') THEN
    RAISE EXCEPTION 'nda inválido: %', v_nda.status;
  END IF;

  UPDATE va_ndas SET
    status='assinado', assinado_em=now(),
    assinado_nome=p_nome, assinado_documento=p_documento, assinado_ip=p_ip
  WHERE id = v_nda.id;

  PERFORM va_mover_contato(v_nda.contato_id, 'nda_assinado', NULL,
    'NDA assinado por ' || p_nome);

  INSERT INTO va_dossie_acessos (projeto_id, contato_id, nda_id, liberado_por, nivel)
  VALUES (v_nda.projeto_id, v_nda.contato_id, v_nda.id, 'assinatura_nda', 'parcial');

  INSERT INTO va_contato_interacoes (contato_id, projeto_id, tipo, conteudo, autor)
  VALUES (v_nda.contato_id, v_nda.projeto_id, 'nda_assinado',
          p_nome || ' · doc ' || p_documento, 'sistema');

  RETURN jsonb_build_object('ok', true, 'nda_id', v_nda.id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION va_liberar_dossie(p_contato uuid, p_nivel text) RETURNS uuid AS $$
DECLARE v_c va_contatos%ROWTYPE; v_id uuid;
BEGIN
  SELECT * INTO v_c FROM va_contatos WHERE id = p_contato;
  IF v_c.id IS NULL THEN RAISE EXCEPTION 'contato não encontrado'; END IF;
  IF p_nivel NOT IN ('parcial','completo') THEN
    RAISE EXCEPTION 'nível inválido: %', p_nivel;
  END IF;
  IF p_nivel = 'completo' AND NOT EXISTS (
    SELECT 1 FROM va_ndas WHERE contato_id = p_contato AND status = 'assinado'
  ) THEN
    RAISE EXCEPTION 'dossiê completo exige NDA assinado';
  END IF;
  INSERT INTO va_dossie_acessos (projeto_id, contato_id, nivel, liberado_por)
  VALUES (v_c.projeto_id, v_c.id, p_nivel, 'admin')
  RETURNING id INTO v_id;
  INSERT INTO va_contato_interacoes (contato_id, projeto_id, tipo, conteudo, autor)
  VALUES (v_c.id, v_c.projeto_id, 'dossie_liberado', 'nível ' || p_nivel, 'admin');
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC pública anon-friendly · busca NDA por token (só colunas essenciais)
CREATE OR REPLACE FUNCTION va_nda_por_token(p_token text)
RETURNS TABLE (
  id uuid, status text, corpo_gerado text, projeto_titulo text,
  assinado_em timestamptz, assinado_nome text
) AS $$
  SELECT n.id, n.status, n.corpo_gerado,
    COALESCE(p.negocio_titulo, p.setor, 'Negócio') AS projeto_titulo,
    n.assinado_em, n.assinado_nome
  FROM va_ndas n JOIN va_projetos p ON p.id = n.projeto_id
  WHERE n.token_publico = p_token LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 8) RLS ──────────────────────────────────────────────────────────
ALTER TABLE va_canais_origem       ENABLE ROW LEVEL SECURITY;
ALTER TABLE va_atendimentos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE va_ndas                ENABLE ROW LEVEL SECURITY;
ALTER TABLE va_dossie_acessos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE va_documento_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS va_canais_admin       ON va_canais_origem;
DROP POLICY IF EXISTS va_atendimentos_admin ON va_atendimentos;
DROP POLICY IF EXISTS va_ndas_admin         ON va_ndas;
DROP POLICY IF EXISTS va_dossie_admin       ON va_dossie_acessos;
DROP POLICY IF EXISTS va_doc_tpl_admin      ON va_documento_templates;

CREATE POLICY va_canais_admin       ON va_canais_origem       FOR ALL TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
CREATE POLICY va_atendimentos_admin ON va_atendimentos        FOR ALL TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
CREATE POLICY va_ndas_admin         ON va_ndas                FOR ALL TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
CREATE POLICY va_dossie_admin       ON va_dossie_acessos      FOR ALL TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
CREATE POLICY va_doc_tpl_admin      ON va_documento_templates FOR ALL TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());

GRANT EXECUTE ON FUNCTION va_gerar_nda(uuid)                            TO authenticated;
GRANT EXECUTE ON FUNCTION va_liberar_dossie(uuid, text)                 TO authenticated;
GRANT EXECUTE ON FUNCTION va_nda_por_token(text)                        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION va_registrar_assinatura_nda(text,text,text,text) TO anon, authenticated;
