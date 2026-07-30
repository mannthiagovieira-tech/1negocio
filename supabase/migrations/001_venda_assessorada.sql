-- ═══════════════════════════════════════════════════════════════════
-- VENDA ASSESSORADA · SLICE 1 · schema base
-- Prefixo va_ · aditivo · não altera nenhuma tabela existente
-- ═══════════════════════════════════════════════════════════════════

-- 1) va_projetos ---------------------------------------------------
CREATE TABLE IF NOT EXISTS va_projetos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id uuid NULL REFERENCES negocios(id) ON DELETE SET NULL,
  cliente_nome text NOT NULL,
  cliente_whatsapp text NOT NULL,
  cliente_usuario_id uuid NULL,
  negocio_titulo text,
  cidade text,
  setor text,
  valor_mensal numeric(12,2),
  fidelidade_meses int NOT NULL DEFAULT 3,
  comissao_percent numeric(5,2) NOT NULL DEFAULT 5,
  data_inicio date NOT NULL,
  expectativa_valor numeric(14,2),
  valor_avaliacao numeric(14,2),
  valor_avaliacao_min numeric(14,2),
  valor_avaliacao_max numeric(14,2),
  valor_venda numeric(14,2),
  valor_venda_justificativa text,
  valor_venda_decidido_por text,
  nivel_sigilo text NOT NULL DEFAULT 'padrao' CHECK (nivel_sigilo IN ('rigoroso','padrao','flexivel')),
  status text NOT NULL DEFAULT 'setup' CHECK (status IN ('setup','ativo','pausado','encerrado','concluido')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- 2) va_projeto_etapas ---------------------------------------------
CREATE TABLE IF NOT EXISTS va_projeto_etapas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  chave text NOT NULL,
  titulo text NOT NULL,
  ordem int NOT NULL,
  offset_dias int NOT NULL,
  responsavel text,
  data_prevista date,
  data_real date,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','em_andamento','concluida','pulada')),
  UNIQUE (projeto_id, chave)
);
CREATE INDEX IF NOT EXISTS va_etapas_projeto_ordem ON va_projeto_etapas (projeto_id, ordem);

-- 3) va_projeto_kickoff --------------------------------------------
CREATE TABLE IF NOT EXISTS va_projeto_kickoff (
  projeto_id uuid PRIMARY KEY REFERENCES va_projetos(id) ON DELETE CASCADE,
  historia text,
  q_ausencia text,
  q_cliente text,
  q_diferente text,
  financeiro text,
  comercial text,
  operacional text,
  juridico text,
  observacoes text,
  itens jsonb NOT NULL DEFAULT '{}'::jsonb,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- 4) va_projeto_blacklist ------------------------------------------
CREATE TABLE IF NOT EXISTS va_projeto_blacklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  nome text,
  cnpj text,
  telefone text,
  motivo text,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS va_blacklist_projeto ON va_projeto_blacklist (projeto_id);

-- 5) va_projeto_parcelas -------------------------------------------
CREATE TABLE IF NOT EXISTS va_projeto_parcelas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  numero int NOT NULL,
  vencimento date NOT NULL,
  valor numeric(12,2) NOT NULL,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','pago','atrasado','cancelado')),
  pago_em date,
  observacao text,
  asaas_cobranca_id text,
  UNIQUE (projeto_id, numero)
);

-- ─── trigger touch atualizado_em ──────────────────────────────────
CREATE OR REPLACE FUNCTION va_touch_atualizado_em()
RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS va_projetos_touch ON va_projetos;
CREATE TRIGGER va_projetos_touch
  BEFORE UPDATE ON va_projetos
  FOR EACH ROW EXECUTE FUNCTION va_touch_atualizado_em();

DROP TRIGGER IF EXISTS va_kickoff_touch ON va_projeto_kickoff;
CREATE TRIGGER va_kickoff_touch
  BEFORE UPDATE ON va_projeto_kickoff
  FOR EACH ROW EXECUTE FUNCTION va_touch_atualizado_em();

-- ─── trigger va_gerar_setup ───────────────────────────────────────
CREATE OR REPLACE FUNCTION va_gerar_setup()
RETURNS TRIGGER AS $$
DECLARE
  n int;
BEGIN
  -- 1) 15 etapas
  INSERT INTO va_projeto_etapas (projeto_id, chave, titulo, ordem, offset_dias, responsavel, data_prevista)
  SELECT NEW.id, chave, titulo, ordem, offset_dias, responsavel,
         NEW.data_inicio + (offset_dias || ' days')::interval
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

  -- 2) fidelidade_meses parcelas
  IF NEW.valor_mensal IS NOT NULL AND NEW.fidelidade_meses > 0 THEN
    FOR n IN 1..NEW.fidelidade_meses LOOP
      INSERT INTO va_projeto_parcelas (projeto_id, numero, vencimento, valor)
      VALUES (
        NEW.id,
        n,
        NEW.data_inicio + ((n - 1) || ' months')::interval,
        NEW.valor_mensal
      );
    END LOOP;
  END IF;

  -- 3) linha vazia de kickoff
  INSERT INTO va_projeto_kickoff (projeto_id) VALUES (NEW.id)
  ON CONFLICT (projeto_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS va_projetos_setup ON va_projetos;
CREATE TRIGGER va_projetos_setup
  AFTER INSERT ON va_projetos
  FOR EACH ROW EXECUTE FUNCTION va_gerar_setup();

-- ─── VIEW va_projetos_resumo ──────────────────────────────────────
CREATE OR REPLACE VIEW va_projetos_resumo AS
SELECT
  p.*,
  COALESCE(e.total, 0) AS etapas_total,
  COALESCE(e.ok, 0)    AS etapas_ok,
  COALESCE(pa.total_pago, 0) AS total_pago,
  COALESCE(pa.total_pago, 0) * 0.5 AS credito_liberado,
  (p.data_inicio + (p.fidelidade_meses || ' months')::interval)::date AS fim_da_onda,
  (CURRENT_DATE - p.data_inicio) AS dia_atual
FROM va_projetos p
LEFT JOIN (
  SELECT projeto_id,
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE status='concluida') AS ok
  FROM va_projeto_etapas GROUP BY projeto_id
) e ON e.projeto_id = p.id
LEFT JOIN (
  SELECT projeto_id, SUM(valor) AS total_pago
  FROM va_projeto_parcelas WHERE status='pago' GROUP BY projeto_id
) pa ON pa.projeto_id = p.id;

-- ─── RLS ───────────────────────────────────────────────────────────
ALTER TABLE va_projetos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE va_projeto_etapas     ENABLE ROW LEVEL SECURITY;
ALTER TABLE va_projeto_kickoff    ENABLE ROW LEVEL SECURITY;
ALTER TABLE va_projeto_blacklist  ENABLE ROW LEVEL SECURITY;
ALTER TABLE va_projeto_parcelas   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS va_projetos_auth          ON va_projetos;
DROP POLICY IF EXISTS va_projeto_etapas_auth    ON va_projeto_etapas;
DROP POLICY IF EXISTS va_projeto_kickoff_auth   ON va_projeto_kickoff;
DROP POLICY IF EXISTS va_projeto_blacklist_auth ON va_projeto_blacklist;
DROP POLICY IF EXISTS va_projeto_parcelas_auth  ON va_projeto_parcelas;

CREATE POLICY va_projetos_auth          ON va_projetos          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY va_projeto_etapas_auth    ON va_projeto_etapas    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY va_projeto_kickoff_auth   ON va_projeto_kickoff   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY va_projeto_blacklist_auth ON va_projeto_blacklist FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY va_projeto_parcelas_auth  ON va_projeto_parcelas  FOR ALL TO authenticated USING (true) WITH CHECK (true);
