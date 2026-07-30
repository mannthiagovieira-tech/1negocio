-- ═══════════════════════════════════════════════════════════════════
-- VENDA ASSESSORADA · SLICE 5 · contatos, kanban e funil
-- Aditivo · não altera nenhuma tabela existente
-- ═══════════════════════════════════════════════════════════════════

-- 1) va_contatos ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS va_contatos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  nome text,
  empresa text,
  telefone text,
  telefone_normalizado text,
  email text,
  cnpj text,
  cidade text,
  estado text,
  cargo text,
  porte_faturamento numeric(14,2),
  funcionarios int,
  socios jsonb,
  enriquecido_em timestamptz,
  origem text NOT NULL DEFAULT 'manual'
    CHECK (origem IN ('prospeccao','manual','anuncio','parceiro','matchmaking','organico')),
  origem_detalhe text,
  arquetipo_codigo text REFERENCES va_arquetipos_catalogo(codigo),
  trilha text NOT NULL DEFAULT 'fria' CHECK (trilha IN ('fria','quente')),
  estagio text NOT NULL DEFAULT 'novo'
    CHECK (estagio IN ('novo','abordado','sem_resposta','sem_interesse',
                       'interesse_inicial','apresentado','nda_assinado',
                       'em_negociacao','proposta','fechado','perdido')),
  qualidade text CHECK (qualidade IN ('lixo','fraco','bom','quente')),
  observacao text,
  proximo_passo text,
  proximo_passo_em date,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (projeto_id, telefone_normalizado)
);
CREATE INDEX IF NOT EXISTS va_contatos_proj_estagio ON va_contatos (projeto_id, estagio);
CREATE INDEX IF NOT EXISTS va_contatos_proj_origem  ON va_contatos (projeto_id, origem);
CREATE INDEX IF NOT EXISTS va_contatos_proj_arq     ON va_contatos (projeto_id, arquetipo_codigo);

-- 2) va_contato_interacoes ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS va_contato_interacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contato_id uuid NOT NULL REFERENCES va_contatos(id) ON DELETE CASCADE,
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN (
    'mudanca_estagio','disparo','resposta','ligacao','reuniao',
    'nda_enviado','nda_assinado','dossie_liberado','proposta',
    'nota','re_capturado'
  )),
  estagio_de text,
  estagio_para text,
  conteudo text,
  qualidade text,
  autor text,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS va_interac_contato ON va_contato_interacoes (contato_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS va_interac_proj    ON va_contato_interacoes (projeto_id, criado_em DESC);

-- 3) Normalização de telefone ─────────────────────────────────────
CREATE OR REPLACE FUNCTION va_normalizar_telefone(t text) RETURNS text AS $$
DECLARE d text;
BEGIN
  IF t IS NULL OR trim(t) = '' THEN RETURN NULL; END IF;
  d := regexp_replace(t, '\D', '', 'g');
  IF length(d) = 0 THEN RETURN NULL; END IF;
  IF length(d) IN (10,11) THEN RETURN '55' || d; END IF;
  IF length(d) BETWEEN 12 AND 13 AND left(d,2) = '55' THEN RETURN d; END IF;
  RETURN d;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 4) Trigger normaliza + atualiza atualizado_em ───────────────────
CREATE OR REPLACE FUNCTION va_contatos_norm_touch() RETURNS TRIGGER AS $$
BEGIN
  NEW.telefone_normalizado := va_normalizar_telefone(NEW.telefone);
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS va_contatos_norm ON va_contatos;
CREATE TRIGGER va_contatos_norm BEFORE INSERT OR UPDATE ON va_contatos
  FOR EACH ROW EXECUTE FUNCTION va_contatos_norm_touch();

-- 5) va_registrar_contato ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION va_registrar_contato(
  p_projeto uuid, p_nome text, p_telefone text, p_empresa text,
  p_cidade text, p_origem text, p_origem_detalhe text,
  p_arquetipo text, p_debitar boolean DEFAULT false
) RETURNS jsonb AS $$
DECLARE
  v_norm text; v_bl_id uuid; v_bl_motivo text; v_bl_nome text;
  v_exist_id uuid; v_exist_criado timestamptz; v_exist_estagio text;
  v_novo uuid; v_trilha text;
BEGIN
  v_norm := va_normalizar_telefone(p_telefone);

  IF v_norm IS NOT NULL THEN
    SELECT id, motivo, nome INTO v_bl_id, v_bl_motivo, v_bl_nome
    FROM va_projeto_blacklist
    WHERE projeto_id = p_projeto
      AND telefone IS NOT NULL
      AND (
        va_normalizar_telefone(telefone) = v_norm
        OR right(regexp_replace(telefone, '\D', '', 'g'), 10) = right(v_norm, 10)
      )
    LIMIT 1;
    IF v_bl_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'status','bloqueado',
        'motivo', coalesce(v_bl_motivo,'sem motivo'),
        'nome',   coalesce(v_bl_nome,'')
      );
    END IF;
  END IF;

  IF v_norm IS NOT NULL THEN
    SELECT id, criado_em, estagio INTO v_exist_id, v_exist_criado, v_exist_estagio
    FROM va_contatos
    WHERE projeto_id = p_projeto AND telefone_normalizado = v_norm
    LIMIT 1;
    IF v_exist_id IS NOT NULL THEN
      INSERT INTO va_contato_interacoes (contato_id, projeto_id, tipo, conteudo, autor)
      VALUES (v_exist_id, p_projeto, 're_capturado',
              coalesce(p_origem_detalhe, p_origem, 'sem detalhe'), 'sistema');
      RETURN jsonb_build_object(
        'status','duplicado',
        'contato_id', v_exist_id,
        'criado_em',  v_exist_criado,
        'estagio',    v_exist_estagio
      );
    END IF;
  END IF;

  v_trilha := CASE WHEN p_origem IN ('anuncio','organico') THEN 'quente' ELSE 'fria' END;

  INSERT INTO va_contatos (projeto_id, nome, telefone, empresa, cidade,
    origem, origem_detalhe, arquetipo_codigo, trilha, estagio)
  VALUES (p_projeto, p_nome, p_telefone, p_empresa, p_cidade,
    p_origem, p_origem_detalhe, p_arquetipo, v_trilha, 'novo')
  RETURNING id INTO v_novo;

  IF p_debitar THEN
    PERFORM va_debitar(
      p_projeto, 'lead_scrapper', 1,
      'Contato: ' || coalesce(p_nome, coalesce(p_empresa, 'sem nome'))
        || CASE WHEN p_origem_detalhe IS NOT NULL THEN ' · '||p_origem_detalhe ELSE '' END,
      NULL
    );
  END IF;

  RETURN jsonb_build_object('status','criado','contato_id', v_novo, 'trilha', v_trilha);
END;
$$ LANGUAGE plpgsql;

-- 6) va_mover_contato ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION va_mover_contato(
  p_contato uuid, p_estagio text, p_qualidade text, p_feedback text
) RETURNS uuid AS $$
DECLARE v_de text; v_proj uuid;
BEGIN
  SELECT estagio, projeto_id INTO v_de, v_proj FROM va_contatos WHERE id = p_contato;
  IF v_proj IS NULL THEN
    RAISE EXCEPTION 'contato % não encontrado', p_contato;
  END IF;

  IF p_estagio NOT IN ('novo','abordado')
     AND (p_feedback IS NULL OR btrim(p_feedback) = '') THEN
    RAISE EXCEPTION 'feedback obrigatório ao mover para estágio "%"', p_estagio;
  END IF;

  UPDATE va_contatos
    SET estagio = p_estagio,
        qualidade = COALESCE(p_qualidade, qualidade)
  WHERE id = p_contato;

  INSERT INTO va_contato_interacoes
    (contato_id, projeto_id, tipo, estagio_de, estagio_para, conteudo, qualidade, autor)
  VALUES
    (p_contato, v_proj, 'mudanca_estagio', v_de, p_estagio, p_feedback, p_qualidade, 'admin');

  RETURN p_contato;
END;
$$ LANGUAGE plpgsql;

-- 7) VIEW va_projeto_funil ────────────────────────────────────────
CREATE OR REPLACE VIEW va_projeto_funil AS
SELECT projeto_id, estagio, trilha, count(*)::int AS total
FROM va_contatos
GROUP BY projeto_id, estagio, trilha;

-- 8) VIEW va_projeto_arquetipo_desempenho ─────────────────────────
-- TODO: custo_total por arquétipo depende de tag em va_projeto_razao
-- (hoje o razão não segrega despesa por arquétipo). Fica 0 até
-- extendermos o modelo de débitos.
CREATE OR REPLACE VIEW va_projeto_arquetipo_desempenho AS
SELECT
  c.projeto_id,
  c.arquetipo_codigo,
  cat.nome,
  count(*)::int AS captados,
  count(*) FILTER (WHERE c.qualidade IN ('bom','quente'))::int AS qualificados,
  ROUND(
    count(*) FILTER (WHERE c.qualidade IN ('bom','quente'))::numeric
    / NULLIF(count(*), 0)::numeric * 100, 1
  ) AS taxa_pct,
  0::numeric AS custo_total
FROM va_contatos c
LEFT JOIN va_arquetipos_catalogo cat ON cat.codigo = c.arquetipo_codigo
WHERE c.arquetipo_codigo IS NOT NULL
GROUP BY c.projeto_id, c.arquetipo_codigo, cat.nome;

-- 9) RLS ──────────────────────────────────────────────────────────
ALTER TABLE va_contatos            ENABLE ROW LEVEL SECURITY;
ALTER TABLE va_contato_interacoes  ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS va_contatos_auth  ON va_contatos;
DROP POLICY IF EXISTS va_interac_auth   ON va_contato_interacoes;
CREATE POLICY va_contatos_auth ON va_contatos           FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY va_interac_auth  ON va_contato_interacoes FOR ALL TO authenticated USING (true) WITH CHECK (true);
