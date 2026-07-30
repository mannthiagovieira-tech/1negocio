-- ═══════════════════════════════════════════════════════════════════
-- SLICE 11 · custo real, margem e fornecedor por linha do razão
-- ═══════════════════════════════════════════════════════════════════

-- 1) va_precos: coluna fornecedor + backfill por tipo ─────────────
ALTER TABLE va_precos ADD COLUMN IF NOT EXISTS fornecedor text;

UPDATE va_precos SET fornecedor = CASE tipo
  WHEN 'lead_scrapper'          THEN 'kipflow'
  WHEN 'disparo_whatsapp'       THEN 'zapi'
  WHEN 'midia_meta'             THEN 'meta'
  WHEN 'teaser'                 THEN 'anthropic'
  WHEN 'criativo_estatico'      THEN 'canva'
  WHEN 'criativo_video'         THEN 'canva'
  WHEN 'nda_gerado'             THEN 'interno'
  WHEN 'gestao_mensal'          THEN 'interno'
  WHEN 'matchmaking'            THEN 'interno'
  WHEN 'avaliacao_guiada'       THEN 'interno'
  WHEN 'laudo'                  THEN 'interno'
  WHEN 'setup_arquetipos'       THEN 'interno'
  WHEN 'setup_campanha'         THEN 'interno'
  WHEN 'distribuicao_parceiros' THEN 'interno'
  WHEN 'ajuste_manual'          THEN 'interno'
  ELSE 'interno'
END
WHERE fornecedor IS NULL;

-- Note: custo_real de lead_scrapper já foi setado (0.39) no turno Kipflow.

-- 2) va_projeto_razao: colunas custo_unitario_aplicado + fornecedor ─
ALTER TABLE va_projeto_razao ADD COLUMN IF NOT EXISTS custo_unitario_aplicado numeric(10,2);
ALTER TABLE va_projeto_razao ADD COLUMN IF NOT EXISTS fornecedor text;

-- 3) va_debitar: gravar custo + fornecedor congelados ─────────────
CREATE OR REPLACE FUNCTION va_debitar(
  p_projeto uuid, p_tipo text, p_qtd numeric,
  p_referencia text, p_ciclo int DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
  v_preco numeric; v_custo numeric; v_fornecedor text;
  v_total numeric; v_ciclo int;
  v_data_inicio date; v_id uuid; v_meses numeric;
BEGIN
  SELECT preco, custo_real, fornecedor INTO v_preco, v_custo, v_fornecedor
  FROM va_precos WHERE tipo = p_tipo AND ativo = true;
  IF v_preco IS NULL THEN
    RAISE EXCEPTION 'tipo % não encontrado ou inativo em va_precos', p_tipo;
  END IF;
  v_total := p_qtd * v_preco;
  IF p_ciclo IS NULL THEN
    SELECT data_inicio INTO v_data_inicio FROM va_projetos WHERE id = p_projeto;
    IF v_data_inicio IS NULL THEN RAISE EXCEPTION 'projeto % não encontrado', p_projeto; END IF;
    v_meses := GREATEST((CURRENT_DATE - v_data_inicio)::numeric / 30.0, 0);
    v_ciclo := floor(v_meses)::int + 1;
  ELSE
    v_ciclo := p_ciclo;
  END IF;
  INSERT INTO va_projeto_razao
    (projeto_id, tipo, quantidade, preco_unitario_aplicado, custo_unitario_aplicado,
     fornecedor, valor_total, referencia, ciclo_numero, data)
  VALUES
    (p_projeto, p_tipo, p_qtd, v_preco, v_custo, v_fornecedor,
     v_total, p_referencia, v_ciclo, CURRENT_DATE)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- 4) Backfill retroativo de custo/fornecedor nas linhas existentes ─
UPDATE va_projeto_razao r SET
  custo_unitario_aplicado = p.custo_real,
  fornecedor = p.fornecedor
FROM va_precos p
WHERE r.tipo = p.tipo AND (r.custo_unitario_aplicado IS NULL OR r.fornecedor IS NULL);

-- 5) VIEW va_projeto_custo_fornecedor ─────────────────────────────
CREATE OR REPLACE VIEW va_projeto_custo_fornecedor AS
SELECT
  projeto_id,
  COALESCE(fornecedor,'desconhecido') AS fornecedor,
  COUNT(*) AS linhas,
  SUM(valor_total)::numeric(14,2) AS cobrado,
  SUM(quantidade * COALESCE(custo_unitario_aplicado, 0))::numeric(14,2) AS custo_real_total,
  (SUM(valor_total) - SUM(quantidade * COALESCE(custo_unitario_aplicado, 0)))::numeric(14,2) AS margem_rs,
  CASE WHEN SUM(valor_total) > 0
       THEN ROUND(((SUM(valor_total) - SUM(quantidade * COALESCE(custo_unitario_aplicado, 0))) / SUM(valor_total) * 100)::numeric, 1)
       END AS margem_pct
FROM va_projeto_razao
GROUP BY projeto_id, COALESCE(fornecedor,'desconhecido');

-- 6) VIEW va_projeto_margem ───────────────────────────────────────
CREATE OR REPLACE VIEW va_projeto_margem AS
WITH cf AS (
  SELECT projeto_id,
         SUM(quantidade * COALESCE(custo_unitario_aplicado, 0)) AS custo_real_total,
         SUM(valor_total) AS cobrado
  FROM va_projeto_razao GROUP BY projeto_id
)
SELECT
  f.projeto_id,
  f.total_pago::numeric(14,2) AS receita,
  (f.total_pago * 0.2)::numeric(14,2) AS apropriacao_impostos,
  (f.total_pago * 0.3)::numeric(14,2) AS apropriacao_gestao,
  COALESCE(cf.cobrado, 0)::numeric(14,2) AS cobrado,
  COALESCE(cf.custo_real_total, 0)::numeric(14,2) AS custo_real_total,
  (COALESCE(cf.cobrado, 0) - COALESCE(cf.custo_real_total, 0))::numeric(14,2) AS margem_rs,
  CASE WHEN COALESCE(cf.cobrado, 0) > 0
       THEN ROUND(((COALESCE(cf.cobrado, 0) - COALESCE(cf.custo_real_total, 0)) / cf.cobrado * 100)::numeric, 1)
       END AS margem_pct
FROM va_projeto_financeiro f
LEFT JOIN cf ON cf.projeto_id = f.projeto_id;

-- 7) va_empresas_sucessao · score de sucessão sem sucessor ────────
CREATE OR REPLACE VIEW va_empresas_sucessao AS
WITH s AS (
  SELECT e.id AS empresa_id,
         e.razao_social,
         e.nome_fantasia,
         e.cnpj,
         jsonb_array_elements(e.socios) AS soc
  FROM va_empresas e
  WHERE e.socios IS NOT NULL AND jsonb_typeof(e.socios) = 'array'
),
sn AS (
  SELECT empresa_id, razao_social, nome_fantasia, cnpj,
         soc->>'nome_socio' AS nome,
         soc->>'qualificacao_socio' AS qualificacao,
         soc->>'faixa_etaria_socio' AS faixa_etaria,
         NULLIF(soc->>'data_entrada_sociedade','')::date AS data_entrada
  FROM s
),
agg AS (
  SELECT empresa_id, razao_social, nome_fantasia, cnpj,
    COUNT(*) AS n_socios,
    -- sócio administrador (presidente/diretor/administrador/sócio) com 60+
    bool_or(
      COALESCE(faixa_etaria,'') ~ '(6[0-9]|7[0-9]|MAIOR|ACIMA)'
      AND COALESCE(qualificacao,'') ~* '(ADMINISTRADOR|PRESIDENTE|DIRETOR|S[OÓ]CIO)'
    ) AS socio_admin_60mais,
    -- max anos no quadro (menor data_entrada = mais antigo)
    COALESCE(EXTRACT(YEAR FROM AGE(CURRENT_DATE, MIN(data_entrada)))::int, 0) AS anos_no_quadro_max,
    -- tem sócio jovem (<40) — sinal de sucessão em curso
    bool_or(
      COALESCE(faixa_etaria,'') ~ '((1[6-9]|2[0-9]|3[0-9])\s*A|ATÉ\s*30|ATE\s*30)'
    ) AS tem_socio_jovem
  FROM sn
  GROUP BY empresa_id, razao_social, nome_fantasia, cnpj
)
SELECT *,
  -- Score 0-100 baseline 20; admin 60+ = +50; antigo (15+ anos) = +30; jovem no quadro = -20
  GREATEST(0, LEAST(100,
    20
    + CASE WHEN socio_admin_60mais THEN 50 ELSE 0 END
    + CASE WHEN anos_no_quadro_max >= 15 THEN 30
           WHEN anos_no_quadro_max >= 10 THEN 15
           ELSE 0 END
    - CASE WHEN tem_socio_jovem THEN 20 ELSE 0 END
  )) AS score_sucessao
FROM agg;
