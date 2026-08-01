-- Colunas de pagamento no projeto + comissão projetada usa MAIOR entre
-- investido acumulado e orçamento contratado da onda (evita "R$ 0 investido"
-- em cadastro novo mostrando comissão inflada).

ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS forma_pagamento text;
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS dia_vencimento int;
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS observacao_cobranca text;

DROP VIEW IF EXISTS va_carteira_cockpit CASCADE;
DROP VIEW IF EXISTS va_carteira_resumo CASCADE;

CREATE VIEW va_carteira_resumo AS
WITH ondas_ativas AS (
  SELECT DISTINCT ON (o.projeto_id) o.projeto_id,
    o.id AS onda_id, o.numero, o.status, o.data_fim,
    o.valor_mensal, o.comissao_percent, o.meses, o.dias_pausados
  FROM va_projeto_ondas o ORDER BY o.projeto_id, o.numero DESC
),
razao_agg AS (
  SELECT projeto_id,
    (sum(valor_total) FILTER (WHERE data >= date_trunc('month', CURRENT_DATE::timestamptz)))::numeric(14,2) AS gasto_mes,
    (sum(valor_total))::numeric(14,2) AS gasto_total
  FROM va_projeto_razao GROUP BY projeto_id
),
parcelas_pagas AS (
  SELECT projeto_id,
    COALESCE(SUM(valor) FILTER (WHERE status = 'pago'), 0)::numeric(14,2) AS investido_cliente
  FROM va_projeto_parcelas GROUP BY projeto_id
),
kpis AS (
  SELECT c.projeto_id,
    count(*) FILTER (WHERE c.estagio = 'em_negociacao') AS em_negociacao,
    count(*) FILTER (WHERE c.estagio = 'nda_assinado') AS ndas,
    count(*) FILTER (WHERE c.estagio = 'proposta') AS propostas,
    count(*) FILTER (WHERE c.estagio IN ('interesse_inicial','apresentado')) AS interessados
  FROM va_contatos c GROUP BY c.projeto_id
),
fila AS (
  SELECT projeto_id, count(*) FILTER (WHERE status = 'qualificado') AS qualificados_fila
  FROM va_prospeccao_bruta GROUP BY projeto_id
),
parcelas_venc AS (
  SELECT projeto_id, min(vencimento) AS proxima_venc,
    count(*) FILTER (WHERE status='pendente' AND vencimento <= CURRENT_DATE + 7) AS pendentes_prox
  FROM va_projeto_parcelas GROUP BY projeto_id
)
SELECT p.id AS projeto_id,
  p.cliente_nome, p.negocio_titulo, p.cidade, p.uf, p.status, p.valor_venda,
  o.onda_id, o.numero AS onda_numero, o.status AS onda_status, o.data_fim AS onda_fim,
  o.valor_mensal, o.comissao_percent, o.meses, o.dias_pausados,
  GREATEST(0, (o.data_fim - CURRENT_DATE)) AS dias_restantes,
  ((o.valor_mensal * o.meses::numeric))::numeric(14,2) AS orcamento_onda,
  COALESCE(ra.gasto_mes, 0) AS gasto_mes,
  COALESCE(ra.gasto_total, 0) AS gasto_total,
  (((o.valor_mensal * o.meses::numeric) - COALESCE(ra.gasto_total, 0)))::numeric(14,2) AS saldo_onda,
  COALESCE(pp.investido_cliente, 0)::numeric(14,2) AS investido_cliente,
  ((COALESCE(p.valor_venda, 0) * COALESCE(o.comissao_percent, 0) / 100))::numeric(14,2) AS taxa_sucesso_bruta,
  ((COALESCE(p.valor_venda, 0) * COALESCE(o.comissao_percent, 0) / 100)
    - GREATEST(COALESCE(pp.investido_cliente, 0), COALESCE(o.valor_mensal * o.meses, 0)))::numeric(14,2) AS comissao_liquida_projetada,
  GREATEST(COALESCE(pp.investido_cliente, 0), COALESCE(o.valor_mensal * o.meses, 0))::numeric(14,2) AS base_deducao,
  COALESCE(k.em_negociacao, 0) AS em_negociacao,
  COALESCE(k.ndas, 0) AS ndas_assinados,
  COALESCE(k.propostas, 0) AS propostas,
  COALESCE(k.interessados, 0) AS interessados,
  COALESCE(f.qualificados_fila, 0) AS qualificados_fila,
  pv.proxima_venc,
  COALESCE(pv.pendentes_prox, 0) AS parcelas_venc_prox
FROM va_projetos p
LEFT JOIN ondas_ativas o ON o.projeto_id = p.id
LEFT JOIN razao_agg ra ON ra.projeto_id = p.id
LEFT JOIN parcelas_pagas pp ON pp.projeto_id = p.id
LEFT JOIN kpis k ON k.projeto_id = p.id
LEFT JOIN fila f ON f.projeto_id = p.id
LEFT JOIN parcelas_venc pv ON pv.projeto_id = p.id;

GRANT SELECT ON va_carteira_resumo TO authenticated, service_role;

CREATE VIEW va_carteira_cockpit AS
SELECT
  count(*) FILTER (WHERE onda_status = 'ativa') AS mandatos_ativos,
  count(*) FILTER (WHERE em_negociacao > 0) AS mandatos_em_negociacao,
  count(*) FILTER (WHERE propostas > 0) AS mandatos_com_proposta,
  count(*) FILTER (WHERE onda_status = 'ativa' AND dias_restantes <= 15 AND dias_restantes >= 0) AS renovacoes_15d,
  sum(valor_mensal) FILTER (WHERE onda_status = 'ativa') AS receita_recorrente_ativa,
  sum(orcamento_onda) FILTER (WHERE onda_status = 'ativa') AS orcamento_ativo,
  sum(gasto_total) FILTER (WHERE onda_status = 'ativa') AS gasto_ativo,
  sum(orcamento_onda - gasto_total) FILTER (WHERE onda_status = 'ativa') AS saldo_ativo,
  sum(comissao_liquida_projetada) FILTER (WHERE onda_status = 'ativa') AS comissao_liq_projetada,
  sum(taxa_sucesso_bruta) FILTER (WHERE onda_status = 'ativa') AS taxa_sucesso_bruta_total,
  sum(base_deducao) FILTER (WHERE onda_status = 'ativa') AS base_deducao_total,
  sum(investido_cliente) FILTER (WHERE onda_status = 'ativa') AS investido_cliente_total,
  sum(valor_mensal) FILTER (WHERE onda_status = 'ativa' AND dias_restantes <= 15 AND dias_restantes >= 0) AS valor_renovacoes_15d
FROM va_carteira_resumo;

GRANT SELECT ON va_carteira_cockpit TO authenticated, service_role;
