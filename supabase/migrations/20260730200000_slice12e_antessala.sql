-- ═══════════════════════════════════════════════════════════════════
-- SLICE 12e · antessala de qualificação + canais manuais + Maps
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS va_prospeccao_bruta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  arquetipo_codigo text,
  fonte text NOT NULL CHECK (fonte IN ('kipflow','maps','canal_manual','indicacao','importacao')),
  fonte_detalhe text,
  lote_id uuid,
  nome text, razao_social text, cnpj text,
  telefone text, telefone_normalizado text,
  email text, site text,
  cidade text, estado text, endereco text,
  porte_faturamento numeric(14,2), funcionarios int,
  socios jsonb, cnae text,
  enriquecido boolean NOT NULL DEFAULT false,
  payload_bruto jsonb,
  score int, motivos_falha text[],
  status text NOT NULL DEFAULT 'bruto'
    CHECK (status IN ('bruto','qualificado','enriquecido','aprovado','descartado','duplicado','bloqueado')),
  motivo_descarte text,
  triado_por text, triado_em timestamptz,
  contato_id uuid REFERENCES va_contatos(id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS va_prospeccao_bruta_status_idx ON va_prospeccao_bruta (projeto_id, status);
CREATE INDEX IF NOT EXISTS va_prospeccao_bruta_tel_idx ON va_prospeccao_bruta (projeto_id, telefone_normalizado);

CREATE TABLE IF NOT EXISTS va_projeto_canais_manuais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  arquetipo_codigo text,
  tipo text NOT NULL CHECK (tipo IN ('associacao','evento','grupo','influenciador','publicacao','outro')),
  nome text NOT NULL, url text, descricao text,
  periodicidade text, proxima_ocorrencia date,
  origem text NOT NULL DEFAULT 'ia',
  status text NOT NULL DEFAULT 'sugerido'
    CHECK (status IN ('sugerido','a_trabalhar','em_contato','produtivo','descartado')),
  observacao text, contatos_gerados int NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS va_projeto_canais_manuais_projeto_idx ON va_projeto_canais_manuais (projeto_id, status);

ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS criterios_qualificacao jsonb NOT NULL DEFAULT '{
  "exige_telefone": true, "exige_nome_ou_razao": true, "exige_cidade": true,
  "exige_cnpj": false, "exige_porte_conhecido": false,
  "faixa_porte_min": null, "faixa_porte_max": null, "score_minimo": 50
}'::jsonb;

INSERT INTO va_precos (tipo, rotulo, unidade, preco, custo_real, fornecedor, ativo, ordem)
VALUES ('lead_maps', 'Lead do Google Maps (Apify)', 'lead', 0.01, 0.005, 'apify', true, 45)
ON CONFLICT (tipo) DO UPDATE SET rotulo=EXCLUDED.rotulo, unidade=EXCLUDED.unidade,
  preco=EXCLUDED.preco, custo_real=EXCLUDED.custo_real, fornecedor=EXCLUDED.fornecedor, ativo=true;

-- va_qualificar_prospeccao: calcula score + status (versão final c/ nome_ou_razao + dup antessala)
CREATE OR REPLACE FUNCTION va_qualificar_prospeccao(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE
  b record; crit jsonb; motivos text[] := ARRAY[]::text[]; v_score int := 0;
  novo_status text := 'qualificado'; motivo_desc text := NULL;
  dup boolean; dup_ant boolean; bloq boolean; tem_whats boolean := false;
BEGIN
  SELECT * INTO b FROM va_prospeccao_bruta WHERE id = p_id;
  IF b IS NULL THEN RETURN jsonb_build_object('erro','não encontrado'); END IF;
  SELECT criterios_qualificacao INTO crit FROM va_projetos WHERE id = b.projeto_id;
  IF crit IS NULL THEN crit := '{}'::jsonb; END IF;
  IF (crit->>'exige_telefone')::boolean IS DISTINCT FROM false AND COALESCE(b.telefone_normalizado,'') = '' THEN
    motivos := array_append(motivos, 'sem_telefone'); END IF;
  IF (crit->>'exige_nome_ou_razao')::boolean IS DISTINCT FROM false
     AND COALESCE(b.nome,'') = '' AND COALESCE(b.razao_social,'') = '' THEN
    motivos := array_append(motivos, 'sem_nome_nem_razao'); END IF;
  IF (crit->>'exige_cidade')::boolean IS DISTINCT FROM false AND COALESCE(b.cidade,'') = '' THEN
    motivos := array_append(motivos, 'sem_cidade'); END IF;
  IF (crit->>'exige_cnpj')::boolean = true AND COALESCE(b.cnpj,'') = '' THEN
    motivos := array_append(motivos, 'sem_cnpj'); END IF;
  IF (crit->>'exige_porte_conhecido')::boolean = true AND b.porte_faturamento IS NULL THEN
    motivos := array_append(motivos, 'sem_porte'); END IF;
  IF b.telefone_normalizado IS NOT NULL AND b.telefone_normalizado <> '' THEN
    SELECT EXISTS(SELECT 1 FROM va_contatos WHERE projeto_id = b.projeto_id AND telefone_normalizado = b.telefone_normalizado) INTO dup;
    IF dup THEN novo_status := 'duplicado'; motivo_desc := 'telefone já no kanban'; END IF;
  END IF;
  IF novo_status = 'qualificado' THEN
    SELECT EXISTS(
      SELECT 1 FROM va_prospeccao_bruta WHERE projeto_id = b.projeto_id AND id <> b.id
        AND status IN ('qualificado','enriquecido','aprovado')
        AND ( (b.telefone_normalizado IS NOT NULL AND b.telefone_normalizado <> '' AND telefone_normalizado = b.telefone_normalizado)
           OR (b.cnpj IS NOT NULL AND b.cnpj <> '' AND cnpj = b.cnpj) )
    ) INTO dup_ant;
    IF dup_ant THEN novo_status := 'duplicado'; motivo_desc := 'já existe na antessala'; END IF;
  END IF;
  IF novo_status = 'qualificado' THEN
    SELECT EXISTS(
      SELECT 1 FROM va_projeto_blacklist WHERE projeto_id = b.projeto_id
        AND ((telefone IS NOT NULL AND telefone = b.telefone) OR (cnpj IS NOT NULL AND cnpj = b.cnpj))
    ) INTO bloq;
    IF bloq THEN novo_status := 'bloqueado'; motivo_desc := 'blacklist'; END IF;
  END IF;
  IF b.telefone_normalizado IS NOT NULL AND b.telefone_normalizado <> '' THEN
    tem_whats := (b.payload_bruto->>'whatsapp') IN ('true','TRUE','sim');
    v_score := v_score + (CASE WHEN tem_whats THEN 30 ELSE 10 END);
  END IF;
  IF COALESCE(b.nome,'') <> '' OR COALESCE(b.razao_social,'') <> '' THEN v_score := v_score + 20; END IF;
  IF b.porte_faturamento IS NOT NULL
     AND ( (crit->>'faixa_porte_min') IS NULL OR b.porte_faturamento >= (crit->>'faixa_porte_min')::numeric )
     AND ( (crit->>'faixa_porte_max') IS NULL OR b.porte_faturamento <= (crit->>'faixa_porte_max')::numeric ) THEN
    v_score := v_score + 20; END IF;
  IF COALESCE(b.cnpj,'') <> '' THEN v_score := v_score + 15; END IF;
  IF COALESCE(b.site,'') <> '' OR COALESCE(b.email,'') <> '' THEN v_score := v_score + 10; END IF;
  IF b.fonte = 'maps' AND (b.payload_bruto->>'avaliacao')::numeric IS NOT NULL
     AND (b.payload_bruto->>'avaliacao')::numeric >= 4.0 THEN v_score := v_score + 5; END IF;
  IF array_length(motivos, 1) > 0 THEN
    novo_status := 'descartado'; motivo_desc := array_to_string(motivos, ', ');
  ELSIF novo_status = 'qualificado' AND v_score < COALESCE((crit->>'score_minimo')::int, 50) THEN
    novo_status := 'descartado';
    motivo_desc := 'score abaixo do mínimo (' || v_score || '<' || COALESCE(crit->>'score_minimo','50') || ')';
    motivos := array_append(motivos, 'score_baixo');
  END IF;
  UPDATE va_prospeccao_bruta
  SET score = v_score, motivos_falha = CASE WHEN array_length(motivos,1) > 0 THEN motivos ELSE NULL END,
      status = novo_status, motivo_descarte = motivo_desc, triado_em = now()
  WHERE id = p_id;
  RETURN jsonb_build_object('score', v_score, 'status', novo_status, 'motivos', motivos, 'motivo_descarte', motivo_desc);
END; $$;
GRANT EXECUTE ON FUNCTION va_qualificar_prospeccao(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION va_promover_prospeccao_para_contato(p_id uuid, p_arquetipo text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE b record; v_contato_id uuid; v_empresa_id uuid;
BEGIN
  SELECT * INTO b FROM va_prospeccao_bruta WHERE id = p_id;
  IF b IS NULL THEN RAISE EXCEPTION 'prospeccao_bruta % não encontrada', p_id; END IF;
  IF b.status IN ('descartado','duplicado','bloqueado') THEN
    RAISE EXCEPTION 'prospeccao com status % não pode ser promovida', b.status;
  END IF;
  IF COALESCE(b.cnpj,'') <> '' THEN
    SELECT id INTO v_empresa_id FROM va_empresas WHERE cnpj = b.cnpj;
    IF v_empresa_id IS NULL THEN
      INSERT INTO va_empresas (cnpj, razao_social, cidade, estado, socios, porte_faturamento)
      VALUES (b.cnpj, b.razao_social, b.cidade, b.estado, b.socios, b.porte_faturamento)
      RETURNING id INTO v_empresa_id;
    END IF;
  END IF;
  INSERT INTO va_contatos (
    projeto_id, empresa_id, cnpj, nome, empresa, telefone, telefone_normalizado,
    email, cidade, estado, arquetipo_codigo, origem, origem_detalhe,
    porte_faturamento, socios, trilha, estagio
  ) VALUES (
    b.projeto_id, v_empresa_id, b.cnpj, b.nome, b.razao_social, b.telefone, b.telefone_normalizado,
    b.email, b.cidade, b.estado, COALESCE(p_arquetipo, b.arquetipo_codigo),
    'prospeccao', 'triagem · '||b.fonte||' · '||COALESCE(b.fonte_detalhe,''),
    b.porte_faturamento, b.socios, 'fria', 'novo'
  ) RETURNING id INTO v_contato_id;
  UPDATE va_prospeccao_bruta SET status='aprovado', contato_id=v_contato_id, triado_em=now() WHERE id=p_id;
  RETURN v_contato_id;
END; $$;
GRANT EXECUTE ON FUNCTION va_promover_prospeccao_para_contato(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE VIEW va_projeto_fonte_desempenho AS
WITH base AS (
  SELECT projeto_id, fonte,
    COUNT(*) AS trazidos,
    COUNT(*) FILTER (WHERE status IN ('qualificado','enriquecido','aprovado')) AS qualificados,
    COUNT(*) FILTER (WHERE status='aprovado') AS aprovados
  FROM va_prospeccao_bruta GROUP BY projeto_id, fonte
), custo AS (
  SELECT projeto_id,
    SUM(CASE WHEN tipo IN ('similares_import','lead_scrapper','similares_preview') THEN valor_total ELSE 0 END) AS custo_kipflow,
    SUM(CASE WHEN tipo = 'lead_maps' THEN valor_total ELSE 0 END) AS custo_maps
  FROM va_projeto_razao GROUP BY projeto_id
)
SELECT b.projeto_id, b.fonte, b.trazidos, b.qualificados, b.aprovados,
  CASE WHEN b.trazidos > 0 THEN ROUND(b.aprovados::numeric / b.trazidos * 100, 1) ELSE 0 END AS taxa_aproveitamento_pct,
  CASE WHEN b.fonte='kipflow' THEN COALESCE(c.custo_kipflow, 0)
       WHEN b.fonte='maps'    THEN COALESCE(c.custo_maps, 0)
       ELSE 0 END AS custo_total,
  CASE WHEN b.aprovados > 0 AND b.fonte IN ('kipflow','maps')
       THEN ROUND(CASE WHEN b.fonte='kipflow' THEN COALESCE(c.custo_kipflow,0) ELSE COALESCE(c.custo_maps,0) END / b.aprovados, 2)
       ELSE NULL END AS custo_por_aprovado
FROM base b LEFT JOIN custo c ON c.projeto_id = b.projeto_id;
