-- va_empresas_sucessao · trocar regex substring por lista explícita RFB.
-- Antes: `(6[0-9]|7[0-9]|MAIOR|ACIMA)` casava "51 A 60" via substring "60".
-- Depois: IN ('61 A 70 ANOS','71 A 80 ANOS','MAIOR DE 80 ANOS').
CREATE OR REPLACE VIEW va_empresas_sucessao AS
WITH s AS (
  SELECT e.id AS empresa_id, e.razao_social, e.nome_fantasia, e.cnpj,
         jsonb_array_elements(e.socios) AS soc
  FROM va_empresas e
  WHERE e.socios IS NOT NULL AND jsonb_typeof(e.socios) = 'array'
),
sn AS (
  SELECT empresa_id, razao_social, nome_fantasia, cnpj,
         soc->>'nome_socio' AS nome,
         soc->>'qualificacao_socio' AS qualificacao,
         UPPER(TRIM(soc->>'faixa_etaria_socio')) AS faixa_etaria,
         NULLIF(soc->>'data_entrada_sociedade','')::date AS data_entrada
  FROM s
),
agg AS (
  SELECT empresa_id, razao_social, nome_fantasia, cnpj,
    COUNT(*) AS n_socios,
    bool_or(
      faixa_etaria IN ('61 A 70 ANOS','71 A 80 ANOS','MAIOR DE 80 ANOS')
      AND COALESCE(qualificacao,'') ~* '(ADMINISTRADOR|PRESIDENTE|DIRETOR|S[OÓ]CIO)'
    ) AS socio_admin_60mais,
    COALESCE(EXTRACT(YEAR FROM AGE(CURRENT_DATE, MIN(data_entrada)))::int, 0) AS anos_no_quadro_max,
    bool_or(
      faixa_etaria IN ('16 A 20 ANOS','21 A 30 ANOS','31 A 40 ANOS')
    ) AS tem_socio_jovem
  FROM sn
  GROUP BY empresa_id, razao_social, nome_fantasia, cnpj
)
SELECT *,
  GREATEST(0, LEAST(100,
    20
    + CASE WHEN socio_admin_60mais THEN 50 ELSE 0 END
    + CASE WHEN anos_no_quadro_max >= 15 THEN 30
           WHEN anos_no_quadro_max >= 10 THEN 15
           ELSE 0 END
    - CASE WHEN tem_socio_jovem THEN 20 ELSE 0 END
  )) AS score_sucessao
FROM agg;
