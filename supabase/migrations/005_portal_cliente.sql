-- ═══════════════════════════════════════════════════════════════════
-- VENDA ASSESSORADA · SLICE 6 · portal do cliente (/meu-projeto.html)
-- Corte de segurança é NO POSTGRES · nunca no JavaScript.
-- ═══════════════════════════════════════════════════════════════════

-- 1) va_projeto_acesso ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS va_projeto_acesso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  usuario_id uuid,
  telefone_normalizado text NOT NULL,
  papel text NOT NULL DEFAULT 'cliente' CHECK (papel IN ('cliente','operador','parceiro')),
  ativo boolean NOT NULL DEFAULT true,
  primeiro_acesso_em timestamptz,
  ultimo_acesso_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (projeto_id, telefone_normalizado)
);
CREATE INDEX IF NOT EXISTS va_acesso_tel ON va_projeto_acesso (telefone_normalizado) WHERE ativo;
CREATE INDEX IF NOT EXISTS va_acesso_usr ON va_projeto_acesso (usuario_id) WHERE ativo AND usuario_id IS NOT NULL;

ALTER TABLE va_projeto_acesso ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS va_acesso_auth ON va_projeto_acesso;
CREATE POLICY va_acesso_auth ON va_projeto_acesso FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2) Ajusta trigger va_gerar_setup pra inserir linha de acesso cliente ─
CREATE OR REPLACE FUNCTION va_gerar_setup()
RETURNS TRIGGER AS $$
DECLARE n int;
BEGIN
  INSERT INTO va_projeto_etapas (projeto_id, chave, titulo, ordem, offset_dias, responsavel, data_prevista)
  SELECT NEW.id, chave, titulo, ordem, offset_dias, responsavel,
         (NEW.data_inicio + (offset_dias || ' days')::interval)::date
  FROM (VALUES
    ('acesso',      'Acesso do cliente criado',       1,  0,  'sistema'),
    ('convite',     'Convite e checklist enviados',   2,  1,  'sistema'),
    ('ciente',      'Cliente marcou ciente',          3,  2,  'cliente'),
    ('agendamento', 'Reunião agendada',               4,  3,  'cliente'),
    ('kickoff',     'Kickoff · reunião de avaliação', 5,  5,  'ambos'),
    ('laudo',       'Laudo gerado',                   6,  7,  'voce'),
    ('teaser',      'Teaser gerado',                  7,  8,  'voce'),
    ('teaser_ok',   'Teaser aprovado',                8,  9,  'cliente'),
    ('preco',       'Preço de venda definido',        9,  10, 'ambos'),
    ('regras',      'Regras e sigilo definidos',      10, 10, 'cliente'),
    ('anexos',      'Anexos carregados',              11, 11, 'ambos'),
    ('arquetipos',  'Arquétipos definidos',           12, 12, 'voce'),
    ('criativos',   'Criativos produzidos',           13, 14, 'voce'),
    ('campanha',    'Campanha configurada',           14, 15, 'voce'),
    ('operacao',    'Operação ativa',                 15, 15, 'sistema')
  ) AS t(chave, titulo, ordem, offset_dias, responsavel);

  IF NEW.valor_mensal IS NOT NULL AND NEW.fidelidade_meses > 0 THEN
    FOR n IN 1..NEW.fidelidade_meses LOOP
      INSERT INTO va_projeto_parcelas (projeto_id, numero, vencimento, valor)
      VALUES (NEW.id, n, (NEW.data_inicio + ((n - 1) || ' months')::interval)::date, NEW.valor_mensal);
    END LOOP;
  END IF;

  INSERT INTO va_projeto_kickoff (projeto_id) VALUES (NEW.id)
  ON CONFLICT (projeto_id) DO NOTHING;

  -- NOVO: acesso cliente automático pelo telefone do dono
  INSERT INTO va_projeto_acesso (projeto_id, telefone_normalizado, papel, ativo)
  VALUES (NEW.id, va_normalizar_telefone(NEW.cliente_whatsapp), 'cliente', true)
  ON CONFLICT (projeto_id, telefone_normalizado) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3) Backfill de acesso pros projetos existentes
INSERT INTO va_projeto_acesso (projeto_id, telefone_normalizado, papel, ativo)
SELECT id, va_normalizar_telefone(cliente_whatsapp), 'cliente', true
FROM va_projetos
WHERE va_normalizar_telefone(cliente_whatsapp) IS NOT NULL
ON CONFLICT (projeto_id, telefone_normalizado) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 4) VIEWS DE CLIENTE (sem RLS própria; acesso via RPCs abaixo)
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW va_cliente_projeto AS
SELECT
  p.id AS projeto_id,
  COALESCE(p.negocio_titulo, p.setor, 'Seu negócio') AS negocio_titulo,
  p.cidade,
  p.data_inicio,
  p.fidelidade_meses,
  p.valor_venda,
  p.status,
  p.nivel_sigilo,
  f.contrato_total,
  f.total_pago,
  f.parcelas_pagas,
  f.consumido AS investido_acumulado,
  f.fim_da_onda,
  f.dias_onda,
  f.dias_decorridos AS dia_atual,
  split_part(coalesce(p.cliente_nome,''),' ',1) AS primeiro_nome
FROM va_projetos p
JOIN va_projeto_financeiro f ON f.projeto_id = p.id;

CREATE OR REPLACE VIEW va_cliente_etapas AS
SELECT
  e.projeto_id, e.ordem, e.titulo, e.data_prevista, e.data_real, e.status,
  CASE WHEN e.responsavel = 'cliente' THEN 'Você' ELSE '1Negócio' END AS responsavel
FROM va_projeto_etapas e;

CREATE OR REPLACE VIEW va_cliente_funil AS
SELECT
  projeto_id,
  CASE
    WHEN estagio IN ('novo','abordado')                THEN 'Empresas alcançadas'
    WHEN estagio IN ('sem_resposta','sem_interesse')   THEN 'Sem interesse'
    WHEN estagio IN ('interesse_inicial','apresentado')THEN 'Com interesse'
    WHEN estagio IN ('nda_assinado','em_negociacao')   THEN 'Em negociação'
    WHEN estagio = 'proposta'                          THEN 'Proposta recebida'
    ELSE 'Encerrado'
  END AS rotulo,
  SUM(total)::int AS total
FROM va_projeto_funil
GROUP BY projeto_id, 2;

CREATE OR REPLACE VIEW va_cliente_interessados AS
SELECT
  c.projeto_id,
  '#' || left(replace(c.id::text,'-',''), 6) AS referencia,
  COALESCE(cat.nome, 'Comprador') AS arquetipo_nome,
  c.cidade,
  c.estado,
  CASE
    WHEN c.estagio IN ('interesse_inicial','apresentado')  THEN 'Com interesse'
    WHEN c.estagio IN ('nda_assinado','em_negociacao')     THEN 'Em negociação'
    WHEN c.estagio = 'proposta'                            THEN 'Proposta recebida'
    ELSE 'Outro'
  END AS estagio_rotulo,
  c.atualizado_em
FROM va_contatos c
LEFT JOIN va_arquetipos_catalogo cat ON cat.codigo = c.arquetipo_codigo
WHERE c.estagio IN ('interesse_inicial','apresentado','nda_assinado','em_negociacao','proposta');

CREATE OR REPLACE VIEW va_cliente_investimento AS
WITH mapa AS (
  SELECT projeto_id,
    CASE
      WHEN tipo = 'lead_scrapper'    THEN 'Prospecção ativa'
      WHEN tipo = 'disparo_whatsapp' THEN 'Abordagem direta'
      WHEN tipo = 'midia_meta'       THEN 'Mídia paga'
      WHEN tipo IN ('teaser','criativo_estatico','criativo_video','setup_arquetipos','setup_campanha','laudo','avaliacao_guiada')
                                     THEN 'Produção de material'
      ELSE NULL
    END AS frente,
    quantidade, valor_total
  FROM va_projeto_razao
)
SELECT projeto_id, frente,
       SUM(quantidade)::numeric AS volume,
       SUM(valor_total)::numeric AS valor
FROM mapa
WHERE frente IS NOT NULL
GROUP BY projeto_id, frente;

-- ═══════════════════════════════════════════════════════════════════
-- 5) RPCs de cliente · SECURITY DEFINER · gate por va_projeto_acesso
-- ═══════════════════════════════════════════════════════════════════

-- Helper: retorna true se o auth.uid() tem acesso ativo ao projeto
CREATE OR REPLACE FUNCTION va_cli_tem_acesso_projeto(p_projeto uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM va_projeto_acesso
    WHERE projeto_id = p_projeto
      AND usuario_id = auth.uid()
      AND ativo = true
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Pré-check anônimo antes de disparar OTP (retorna sempre boolean)
CREATE OR REPLACE FUNCTION va_cli_tem_acesso(p_telefone text)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM va_projeto_acesso
    WHERE telefone_normalizado = va_normalizar_telefone(p_telefone)
      AND ativo = true
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Pós-login: casa telefone do JWT → usuario_id, marca acesso
CREATE OR REPLACE FUNCTION va_cli_registrar_acesso()
RETURNS int AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tel text;
  v_norm text;
  v_afetados int;
BEGIN
  IF v_uid IS NULL THEN RETURN 0; END IF;
  SELECT (auth.jwt() ->> 'phone') INTO v_tel;
  v_norm := va_normalizar_telefone(v_tel);
  IF v_norm IS NULL THEN RETURN 0; END IF;

  UPDATE va_projeto_acesso
  SET usuario_id = v_uid,
      primeiro_acesso_em = COALESCE(primeiro_acesso_em, now()),
      ultimo_acesso_em   = now()
  WHERE telefone_normalizado = v_norm
    AND ativo = true;
  GET DIAGNOSTICS v_afetados = ROW_COUNT;
  RETURN v_afetados;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Lista projetos que o usuário logado pode acessar (com resumo)
CREATE OR REPLACE FUNCTION va_cli_projetos()
RETURNS SETOF va_cliente_projeto AS $$
  SELECT v.* FROM va_cliente_projeto v
  WHERE v.projeto_id IN (
    SELECT projeto_id FROM va_projeto_acesso
    WHERE usuario_id = auth.uid() AND ativo = true
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Detalhe de um projeto específico (gate)
CREATE OR REPLACE FUNCTION va_cli_projeto(p_projeto uuid)
RETURNS SETOF va_cliente_projeto AS $$
  SELECT v.* FROM va_cliente_projeto v
  WHERE v.projeto_id = p_projeto AND va_cli_tem_acesso_projeto(p_projeto);
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION va_cli_etapas(p_projeto uuid)
RETURNS SETOF va_cliente_etapas AS $$
  SELECT v.* FROM va_cliente_etapas v
  WHERE v.projeto_id = p_projeto AND va_cli_tem_acesso_projeto(p_projeto)
  ORDER BY v.ordem;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION va_cli_funil(p_projeto uuid)
RETURNS SETOF va_cliente_funil AS $$
  SELECT v.* FROM va_cliente_funil v
  WHERE v.projeto_id = p_projeto AND va_cli_tem_acesso_projeto(p_projeto);
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION va_cli_interessados(p_projeto uuid)
RETURNS SETOF va_cliente_interessados AS $$
  SELECT v.* FROM va_cliente_interessados v
  WHERE v.projeto_id = p_projeto AND va_cli_tem_acesso_projeto(p_projeto)
  ORDER BY v.atualizado_em DESC;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION va_cli_investimento(p_projeto uuid)
RETURNS SETOF va_cliente_investimento AS $$
  SELECT v.* FROM va_cliente_investimento v
  WHERE v.projeto_id = p_projeto AND va_cli_tem_acesso_projeto(p_projeto)
  ORDER BY v.frente;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION va_cli_parcelas(p_projeto uuid)
RETURNS TABLE (numero int, vencimento date, valor numeric, status text, pago_em date) AS $$
  SELECT p.numero, p.vencimento, p.valor, p.status, p.pago_em
  FROM va_projeto_parcelas p
  WHERE p.projeto_id = p_projeto AND va_cli_tem_acesso_projeto(p_projeto)
  ORDER BY p.numero;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Cliente grava observação sobre interessado (vai como nota INTERNA)
CREATE OR REPLACE FUNCTION va_cli_gravar_nota(p_projeto uuid, p_referencia text, p_texto text)
RETURNS uuid AS $$
DECLARE v_contato uuid; v_id uuid;
BEGIN
  IF NOT va_cli_tem_acesso_projeto(p_projeto) THEN
    RAISE EXCEPTION 'sem acesso ao projeto';
  END IF;
  IF p_texto IS NULL OR btrim(p_texto) = '' THEN
    RAISE EXCEPTION 'texto vazio';
  END IF;
  SELECT id INTO v_contato FROM va_contatos
  WHERE projeto_id = p_projeto
    AND left(replace(id::text,'-',''), 6) = replace(p_referencia,'#','')
    AND estagio IN ('interesse_inicial','apresentado','nda_assinado','em_negociacao','proposta')
  LIMIT 1;
  IF v_contato IS NULL THEN
    RAISE EXCEPTION 'interessado não encontrado';
  END IF;
  INSERT INTO va_contato_interacoes (contato_id, projeto_id, tipo, conteudo, autor)
  VALUES (v_contato, p_projeto, 'nota', p_texto, 'cliente')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grants: cliente authenticated + anon (só pra pré-check)
GRANT EXECUTE ON FUNCTION va_cli_tem_acesso(text)          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION va_cli_tem_acesso_projeto(uuid)  TO authenticated;
GRANT EXECUTE ON FUNCTION va_cli_registrar_acesso()        TO authenticated;
GRANT EXECUTE ON FUNCTION va_cli_projetos()                TO authenticated;
GRANT EXECUTE ON FUNCTION va_cli_projeto(uuid)             TO authenticated;
GRANT EXECUTE ON FUNCTION va_cli_etapas(uuid)              TO authenticated;
GRANT EXECUTE ON FUNCTION va_cli_funil(uuid)               TO authenticated;
GRANT EXECUTE ON FUNCTION va_cli_interessados(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION va_cli_investimento(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION va_cli_parcelas(uuid)            TO authenticated;
GRANT EXECUTE ON FUNCTION va_cli_gravar_nota(uuid, text, text) TO authenticated;
