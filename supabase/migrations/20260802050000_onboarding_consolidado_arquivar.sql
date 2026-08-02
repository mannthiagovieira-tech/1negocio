-- Consolida 4 etapas de setup em 1 · 'onboarding'
-- Antes: acesso, convite, ciente, agendamento (4 · sequenciais)
-- Depois: onboarding (1 · dispara tudo num clique)

-- Se qualquer das 4 antigas estava concluída, marca onboarding concluída
UPDATE va_projeto_etapas ob
SET status='concluida',
    data_real = COALESCE(ob.data_real, (
      SELECT MAX(data_real) FROM va_projeto_etapas x
      WHERE x.projeto_id=ob.projeto_id AND x.chave IN ('convite','ciente','agendamento') AND x.status='concluida'
    ))
WHERE ob.chave='acesso'
  AND EXISTS (
    SELECT 1 FROM va_projeto_etapas x
    WHERE x.projeto_id=ob.projeto_id AND x.chave IN ('convite','ciente','agendamento') AND x.status='concluida'
  );

UPDATE va_projeto_etapas SET chave='onboarding', titulo='Onboarding enviado'
WHERE chave='acesso';

DELETE FROM va_projeto_etapas WHERE chave IN ('convite','ciente','agendamento');

-- Nova ordem: onboarding(1) avaliacao(2) laudo(3) preco(4) regras(5) anexos(6)
-- teaser(7) teaser_ok(8) arquetipos(9) publicacao(10) criativos(11) campanha(12) operacao(13)
UPDATE va_projeto_etapas SET ordem = CASE chave
  WHEN 'onboarding' THEN 1 WHEN 'avaliacao' THEN 2 WHEN 'laudo' THEN 3 WHEN 'preco' THEN 4
  WHEN 'regras' THEN 5 WHEN 'anexos' THEN 6 WHEN 'teaser' THEN 7 WHEN 'teaser_ok' THEN 8
  WHEN 'arquetipos' THEN 9 WHEN 'publicacao' THEN 10 WHEN 'criativos' THEN 11
  WHEN 'campanha' THEN 12 WHEN 'operacao' THEN 13 ELSE ordem END;

-- Atualiza trigger de seed pra criar 13 etapas
CREATE OR REPLACE FUNCTION va_gerar_setup()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  INSERT INTO va_projeto_etapas (projeto_id, chave, titulo, ordem, offset_dias, responsavel, data_prevista)
  SELECT NEW.id, chave, titulo, ordem, offset_dias, responsavel,
         (NEW.data_inicio + (offset_dias || ' days')::interval)::date
  FROM (VALUES
    ('onboarding',  'Onboarding enviado',            1,  0, 'sistema'),
    ('avaliacao',   'Avaliação',                     2,  3, 'ambos'),
    ('laudo',       'Laudo gerado',                  3,  5, 'voce'),
    ('preco',       'Preço de venda definido',       4,  7, 'ambos'),
    ('regras',      'Regras e sigilo definidos',     5,  7, 'cliente'),
    ('anexos',      'Anexos carregados',             6,  8, 'ambos'),
    ('teaser',      'Teaser gerado',                 7,  6, 'voce'),
    ('teaser_ok',   'Teaser aprovado',               8,  8, 'cliente'),
    ('arquetipos',  'Arquétipos definidos',          9,  9, 'voce'),
    ('publicacao',  'Publicação no portal',         10,  9, 'voce'),
    ('criativos',   'Criativos produzidos',         11, 11, 'voce'),
    ('campanha',    'Campanha configurada',         12, 12, 'voce'),
    ('operacao',    'Operação ativa',               13, 13, 'sistema')
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

-- Onboarding · rastreio de envio e agendamento
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS onboarding_enviado_em timestamptz;
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS onboarding_enviado_por text;
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS onboarding_conteudo_snapshot jsonb;
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS primeira_reuniao_em timestamptz;
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS agendamento_link text;

-- Arquivar projeto · soft delete
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS arquivado_em timestamptz;
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS arquivado_por text;
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS arquivado_motivo text;
CREATE INDEX IF NOT EXISTS idx_va_projetos_nao_arquivados
  ON va_projetos(criado_em DESC) WHERE arquivado_em IS NULL;

-- Recria view va_projetos_resumo pra expor novos campos (onboarding, arquivar, código VA)
-- CASCADE porque outros consumidores dependem dela
DROP VIEW IF EXISTS va_projetos_resumo CASCADE;
CREATE VIEW va_projetos_resumo AS
 SELECT p.id, p.negocio_id, p.cliente_nome, p.cliente_whatsapp, p.cliente_usuario_id,
    p.negocio_titulo, p.cidade, p.setor,
    p.valor_mensal, p.fidelidade_meses, p.comissao_percent,
    p.data_inicio, p.expectativa_valor,
    p.valor_avaliacao, p.valor_avaliacao_min, p.valor_avaliacao_max,
    p.valor_venda, p.valor_venda_justificativa, p.valor_venda_decidido_por,
    p.nivel_sigilo, p.status,
    p.codigo, p.uf, p.avaliacao_setor, p.cnpj,
    p.modalidade, p.forma_pagamento,
    p.operacao_liberada_manual, p.liberacao_manual_por, p.liberacao_manual_em,
    p.avaliacao_origem_id, p.laudo_v2_id,
    p.descricao_negocio, p.descricao_negocio_versao, p.descricao_negocio_gerado_em,
    p.onboarding_enviado_em, p.onboarding_enviado_por, p.onboarding_conteudo_snapshot,
    p.primeira_reuniao_em, p.agendamento_link,
    p.arquivado_em, p.arquivado_por, p.arquivado_motivo,
    p.precos_versao_id,
    p.criado_em, p.atualizado_em,
    COALESCE(e.total, 0::bigint) AS etapas_total,
    COALESCE(e.ok, 0::bigint) AS etapas_ok,
    COALESCE(pa.total_pago, 0::numeric) AS total_pago,
    (COALESCE(pa.total_pago, 0::numeric) * 0.5) AS credito_liberado,
    ((p.data_inicio + ((p.fidelidade_meses || ' months'::text))::interval))::date AS fim_da_onda,
    (CURRENT_DATE - p.data_inicio) AS dia_atual
 FROM va_projetos p
   LEFT JOIN ( SELECT projeto_id, count(*) AS total,
                      count(*) FILTER (WHERE status = 'concluida'::text) AS ok
               FROM va_projeto_etapas GROUP BY projeto_id) e ON e.projeto_id = p.id
   LEFT JOIN ( SELECT projeto_id, sum(valor) AS total_pago
               FROM va_projeto_parcelas WHERE status = 'pago'::text
               GROUP BY projeto_id) pa ON pa.projeto_id = p.id;
GRANT SELECT ON va_projetos_resumo TO authenticated;
