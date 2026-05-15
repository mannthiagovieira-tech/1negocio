-- Bloco SQL #7: Snapshot v2026.06 — ajuste de sub-métricas do ISE pós-busca de campos
-- (Fase 3 pós-busca b174152)
--
-- Mudanças vs v2026.05:
--   1. Inativa v2026.05
--   2. Insere v2026.06 derivado de v2026.05 com:
--      - _meta atualizado
--      - pesos_sub_metricas_ise reestruturado:
--        * P6: renomeia 2 sub-métricas (semântica mais precisa)
--          - "sem_passivo_trabalhista" → "passivos_juridicos"
--          - "impostos_em_dia"         → "impostos_atrasados_volume"
--        * P8: REATIVA presenca_digital (3 sub-métricas, 1/3 cada)
--          - 50/50 marca_inpi+reputacao → 1/3 marca_inpi+reputacao+presenca_digital
--      - P1, P2, P3, P4, P5, P7: pesos inalterados
--
-- Razão: a busca de campos (commit b174152) confirmou que D.online (presença
-- digital) e D.juridico_tipo (passivos jurídicos detalhados) EXISTEM no
-- diagnóstico — sub-métricas que pareciam fantasmas ganham proxy real.
-- A skill ainda lê os pesos hardcoded inline; commit posterior migra leitura
-- pra P.pesos_sub_metricas_ise.
--
-- Idempotência: se v2026.06 já existir, este script falha no INSERT.

-- ============================================================
-- Step 1: inativa snapshot anterior
-- ============================================================
UPDATE parametros_versoes SET ativo = false WHERE id = 'v2026.05';

-- ============================================================
-- Step 2: insere v2026.06 derivado de v2026.05 + ajustes do refactor
-- ============================================================
INSERT INTO parametros_versoes (id, ativo, criado_por, snapshot)
SELECT
  'v2026.06',
  true,
  'thiago',
  jsonb_set(snapshot, '{_meta}',
    $json${"versao":"v2026.06","criado_em":"2026-04-28","descricao":"Reestrutura pesos_sub_metricas_ise: P6 renomeada (semântica jurídica) + P8 reativa presenca_digital com proxy via D.online (busca b174152)","derivado_de":"v2026.05"}$json$::jsonb,
    true)
  -- ── pesos_sub_metricas_ise reescrito ──
  --
  -- P6: 4 sub-métricas com 0.25 cada (mantém soma=1) — chaves renomeadas
  --   - passivos_juridicos: combinação de D.processos_juridicos + D.juridico_tipo + D.passivo_juridico
  --   - sem_acao_judicial:  mantida (mesmo conceito; já consume D.processos_juridicos)
  --   - sem_impostos_atrasados: mantida (continua usando D.impostos_atrasados volume)
  --   - impostos_atrasados_volume: substitui "impostos_em_dia" (avalia volume vs faturamento)
  --
  -- P8: 3 sub-métricas com 1/3 cada (REATIVA presenca_digital)
  --   v2026.05 tinha 50/50 marca_inpi+reputacao. Com D.online disponível no diag,
  --   presença digital volta. O último (presenca_digital) cobre erro de arredondamento
  --   pra somar exatamente 1.0.
  || $json${"pesos_sub_metricas_ise":{
       "p1_financeiro":{"margem_op_pct":0.25,"dre_separacao":0.25,"fluxo_caixa_positivo":0.25,"contabilidade_formal":0.25},
       "p2_resultado":{"ebitda_real":0.50,"margem_estavel":0.30,"rentabilidade_imobilizado":0.20},
       "p3_comercial":{"num_clientes":0.25,"recorrencia_pct":0.25,"concentracao_pct":0.25,"base_clientes_documentada":0.25},
       "p4_gestao":{"processos_documentados":0.333333,"tem_gestor":0.333333,"sistemas_implantados":0.333334},
       "p5_socio_dependencia":{"opera_sem_dono":0.333333,"equipe_permanece":0.333333,"prolabore_documentado":0.333334},
       "p6_risco_legal":{"passivos_juridicos":0.25,"sem_acao_judicial":0.25,"impostos_atrasados_volume":0.25,"sem_impostos_atrasados":0.25},
       "p7_balanco":{"patrimonio_positivo":0.333333,"liquidez":0.333333,"ncg_saudavel":0.333334},
       "p8_marca":{"marca_inpi":0.333333,"reputacao":0.333333,"presenca_digital":0.333334}
     }}$json$::jsonb
FROM parametros_versoes
WHERE id = 'v2026.05';

-- ============================================================
-- Step 3: verificação
-- ============================================================
SELECT
  id,
  ativo,
  jsonb_array_length(snapshot->'upsides_catalogo') AS qtd_upsides,
  snapshot->'_meta' AS meta
FROM parametros_versoes
WHERE id = 'v2026.06';

SELECT
  id, ativo,
  snapshot->'pesos_sub_metricas_ise'->'p6_risco_legal' AS p6,
  snapshot->'pesos_sub_metricas_ise'->'p8_marca' AS p8
FROM parametros_versoes
WHERE id = 'v2026.06';

SELECT id, ativo FROM parametros_versoes ORDER BY criado_em DESC;
