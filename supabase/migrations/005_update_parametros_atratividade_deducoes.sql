-- Bloco SQL #5: Atualiza snapshot v2026.04 já existente em parametros_versoes
-- Decisão: faixas_atratividade renomeadas (5 níveis) + benchmarks_dre.deducoes por setor
-- Idempotente: sobrescreve as duas chaves do snapshot via jsonb_set.

UPDATE parametros_versoes
SET snapshot = jsonb_set(
  jsonb_set(
    snapshot,
    '{faixas_atratividade}',
    '[{"min":90,"max":100,"label":"Alta"},{"min":75,"max":89,"label":"Atrativa"},{"min":60,"max":74,"label":"Padrão"},{"min":45,"max":59,"label":"Limitada"},{"min":0,"max":44,"label":"Baixa"}]'::jsonb,
    true
  ),
  '{benchmarks_dre}',
  '{"servicos_empresas":{"cmv":5,"folha":35,"aluguel":5,"outros_cf":8,"mkt":3,"margem_op":30,"deducoes":12},"educacao":{"cmv":5,"folha":38,"aluguel":8,"outros_cf":8,"mkt":4,"margem_op":28,"deducoes":12},"saude":{"cmv":12,"folha":32,"aluguel":8,"outros_cf":8,"mkt":3,"margem_op":25,"deducoes":12},"bem_estar":{"cmv":5,"folha":30,"aluguel":12,"outros_cf":8,"mkt":4,"margem_op":22,"deducoes":13},"beleza_estetica":{"cmv":10,"folha":30,"aluguel":10,"outros_cf":8,"mkt":3,"margem_op":22,"deducoes":13},"industria":{"cmv":45,"folha":18,"aluguel":5,"outros_cf":8,"mkt":2,"margem_op":12,"deducoes":18},"hospedagem":{"cmv":18,"folha":25,"aluguel":12,"outros_cf":10,"mkt":4,"margem_op":18,"deducoes":14},"logistica":{"cmv":22,"folha":32,"aluguel":5,"outros_cf":10,"mkt":2,"margem_op":12,"deducoes":14},"alimentacao":{"cmv":32,"folha":22,"aluguel":9,"outros_cf":8,"mkt":3,"margem_op":15,"deducoes":14},"servicos_locais":{"cmv":12,"folha":28,"aluguel":8,"outros_cf":8,"mkt":2,"margem_op":18,"deducoes":12},"varejo":{"cmv":48,"folha":14,"aluguel":5,"outros_cf":6,"mkt":3,"margem_op":10,"deducoes":22},"construcao":{"cmv":38,"folha":22,"aluguel":4,"outros_cf":8,"mkt":2,"margem_op":10,"deducoes":14}}'::jsonb,
  true
)
WHERE id = 'v2026.04';

-- Verificação
SELECT
  id,
  ativo,
  snapshot->'faixas_atratividade' AS faixas_novas,
  snapshot->'benchmarks_dre'->'servicos_empresas' AS bench_servicos
FROM parametros_versoes
WHERE id = 'v2026.04';
