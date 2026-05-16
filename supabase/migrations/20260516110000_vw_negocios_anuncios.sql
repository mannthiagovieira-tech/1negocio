-- v9.38.8 · view unificada negocios + anuncios_v2 + vendedor
-- Aplicada via MCP apply_migration em 2026-05-16
-- Adaptações ao schema real (vs. spec):
--   resultado_operacional_anual → ebitda_anual
--   ise_score → score_saude
-- Adiciona alias 'status' (sem sufixo) para retrocompat com código admin

CREATE OR REPLACE VIEW vw_negocios_anuncios AS
SELECT
  n.id,
  n.id AS negocio_id,
  n.vendedor_id,
  n.nome,
  n.titulo_anuncio,
  n.codigo AS codigo_negocio,
  n.status AS status_negocio,
  n.setor,
  n.cidade,
  n.estado,
  n.preco_pedido,
  n.valor_1n,
  n.faturamento_anual,
  n.ebitda_anual,
  n.score_saude,
  n.created_at,
  -- Dados do anúncio
  a.id AS anuncio_id,
  COALESCE(a.codigo, n.codigo, n.codigo_anuncio) AS codigo,
  COALESCE(a.titulo, n.titulo_anuncio, n.nome) AS titulo,
  COALESCE(a.descricao_card, n.descricao_geral) AS descricao,
  COALESCE(a.valor_pedido, n.preco_pedido) AS valor_pedido,
  COALESCE(a.status, n.status::text) AS status,
  COALESCE(a.status, n.status::text) AS status_anuncio,
  COALESCE(a.vendedor_id, n.vendedor_id) AS vendedor_id_anuncio,
  a.views_total,
  a.info_requests_total,
  a.shares_total,
  a.publicado_em,
  a.vendido_em,
  -- Vendedor
  u.nome AS vendedor_nome,
  u.whatsapp AS vendedor_whatsapp
FROM negocios n
LEFT JOIN anuncios_v2 a ON a.negocio_id = n.id
LEFT JOIN usuarios u ON u.id = COALESCE(a.vendedor_id, n.vendedor_id);

GRANT SELECT ON vw_negocios_anuncios TO anon, authenticated, service_role;
