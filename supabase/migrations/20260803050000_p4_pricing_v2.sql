-- P4 · nova versão v2 de preços (decisão do operador)
-- lead_scrapper: custo 1,50 · preço 3,00 (unidade = lead aprovado no portão)
-- NOVO lead_enriquecimento: custo 0,50 provisório · preço 1,00
-- Markup 2x (não 3x). Arte Deli movido para v2; demais projetos congelados na v1.
DO $$
DECLARE v_new uuid; v_old uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM va_precos_versao WHERE numero=2) THEN RETURN; END IF;
  SELECT id INTO v_old FROM va_precos_versao WHERE vigente=true LIMIT 1;
  UPDATE va_precos_versao SET vigente=false WHERE id=v_old;
  INSERT INTO va_precos_versao(numero, nome, vigente, observacao, criado_por, vigente_desde)
  VALUES (
    (SELECT COALESCE(MAX(numero),0)+1 FROM va_precos_versao),
    'v2 · P4 pricing · lead_scrapper 1,50/3,00 + lead_enriquecimento 0,50/1,00',
    true,
    'Markup 2x por decisao do operador. lead_enriquecimento custo 0,50 provisorio — recalibrar em producao.',
    'operador', CURRENT_DATE
  ) RETURNING id INTO v_new;
  INSERT INTO va_precos (versao_id, tipo, rotulo, unidade, custo_real, preco, fornecedor, ativo, repassa_sem_margem, ordem, horas_estimadas)
  SELECT v_new, p.tipo, p.rotulo, p.unidade,
    CASE WHEN p.tipo='lead_scrapper' THEN 1.50 ELSE p.custo_real END,
    CASE WHEN p.tipo='lead_scrapper' THEN 3.00 ELSE p.preco END,
    p.fornecedor, p.ativo, p.repassa_sem_margem, p.ordem, p.horas_estimadas
  FROM va_precos p WHERE p.versao_id=v_old AND p.ativo=true;
  UPDATE va_precos SET rotulo='Lead prospectado (extração + antessala)'
  WHERE versao_id=v_new AND tipo='lead_scrapper';
  INSERT INTO va_precos (versao_id, tipo, rotulo, unidade, custo_real, preco, fornecedor, ativo, repassa_sem_margem, ordem)
  VALUES (v_new, 'lead_enriquecimento',
    'Enriquecimento de lead (partners+debts sob demanda)', 'unidade',
    0.50, 1.00, 'kipflow', true, false,
    (SELECT COALESCE(MAX(ordem),0)+1 FROM va_precos WHERE versao_id=v_new));
  UPDATE va_projetos SET precos_versao_id=v_new
  WHERE id='b676073a-6074-48d4-a608-7947de006dff';
END $$;
