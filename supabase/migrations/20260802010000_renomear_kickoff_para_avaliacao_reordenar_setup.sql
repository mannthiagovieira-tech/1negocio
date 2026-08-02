-- Kickoff → Avaliação · reordena SETUP na ordem operacional
-- Ordem visível pedida:
--   SETUP · Avaliação · Preço · Regras · Anexos · Teaser · Arquétipos · Publicação · Criativos · Campanha

UPDATE va_projeto_etapas SET chave='avaliacao', titulo='Avaliação'
WHERE chave='kickoff';

CREATE OR REPLACE FUNCTION va_gerar_setup()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  INSERT INTO va_projeto_etapas (projeto_id, chave, titulo, ordem, offset_dias, responsavel, data_prevista)
  SELECT NEW.id, chave, titulo, ordem, offset_dias, responsavel,
         (NEW.data_inicio + (offset_dias || ' days')::interval)::date
  FROM (VALUES
    ('acesso',      'Acesso do cliente criado',      1,  0, 'sistema'),
    ('convite',     'Convite e checklist enviados',  2,  1, 'sistema'),
    ('ciente',      'Cliente marcou ciente',         3,  2, 'cliente'),
    ('agendamento', 'Reunião agendada',              4,  3, 'cliente'),
    ('avaliacao',   'Avaliação',                     5,  5, 'ambos'),
    ('laudo',       'Laudo gerado',                  6,  7, 'voce'),
    ('preco',       'Preço de venda definido',       7, 10, 'ambos'),
    ('regras',      'Regras e sigilo definidos',     8, 10, 'cliente'),
    ('anexos',      'Anexos carregados',             9, 11, 'ambos'),
    ('teaser',      'Teaser gerado',                10,  8, 'voce'),
    ('teaser_ok',   'Teaser aprovado',              11,  9, 'cliente'),
    ('arquetipos',  'Arquétipos definidos',         12, 12, 'voce'),
    ('publicacao',  'Publicação no portal',         13,  9, 'voce'),
    ('criativos',   'Criativos produzidos',         14, 14, 'voce'),
    ('campanha',    'Campanha configurada',         15, 15, 'voce'),
    ('operacao',    'Operação ativa',               16, 15, 'sistema')
  ) AS t(chave, titulo, ordem, offset_dias, responsavel);
  IF NEW.valor_mensal IS NOT NULL AND NEW.fidelidade_meses > 0 THEN
    FOR n IN 1..NEW.fidelidade_meses LOOP
      INSERT INTO va_projeto_parcelas (projeto_id, numero, vencimento, valor)
      VALUES (NEW.id, n, (NEW.data_inicio + ((n - 1) || ' months')::interval)::date, NEW.valor_mensal);
    END LOOP;
  END IF;
  INSERT INTO va_projeto_kickoff (projeto_id) VALUES (NEW.id) ON CONFLICT (projeto_id) DO NOTHING;
  INSERT INTO va_projeto_acesso (projeto_id, telefone_normalizado, papel, ativo)
  VALUES (NEW.id, va_normalizar_telefone(NEW.cliente_whatsapp), 'cliente', true)
  ON CONFLICT (projeto_id, telefone_normalizado) DO NOTHING;
  RETURN NEW;
END; $$;

-- Reordena etapas existentes pra bater com a nova ordem SETUP
UPDATE va_projeto_etapas SET ordem=7  WHERE chave='preco';
UPDATE va_projeto_etapas SET ordem=8  WHERE chave='regras';
UPDATE va_projeto_etapas SET ordem=9  WHERE chave='anexos';
UPDATE va_projeto_etapas SET ordem=10 WHERE chave='teaser';
UPDATE va_projeto_etapas SET ordem=11 WHERE chave='teaser_ok';
UPDATE va_projeto_etapas SET ordem=12 WHERE chave='arquetipos';
UPDATE va_projeto_etapas SET ordem=13 WHERE chave='publicacao';
UPDATE va_projeto_etapas SET ordem=14 WHERE chave='criativos';
UPDATE va_projeto_etapas SET ordem=15 WHERE chave='campanha';
UPDATE va_projeto_etapas SET ordem=16 WHERE chave='operacao';
