-- v9.34.2 · Sprint 3 · fix CHECK constraint canal de pool_contatos_uso
-- pra aceitar valores web_* (vindos do Claude web search)
-- · também adiciona linkedin · google_search · twitter · olx · manual · matchmaking

ALTER TABLE pool_contatos_uso DROP CONSTRAINT IF EXISTS pool_contatos_uso_canal_check;

ALTER TABLE pool_contatos_uso ADD CONSTRAINT pool_contatos_uso_canal_check
CHECK (canal IN (
  'gmaps',
  'facebook',
  'instagram',
  'linkedin',
  'google_search',
  'twitter',
  'olx',
  'corretores_locais',
  'interno',
  'manual',
  'matchmaking',
  'web_compradores',
  'web_influenciadores',
  'web_eventos',
  'web_corretores',
  'web_profissionais'
));

-- Corrige leads já salvos com workaround canal='interno' · _canal_origem em pool_contatos_global.dados_brutos
-- (0 esperado · operador ainda não rodou claude-web · mas a query é idempotente)
UPDATE pool_contatos_uso pcu
SET canal = (pcg.dados_brutos->>'_canal_origem')
FROM pool_contatos_global pcg
WHERE pcu.contato_id = pcg.id
  AND pcu.canal = 'interno'
  AND pcg.dados_brutos->>'_canal_origem' LIKE 'web_%';
