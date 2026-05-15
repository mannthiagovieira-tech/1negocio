-- Migration 015: Limpar dados fake antes da refatoração de anúncios
-- Mantém apenas: Padaria do Teste 01 + Trattoria del Lucca
--
-- ORDEM dos DELETEs importa: tabelas com FK NO ACTION (que bloqueiam)
-- precisam ser limpas ANTES da tabela referenciada.
--
-- PATCH A: deleta admin_agenda + logs_edge_functions (NO ACTION FK)
-- PATCH B: removido DELETE de diagnostico_sessoes (sem coluna negocio_id)

BEGIN;

-- ─────────────────────────────────────────────
-- PATCH A — pre-limpeza de tabelas com FK NO ACTION pra negocios
-- ─────────────────────────────────────────────

DELETE FROM admin_agenda
WHERE negocio_id NOT IN (
  'c07b2c50-10d2-456c-814d-4e140b66383b',
  '3b414cea-1049-4263-99b2-3401441e2bc9'
);

DELETE FROM logs_edge_functions
WHERE negocio_id IS NOT NULL
  AND negocio_id NOT IN (
    'c07b2c50-10d2-456c-814d-4e140b66383b',
    '3b414cea-1049-4263-99b2-3401441e2bc9'
  );

-- ─────────────────────────────────────────────
-- 1. anuncios (sem FK pra negocios — limpa tudo)
-- ─────────────────────────────────────────────
DELETE FROM anuncios;

-- ─────────────────────────────────────────────
-- 2. NDAs ANTES de negocios:
--    nda_assinaturas tem FK pra nda_solicitacoes E pra negocios (NO ACTION)
--    Ordem: nda_assinaturas → nda_solicitacoes
-- ─────────────────────────────────────────────
DELETE FROM nda_assinaturas
WHERE negocio_id NOT IN (
  'c07b2c50-10d2-456c-814d-4e140b66383b',
  '3b414cea-1049-4263-99b2-3401441e2bc9'
);

DELETE FROM nda_solicitacoes
WHERE negocio_id NOT IN (
  'c07b2c50-10d2-456c-814d-4e140b66383b',
  '3b414cea-1049-4263-99b2-3401441e2bc9'
);

-- ─────────────────────────────────────────────
-- 3. termos_adesao (sem FK formal — coluna negocio_id solta)
--    Inclui delete de órfãos com negocio_id NULL (NOT IN não pega NULL)
-- ─────────────────────────────────────────────
DELETE FROM termos_adesao
WHERE negocio_id IS NULL
   OR negocio_id NOT IN (
     'c07b2c50-10d2-456c-814d-4e140b66383b',
     '3b414cea-1049-4263-99b2-3401441e2bc9'
   );

-- ─────────────────────────────────────────────
-- 4. negocio_* (CASCADE — somem auto, mas explicit ok)
-- ─────────────────────────────────────────────
DELETE FROM negocio_views;
DELETE FROM negocio_cliques;
DELETE FROM negocio_eventos;
DELETE FROM negocio_dre;
DELETE FROM negocio_socios;
DELETE FROM negocio_colaboradores;
DELETE FROM negocio_fontes;
DELETE FROM negocio_pilares;

-- ─────────────────────────────────────────────
-- 5. laudos_completos (slug sem FK formal pra negocios)
-- ─────────────────────────────────────────────
DELETE FROM laudos_completos
WHERE slug NOT IN (
  'c07b2c50-10d2-456c-814d-4e140b66383b',
  '3b414cea-1049-4263-99b2-3401441e2bc9'
);

-- ─────────────────────────────────────────────
-- 6. laudos_v2 (NO ACTION — antes de negocios)
-- ─────────────────────────────────────────────
DELETE FROM laudos_v2
WHERE negocio_id NOT IN (
  'c07b2c50-10d2-456c-814d-4e140b66383b',
  '3b414cea-1049-4263-99b2-3401441e2bc9'
);

-- ─────────────────────────────────────────────
-- 7. negocios POR ÚLTIMO
-- ─────────────────────────────────────────────
DELETE FROM negocios
WHERE id NOT IN (
  'c07b2c50-10d2-456c-814d-4e140b66383b',
  '3b414cea-1049-4263-99b2-3401441e2bc9'
);

-- ─────────────────────────────────────────────
-- PATCH B: diagnostico_sessoes não tem coluna negocio_id (usa slug).
--          DELETE removido — não bloqueia, é tabela de telemetria de form.
-- ─────────────────────────────────────────────

COMMIT;
