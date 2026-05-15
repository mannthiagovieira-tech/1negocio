-- Bloco SQL #8: Snapshot v2026.07 — P2 reduzido a 2 sub-métricas
-- (Frente 2.3 — co-commit com remoção de margem_estavel na skill)
--
-- Mudança vs v2026.06:
--   - Inativa v2026.06
--   - Insere v2026.07 derivado com p2_resultado reescrito:
--     v2026.06: ebitda_real:0.50, margem_estavel:0.30, rentabilidade_imobilizado:0.20
--     v2026.07: ebitda_real:0.50, rentabilidade_imobilizado:0.50
--
-- Razão: D.margem_estavel é fantasma (sem pergunta no diagnóstico). Proxy via
-- crescimento_pct foi considerado fraco demais (faturamento != margem). Skill
-- calcPilar2 reduzido a 2 sub-métricas no mesmo commit pra evitar estado
-- intermediário inconsistente (skill 2 entries vs snapshot 3 entries → soma
-- de pesos 0.70, score teto 7.0 em vez de 10).
--
-- Idempotência: se v2026.07 já existir, INSERT falha. Recriação exige DELETE
-- manual.

-- ============================================================
-- Step 1: inativa snapshot anterior
-- ============================================================
UPDATE parametros_versoes SET ativo = false WHERE id = 'v2026.06';

-- ============================================================
-- Step 2: insere v2026.07 derivado de v2026.06 + p2_resultado reescrito
-- ============================================================
INSERT INTO parametros_versoes (id, ativo, criado_por, snapshot)
SELECT
  'v2026.07',
  true,
  'thiago',
  jsonb_set(
    jsonb_set(snapshot, '{_meta}',
      $json${"versao":"v2026.07","criado_em":"2026-04-28","descricao":"P2 reduzido a 2 sub-métricas (margem_estavel removida — proxy fraco). 0.50/0.50 entre ebitda_real e rentabilidade_imobilizado.","derivado_de":"v2026.06"}$json$::jsonb,
      true),
    '{pesos_sub_metricas_ise,p2_resultado}',
    $json${"ebitda_real":0.50,"rentabilidade_imobilizado":0.50}$json$::jsonb,
    true)
FROM parametros_versoes
WHERE id = 'v2026.06';

-- ============================================================
-- Step 3: verificação
-- ============================================================
SELECT
  id, ativo,
  snapshot->'_meta' AS meta,
  snapshot->'pesos_sub_metricas_ise'->'p2_resultado' AS p2_pesos
FROM parametros_versoes
WHERE id = 'v2026.07';

SELECT id, ativo FROM parametros_versoes ORDER BY criado_em DESC;
