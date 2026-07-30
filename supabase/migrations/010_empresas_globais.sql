-- ═══════════════════════════════════════════════════════════════════
-- VENDA ASSESSORADA · SLICE 10 · cadastro global de empresas
-- ═══════════════════════════════════════════════════════════════════

-- 1) va_empresas ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS va_empresas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cnpj text UNIQUE,
  telefone_normalizado text,
  razao_social text,
  nome_fantasia text,
  cidade text,
  estado text,
  cnae_codigo text,
  cnae_descricao text,
  situacao_cadastral text,
  porte_faturamento numeric(14,2),
  funcionarios int,
  capital_social numeric(14,2),
  data_abertura date,
  socios jsonb,
  site text,
  instagram text,
  linkedin text,
  enriquecido_em timestamptz,
  enriquecido_por text,
  enriquecimento_bruto jsonb,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS va_empresas_tel ON va_empresas (telefone_normalizado) WHERE telefone_normalizado IS NOT NULL;
CREATE INDEX IF NOT EXISTS va_empresas_cnpj ON va_empresas (cnpj) WHERE cnpj IS NOT NULL;
CREATE INDEX IF NOT EXISTS va_empresas_cidade ON va_empresas (cidade, estado);
CREATE INDEX IF NOT EXISTS va_empresas_cnae ON va_empresas (cnae_codigo) WHERE cnae_codigo IS NOT NULL;

-- 2) va_contatos.empresa_id ────────────────────────────────────────
ALTER TABLE va_contatos ADD COLUMN IF NOT EXISTS empresa_id uuid REFERENCES va_empresas(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS va_contatos_empresa ON va_contatos (empresa_id) WHERE empresa_id IS NOT NULL;

-- 3) MIGRAÇÃO: cria empresa a partir de contatos existentes ──────
-- Passo A: cria empresas únicas via cnpj (se houver)
INSERT INTO va_empresas (cnpj, telefone_normalizado, razao_social, nome_fantasia, cidade, estado)
SELECT DISTINCT ON (cnpj)
  cnpj,
  (array_agg(telefone_normalizado) FILTER (WHERE telefone_normalizado IS NOT NULL))[1],
  (array_agg(nome) FILTER (WHERE nome IS NOT NULL))[1],
  (array_agg(empresa) FILTER (WHERE empresa IS NOT NULL))[1],
  (array_agg(cidade) FILTER (WHERE cidade IS NOT NULL))[1],
  (array_agg(estado) FILTER (WHERE estado IS NOT NULL))[1]
FROM va_contatos
WHERE cnpj IS NOT NULL
GROUP BY cnpj
ON CONFLICT (cnpj) DO NOTHING;

-- Passo B: cria empresas via telefone_normalizado (sem cnpj)
INSERT INTO va_empresas (telefone_normalizado, razao_social, nome_fantasia, cidade, estado)
SELECT DISTINCT ON (telefone_normalizado)
  telefone_normalizado,
  (array_agg(nome) FILTER (WHERE nome IS NOT NULL))[1],
  (array_agg(empresa) FILTER (WHERE empresa IS NOT NULL))[1],
  (array_agg(cidade) FILTER (WHERE cidade IS NOT NULL))[1],
  (array_agg(estado) FILTER (WHERE estado IS NOT NULL))[1]
FROM va_contatos
WHERE telefone_normalizado IS NOT NULL
  AND (cnpj IS NULL OR NOT EXISTS (SELECT 1 FROM va_empresas WHERE cnpj = va_contatos.cnpj))
  AND NOT EXISTS (SELECT 1 FROM va_empresas WHERE telefone_normalizado = va_contatos.telefone_normalizado)
GROUP BY telefone_normalizado;

-- Passo C: vincula cada contato à sua empresa
UPDATE va_contatos c SET empresa_id = e.id
FROM va_empresas e
WHERE c.empresa_id IS NULL
  AND ((c.cnpj IS NOT NULL AND e.cnpj = c.cnpj)
       OR (c.cnpj IS NULL AND c.telefone_normalizado IS NOT NULL AND e.telefone_normalizado = c.telefone_normalizado));

-- 4) va_empresa_toques ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS va_empresa_toques (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES va_empresas(id) ON DELETE CASCADE,
  projeto_id uuid REFERENCES va_projetos(id) ON DELETE SET NULL,
  tipo text NOT NULL CHECK (tipo IN ('prospectada','abordada','respondeu','interessada','nda','negociou','oferta_servico')),
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS va_toques_empresa ON va_empresa_toques (empresa_id, criado_em DESC);

-- Trigger auto-toque baseado em mudança de estágio
CREATE OR REPLACE FUNCTION va_registrar_toque_estagio() RETURNS TRIGGER AS $$
DECLARE v_tipo text;
BEGIN
  IF NEW.empresa_id IS NULL THEN RETURN NEW; END IF;
  -- INSERT: sempre "prospectada"
  IF TG_OP = 'INSERT' THEN
    INSERT INTO va_empresa_toques (empresa_id, projeto_id, tipo)
    VALUES (NEW.empresa_id, NEW.projeto_id, 'prospectada');
    RETURN NEW;
  END IF;
  -- UPDATE: só se estágio mudou
  IF NEW.estagio IS DISTINCT FROM OLD.estagio THEN
    v_tipo := CASE NEW.estagio
      WHEN 'abordado'          THEN 'abordada'
      WHEN 'interesse_inicial' THEN 'respondeu'
      WHEN 'apresentado'       THEN 'interessada'
      WHEN 'nda_assinado'      THEN 'nda'
      WHEN 'em_negociacao'     THEN 'negociou'
      WHEN 'proposta'          THEN 'negociou'
      ELSE NULL
    END;
    IF v_tipo IS NOT NULL THEN
      INSERT INTO va_empresa_toques (empresa_id, projeto_id, tipo)
      VALUES (NEW.empresa_id, NEW.projeto_id, v_tipo);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS va_contatos_toque ON va_contatos;
CREATE TRIGGER va_contatos_toque
  AFTER INSERT OR UPDATE ON va_contatos
  FOR EACH ROW EXECUTE FUNCTION va_registrar_toque_estagio();

-- Backfill toques pros contatos existentes (só como 'prospectada')
INSERT INTO va_empresa_toques (empresa_id, projeto_id, tipo, criado_em)
SELECT empresa_id, projeto_id, 'prospectada', criado_em
FROM va_contatos
WHERE empresa_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM va_empresa_toques t WHERE t.empresa_id = va_contatos.empresa_id AND t.projeto_id = va_contatos.projeto_id);

-- 5) va_empresa_historico view ────────────────────────────────────
CREATE OR REPLACE VIEW va_empresa_historico AS
WITH tk AS (
  SELECT empresa_id,
         MAX(criado_em) AS ultimo_toque,
         COUNT(*) AS total_toques,
         bool_or(tipo = 'oferta_servico') AS ja_recebeu_oferta_servico
  FROM va_empresa_toques GROUP BY empresa_id
),
mst AS (
  SELECT empresa_id,
         COUNT(DISTINCT projeto_id) AS projetos_tocada,
         (array_agg(estagio ORDER BY (CASE estagio
            WHEN 'proposta' THEN 8 WHEN 'em_negociacao' THEN 7 WHEN 'nda_assinado' THEN 6
            WHEN 'apresentado' THEN 5 WHEN 'interesse_inicial' THEN 4 WHEN 'sem_interesse' THEN 3
            WHEN 'sem_resposta' THEN 3 WHEN 'abordado' THEN 2 WHEN 'novo' THEN 1
            WHEN 'fechado' THEN 9 WHEN 'perdido' THEN 0 ELSE 0 END) DESC))[1] AS maior_estagio_alcancado
  FROM va_contatos
  WHERE empresa_id IS NOT NULL
  GROUP BY empresa_id
)
SELECT
  e.id AS empresa_id,
  e.razao_social, e.nome_fantasia, e.cnpj,
  e.cidade, e.estado, e.cnae_codigo, e.cnae_descricao,
  e.porte_faturamento, e.funcionarios,
  e.enriquecido_em, e.enriquecido_por,
  COALESCE(mst.projetos_tocada, 0) AS projetos_tocada,
  tk.ultimo_toque,
  COALESCE(tk.total_toques, 0) AS total_toques,
  mst.maior_estagio_alcancado,
  COALESCE(tk.ja_recebeu_oferta_servico, false) AS ja_recebeu_oferta_servico
FROM va_empresas e
LEFT JOIN tk  ON tk.empresa_id  = e.id
LEFT JOIN mst ON mst.empresa_id = e.id;

-- 6) va_registrar_contato ATUALIZADA (resolve empresa antes) ─────
CREATE OR REPLACE FUNCTION va_registrar_contato(
  p_projeto uuid, p_nome text, p_telefone text, p_empresa text,
  p_cidade text, p_origem text, p_origem_detalhe text,
  p_arquetipo text, p_debitar boolean DEFAULT false
) RETURNS jsonb AS $$
DECLARE
  v_norm text; v_bl_id uuid; v_bl_motivo text; v_bl_nome text;
  v_exist_id uuid; v_exist_criado timestamptz; v_exist_estagio text;
  v_novo uuid; v_trilha text;
  v_empresa_id uuid; v_ja_enriquecida boolean := false;
  v_emp_row va_empresas%ROWTYPE;
BEGIN
  v_norm := va_normalizar_telefone(p_telefone);

  -- Blacklist gate (inalterado)
  IF v_norm IS NOT NULL THEN
    SELECT id, motivo, nome INTO v_bl_id, v_bl_motivo, v_bl_nome
    FROM va_projeto_blacklist
    WHERE projeto_id = p_projeto AND telefone IS NOT NULL
      AND (va_normalizar_telefone(telefone) = v_norm
           OR right(regexp_replace(telefone, '\D', '', 'g'), 10) = right(v_norm, 10))
    LIMIT 1;
    IF v_bl_id IS NOT NULL THEN
      RETURN jsonb_build_object('status','bloqueado','motivo', coalesce(v_bl_motivo,'sem motivo'), 'nome', coalesce(v_bl_nome,''));
    END IF;
  END IF;

  -- Dedup por projeto+tel (inalterado)
  IF v_norm IS NOT NULL THEN
    SELECT id, criado_em, estagio INTO v_exist_id, v_exist_criado, v_exist_estagio
    FROM va_contatos WHERE projeto_id = p_projeto AND telefone_normalizado = v_norm LIMIT 1;
    IF v_exist_id IS NOT NULL THEN
      INSERT INTO va_contato_interacoes (contato_id, projeto_id, tipo, conteudo, autor)
      VALUES (v_exist_id, p_projeto, 're_capturado', coalesce(p_origem_detalhe, p_origem, 'sem detalhe'), 'sistema');
      RETURN jsonb_build_object('status','duplicado','contato_id', v_exist_id, 'criado_em', v_exist_criado, 'estagio', v_exist_estagio);
    END IF;
  END IF;

  -- NOVO: resolve empresa via telefone (ou cria se não existir)
  IF v_norm IS NOT NULL THEN
    SELECT * INTO v_emp_row FROM va_empresas WHERE telefone_normalizado = v_norm LIMIT 1;
    IF v_emp_row.id IS NOT NULL THEN
      v_empresa_id := v_emp_row.id;
      v_ja_enriquecida := v_emp_row.enriquecido_em IS NOT NULL;
    ELSE
      INSERT INTO va_empresas (telefone_normalizado, razao_social, nome_fantasia, cidade)
      VALUES (v_norm, p_nome, p_empresa, p_cidade)
      RETURNING id INTO v_empresa_id;
      v_ja_enriquecida := false;
    END IF;
  END IF;

  v_trilha := CASE WHEN p_origem IN ('anuncio','organico') THEN 'quente' ELSE 'fria' END;

  INSERT INTO va_contatos (projeto_id, empresa_id, nome, telefone, empresa, cidade,
    origem, origem_detalhe, arquetipo_codigo, trilha, estagio,
    porte_faturamento, funcionarios, socios, enriquecido_em)
  VALUES (p_projeto, v_empresa_id, p_nome, p_telefone, p_empresa, p_cidade,
    p_origem, p_origem_detalhe, p_arquetipo, v_trilha, 'novo',
    v_emp_row.porte_faturamento, v_emp_row.funcionarios, v_emp_row.socios, v_emp_row.enriquecido_em)
  RETURNING id INTO v_novo;

  -- Prospecção sempre debita (custo de achar que ela serve pra este mandato)
  IF p_debitar THEN
    PERFORM va_debitar(p_projeto, 'lead_scrapper', 1,
      'Contato: ' || coalesce(p_nome, coalesce(p_empresa, 'sem nome'))
        || CASE WHEN p_origem_detalhe IS NOT NULL THEN ' · '||p_origem_detalhe ELSE '' END,
      NULL);
  END IF;

  RETURN jsonb_build_object(
    'status','criado',
    'contato_id', v_novo,
    'empresa_id', v_empresa_id,
    'trilha', v_trilha,
    'enriquecimento_reaproveitado', v_ja_enriquecida
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7) RLS ──────────────────────────────────────────────────────────
ALTER TABLE va_empresas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE va_empresa_toques ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS va_empresas_admin ON va_empresas;
DROP POLICY IF EXISTS va_toques_admin   ON va_empresa_toques;
CREATE POLICY va_empresas_admin ON va_empresas       FOR ALL TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
CREATE POLICY va_toques_admin   ON va_empresa_toques FOR ALL TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
