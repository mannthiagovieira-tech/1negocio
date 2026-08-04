-- Slice P5 · v4 · adiciona ia_geracao_criativo + midia_meta atualizado (×1,5)
UPDATE va_precos_versao SET vigente=false WHERE numero=3;

INSERT INTO va_precos_versao (numero, nome, vigente, observacao, criado_por, vigente_desde)
VALUES (4, 'v4 · P5 mídia + IA de criativo', true,
  'v4 · adiciona ia_geracao_criativo (custo 0,50 · preço 1,00) e atualiza midia_meta pra gasto real × 1,5. Herda outros preços da v3.',
  'operador', CURRENT_DATE);

INSERT INTO va_precos (tipo, rotulo, unidade, custo_real, preco, repassa_sem_margem, ordem, ativo, fornecedor, versao_id)
SELECT p.tipo, p.rotulo, p.unidade, p.custo_real, p.preco, p.repassa_sem_margem, p.ordem, true, p.fornecedor,
       (SELECT id FROM va_precos_versao WHERE numero=4)
FROM va_precos p
WHERE p.ativo = true
  AND p.versao_id = (SELECT id FROM va_precos_versao WHERE numero=3)
  AND p.tipo NOT IN ('ia_geracao_criativo','midia_meta');

INSERT INTO va_precos (tipo, rotulo, unidade, custo_real, preco, repassa_sem_margem, ordem, ativo, fornecedor, versao_id)
VALUES
  ('ia_geracao_criativo', 'IA · geração de copy de criativo (Sonnet · 3-4 variações)',
    'geração', 0.50, 1.00, false, 100, true, 'Anthropic',
    (SELECT id FROM va_precos_versao WHERE numero=4)),
  ('midia_meta', 'Mídia Meta Ads (gasto real × 1,5)',
    'R$', 1.00, 1.50, false, 110, true, 'Meta',
    (SELECT id FROM va_precos_versao WHERE numero=4));

INSERT INTO storage.buckets (id, name, public)
VALUES ('criativos-png', 'criativos-png', true)
ON CONFLICT (id) DO NOTHING;
