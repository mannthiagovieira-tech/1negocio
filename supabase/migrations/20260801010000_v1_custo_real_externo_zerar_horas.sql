-- ═══════════════════════════════════════════════════════════════════
-- V1 · custo_real volta a ser custo EXTERNO puro
-- ═══════════════════════════════════════════════════════════════════
-- Gestão, avaliação e setups NÃO têm custo de hora. São preço fixo pelo
-- serviço prestado. custo_hora_operador em va_precos_versao_config vira
-- coluna deprecada (mantida no schema, mas 0 na v1 e sem uso).

-- Zera horas em todas as linhas da v1
WITH v AS (SELECT id AS versao_id FROM va_precos_versao WHERE numero=1)
UPDATE va_precos p SET horas_estimadas = 0 FROM v WHERE p.versao_id = v.versao_id;

-- Serviços próprios · custo externo = 0
WITH v AS (SELECT id AS versao_id FROM va_precos_versao WHERE numero=1)
UPDATE va_precos p SET custo_real = 0
FROM v
WHERE p.versao_id = v.versao_id
  AND p.tipo IN ('gestao_mensal','avaliacao_guiada','setup_arquetipos','combo_criativos','setup_campanha','anuncio_plataforma');

-- Custos externos reais das linhas com fornecedor de fora
WITH v AS (SELECT id AS versao_id FROM va_precos_versao WHERE numero=1)
UPDATE va_precos p SET custo_real = c
FROM v, (VALUES
  ('lead_qualificado', 0.50::numeric),  -- kipflow
  ('disparo_whatsapp', 1.00::numeric),  -- API zapi
  ('impulsionamento',  10.00::numeric)  -- meta/dia
) AS x(tipo, c)
WHERE p.versao_id = v.versao_id AND p.tipo = x.tipo;

-- Zera custo_hora_operador (deprecado)
UPDATE va_precos_versao_config SET custo_hora_operador = 0
  WHERE versao_id = (SELECT id FROM va_precos_versao WHERE numero=1);

COMMENT ON COLUMN va_precos_versao_config.custo_hora_operador IS 'Deprecado · gestão/avaliação/setups não têm custo de hora (serviço próprio). custo_real de cada linha reflete só custo EXTERNO.';
