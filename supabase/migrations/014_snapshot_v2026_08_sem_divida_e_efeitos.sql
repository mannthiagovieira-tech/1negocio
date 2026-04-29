-- Snapshot v2026.08:
--   1) Deriva de v2026.07
--   2) Remove upside pa_reestruturar_dividas do upsides_catalogo
--      (decisão Thiago: "reduza dívida" é truísmo, não é insight acionável)
--   3) Adiciona efeitos_por_categoria pra propagação no calc_json
--      (consumido por agregarPotencial12mV2 → upsides_ativos[i].efeito_explicacao)

INSERT INTO parametros_versoes (id, ativo, criado_em, snapshot, nota)
SELECT
  'v2026.08',
  false,
  now(),
  jsonb_set(
    jsonb_set(
      snapshot,
      '{upsides_catalogo}',
      (
        SELECT COALESCE(jsonb_agg(item), '[]'::jsonb)
        FROM jsonb_array_elements(snapshot->'upsides_catalogo') AS item
        WHERE item->>'id' != 'pa_reestruturar_dividas'
      )
    ),
    '{efeitos_por_categoria}',
    '{
      "ro": "Aumenta o RO mensal — caixa novo que × fator vira valor de venda",
      "passivo": "Reduz passivos do balanço — gera caixa novo e melhora o PL",
      "tributario": "Reduz carga tributária, gerando caixa novo mensal",
      "multiplo": "Reduz risco percebido — aumenta o múltiplo aplicado ao RO, sem caixa novo"
    }'::jsonb,
    true
  ),
  'Derivado de v2026.07: sem pa_reestruturar_dividas + efeitos_por_categoria'
FROM parametros_versoes
WHERE id = 'v2026.07';

-- Promover v2026.08 (desativar v2026.07, ativar v2026.08) — atomicamente
UPDATE parametros_versoes SET ativo = false WHERE id = 'v2026.07';
UPDATE parametros_versoes SET ativo = true,  promovido_em = now() WHERE id = 'v2026.08';
