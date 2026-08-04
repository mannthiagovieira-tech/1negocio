-- v3 · tudo cobrado com margem · decisão operador 03/08
-- Markup 2× dados/IA · disparo mantém preço · lead_enriquecimento absorve lead_maps
DO $$
DECLARE v_new uuid; v_old uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM va_precos_versao WHERE numero=3) THEN RETURN; END IF;
  SELECT id INTO v_old FROM va_precos_versao WHERE vigente=true LIMIT 1;
  UPDATE va_precos_versao SET vigente=false WHERE id=v_old;
  INSERT INTO va_precos_versao(numero, nome, vigente, observacao, criado_por, vigente_desde)
  VALUES (
    3, 'v3 · tudo cobrado com margem · 2x dados/IA · disparo mantem',
    true,
    'v3 · tudo cobrado com margem · markup 2x dados/IA · decisao operador 03/08. lead_enriquecimento absorve lead_maps no MANDATO. IA de arquetipos/teaser/destilar/resposta passa a debitar.',
    'operador', CURRENT_DATE
  ) RETURNING id INTO v_new;

  INSERT INTO va_precos (versao_id, tipo, rotulo, unidade, custo_real, preco, fornecedor, ativo, repassa_sem_margem, ordem, horas_estimadas)
  SELECT v_new, p.tipo, p.rotulo, p.unidade, p.custo_real, p.preco, p.fornecedor, p.ativo, p.repassa_sem_margem, p.ordem, p.horas_estimadas
  FROM va_precos p WHERE p.versao_id=v_old AND p.ativo=true;

  UPDATE va_precos SET custo_real=1.50, preco=3.00,
    rotulo='Lead prospectado (extração + antessala) · aprovado no portão'
  WHERE versao_id=v_new AND tipo='lead_scrapper';

  UPDATE va_precos SET custo_real=0.62, preco=1.25,
    rotulo='Enriquecimento de lead (Kipflow partners+debts+online_presence + Apify Gmaps cascata)'
  WHERE versao_id=v_new AND tipo='lead_enriquecimento';

  UPDATE va_precos SET custo_real=0.10, preco=1.00,
    rotulo='Disparo WhatsApp (cadência ou resposta)'
  WHERE versao_id=v_new AND tipo='disparo_whatsapp';

  INSERT INTO va_precos (versao_id, tipo, rotulo, unidade, custo_real, preco, fornecedor, ativo, repassa_sem_margem, ordem)
  VALUES
    (v_new, 'ia_geracao_arquetipos',  'Geração de arquétipos (Claude Sonnet)',        'unidade', 1.50, 3.00, 'anthropic', true, false,
      (SELECT COALESCE(MAX(ordem),0)+1 FROM va_precos WHERE versao_id=v_new)),
    (v_new, 'ia_geracao_teaser',      'Geração do teaser (Claude Sonnet)',            'unidade', 0.50, 1.00, 'anthropic', true, false,
      (SELECT COALESCE(MAX(ordem),0)+1 FROM va_precos WHERE versao_id=v_new)),
    (v_new, 'ia_destilacao_fonte',    'Destilação de fonte (Claude Sonnet)',          'unidade', 0.80, 1.60, 'anthropic', true, false,
      (SELECT COALESCE(MAX(ordem),0)+1 FROM va_precos WHERE versao_id=v_new)),
    (v_new, 'ia_resposta_personalizada','Rascunho IA aprovado e enviado',             'unidade', 0.25, 0.50, 'anthropic', true, false,
      (SELECT COALESCE(MAX(ordem),0)+1 FROM va_precos WHERE versao_id=v_new))
  ON CONFLICT DO NOTHING;

  UPDATE va_projetos SET precos_versao_id=v_new WHERE id='b676073a-6074-48d4-a608-7947de006dff';
END $$;
