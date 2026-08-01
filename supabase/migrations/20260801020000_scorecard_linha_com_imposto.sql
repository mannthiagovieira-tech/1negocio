-- Scorecard por linha · imposto entra como linha própria
-- Antes: imposto ficava fora ("repasse"). Agora sai do caixa e conta.
-- Calculado como percent_imposto da versão vigente × receita_bruta do período.
CREATE OR REPLACE FUNCTION va_scorecard_linha(p_dias int DEFAULT 30, p_limite_desvio_pct numeric DEFAULT 20.0)
RETURNS TABLE(tipo text, rotulo text, qtd_total numeric, receita_total numeric, custo_realizado_total numeric,
  custo_medio_realizado numeric, custo_previsto_versao_vigente numeric, desvio_pct numeric, margem numeric, margem_pct numeric, alerta boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH v AS (SELECT id FROM va_precos_versao WHERE vigente=true LIMIT 1),
  cfg AS (SELECT c.* FROM va_precos_versao_config c JOIN v ON v.id=c.versao_id),
  parc AS (
    SELECT COALESCE(SUM(valor),0) AS receita_bruta
    FROM va_projeto_parcelas
    WHERE status='pago' AND pago_em >= CURRENT_DATE - p_dias
  ),
  imposto_row AS (
    SELECT 'imposto'::text AS tipo,
      'Imposto sobre receita'::text AS rotulo,
      NULL::numeric AS qtd_total,
      (SELECT receita_bruta FROM parc) AS receita_total,
      (SELECT receita_bruta FROM parc) * (SELECT percent_imposto/100 FROM cfg) AS custo_realizado_total,
      (SELECT percent_imposto FROM cfg) AS custo_medio_realizado,
      (SELECT percent_imposto FROM cfg) AS custo_previsto_versao_vigente,
      0::numeric AS desvio_pct,
      -((SELECT receita_bruta FROM parc) * (SELECT percent_imposto/100 FROM cfg))::numeric AS margem,
      -(SELECT percent_imposto FROM cfg)::numeric AS margem_pct,
      false AS alerta
    WHERE (SELECT receita_bruta FROM parc) > 0
  ),
  agg AS (
    SELECT r.tipo,
      SUM(r.quantidade) AS qtd_total,
      SUM(r.valor_total) AS receita_total,
      SUM(COALESCE(r.custo_unitario_aplicado,0) * r.quantidade) AS custo_realizado_total,
      CASE WHEN SUM(r.quantidade) > 0 THEN SUM(COALESCE(r.custo_unitario_aplicado,0)*r.quantidade) / SUM(r.quantidade) ELSE 0 END AS custo_medio_realizado
    FROM va_projeto_razao r
    WHERE r.data >= CURRENT_DATE - p_dias
    GROUP BY r.tipo
  ),
  linhas AS (
    SELECT a.tipo, COALESCE(p.rotulo, a.tipo) AS rotulo,
      a.qtd_total, a.receita_total, a.custo_realizado_total, a.custo_medio_realizado,
      COALESCE(p.custo_real, 0) AS custo_previsto_versao_vigente,
      CASE WHEN COALESCE(p.custo_real,0) > 0 THEN ROUND((a.custo_medio_realizado - p.custo_real)*100/p.custo_real, 2) ELSE NULL END AS desvio_pct,
      (a.receita_total - a.custo_realizado_total) AS margem,
      CASE WHEN a.receita_total > 0 THEN ROUND((a.receita_total - a.custo_realizado_total)*100/a.receita_total, 2) ELSE NULL END AS margem_pct,
      (COALESCE(p.custo_real,0) > 0 AND ABS(a.custo_medio_realizado - p.custo_real)*100/p.custo_real > p_limite_desvio_pct) AS alerta
    FROM agg a
    LEFT JOIN va_precos p ON p.tipo = a.tipo AND p.versao_id = (SELECT id FROM v)
  )
  SELECT * FROM imposto_row
  UNION ALL
  SELECT * FROM linhas
  ORDER BY receita_total DESC NULLS LAST;
$$;
GRANT EXECUTE ON FUNCTION va_scorecard_linha(int, numeric) TO authenticated, service_role;
