-- ═══════════════════════════════════════════════════════════════════
-- VENDA ASSESSORADA · SLICE 4 · crédito, plano da onda, razão, parcelas
-- Aditivo · não altera nenhuma tabela existente
-- ═══════════════════════════════════════════════════════════════════

-- 1) va_precos · catálogo global de preços ────────────────────────
CREATE TABLE IF NOT EXISTS va_precos (
  tipo text PRIMARY KEY,
  rotulo text NOT NULL,
  unidade text NOT NULL,
  custo_real numeric(10,2) DEFAULT 0,
  preco numeric(10,2) DEFAULT 0,
  repassa_sem_margem boolean DEFAULT false,
  ordem int,
  ativo boolean DEFAULT true
);

INSERT INTO va_precos (tipo, rotulo, unidade, custo_real, preco, repassa_sem_margem, ordem, ativo) VALUES
('avaliacao_guiada',       'Avaliação guiada',              'ativacao', 0,    0,    false, 1,  true),
('laudo',                  'Geração do laudo',              'ativacao', 0,    0,    false, 2,  true),
('teaser',                 'Geração do teaser',             'ativacao', 0,    0,    false, 3,  true),
('setup_arquetipos',       'Setup da matriz de arquétipos', 'ativacao', 0,    0,    false, 4,  true),
('criativo_estatico',      'Criativo estático',             'unidade',  0,    0,    false, 5,  true),
('criativo_video',         'Criativo em vídeo',             'unidade',  0,    0,    false, 6,  true),
('setup_campanha',         'Setup de campanha',             'ativacao', 0,    0,    false, 7,  true),
('lead_scrapper',          'Lead prospectado e enriquecido','unidade',  1.50, 3.00, false, 8,  true),
('disparo_whatsapp',       'Disparo WhatsApp entregue',     'unidade',  1.00, 2.00, false, 9,  true),
('midia_meta',             'Verba de mídia (repasse)',      'repasse',  0,    0,    true,  10, true),
('matchmaking',            'Rodada de matchmaking',         'unidade',  0,    0,    false, 11, true),
('distribuicao_parceiros', 'Distribuição a parceiros',      'ativacao', 0,    0,    false, 12, true),
('nda_gerado',             'Termo de confidencialidade',    'unidade',  0,    0,    false, 13, true),
('gestao_mensal',          'Taxa de gestão',                'mensal',   0,    0,    false, 14, true),
('ajuste_manual',          'Ajuste manual',                 'unidade',  0,    0,    false, 15, true)
ON CONFLICT (tipo) DO UPDATE SET
  rotulo=EXCLUDED.rotulo, unidade=EXCLUDED.unidade,
  repassa_sem_margem=EXCLUDED.repassa_sem_margem,
  ordem=EXCLUDED.ordem, ativo=EXCLUDED.ativo;

-- 2) va_projeto_plano · previsto ──────────────────────────────────
CREATE TABLE IF NOT EXISTS va_projeto_plano (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  tipo text NOT NULL REFERENCES va_precos(tipo),
  natureza text NOT NULL CHECK (natureza IN ('ativacao','recorrente')),
  meta_quantidade numeric(10,2) NOT NULL DEFAULT 0,
  preco_unitario_previsto numeric(10,2) NOT NULL,
  valor_previsto numeric(12,2) NOT NULL,
  observacao text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (projeto_id, tipo)
);
CREATE INDEX IF NOT EXISTS va_plano_projeto ON va_projeto_plano (projeto_id);

-- 3) va_projeto_razao · realizado (histórico imutável) ────────────
CREATE TABLE IF NOT EXISTS va_projeto_razao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  tipo text NOT NULL REFERENCES va_precos(tipo),
  quantidade numeric(10,2) NOT NULL DEFAULT 1,
  preco_unitario_aplicado numeric(10,2) NOT NULL,
  valor_total numeric(12,2) NOT NULL,
  referencia text,
  ciclo_numero int,
  data date NOT NULL DEFAULT CURRENT_DATE,
  origem_tabela text,
  origem_id uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS va_razao_proj_data  ON va_projeto_razao (projeto_id, data DESC);
CREATE INDEX IF NOT EXISTS va_razao_proj_tipo  ON va_projeto_razao (projeto_id, tipo);
CREATE INDEX IF NOT EXISTS va_razao_proj_ciclo ON va_projeto_razao (projeto_id, ciclo_numero);

-- 4) FUNÇÃO va_debitar ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION va_debitar(
  p_projeto uuid,
  p_tipo text,
  p_qtd numeric,
  p_referencia text,
  p_ciclo int DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
  v_preco numeric;
  v_total numeric;
  v_ciclo int;
  v_data_inicio date;
  v_id uuid;
  v_meses numeric;
BEGIN
  SELECT preco INTO v_preco FROM va_precos WHERE tipo = p_tipo AND ativo = true;
  IF v_preco IS NULL THEN
    RAISE EXCEPTION 'tipo % não encontrado ou inativo em va_precos', p_tipo;
  END IF;

  v_total := p_qtd * v_preco;

  IF p_ciclo IS NULL THEN
    SELECT data_inicio INTO v_data_inicio FROM va_projetos WHERE id = p_projeto;
    IF v_data_inicio IS NULL THEN
      RAISE EXCEPTION 'projeto % não encontrado', p_projeto;
    END IF;
    -- meses decorridos (contínuo): diferença em dias / 30
    v_meses := GREATEST((CURRENT_DATE - v_data_inicio)::numeric / 30.0, 0);
    v_ciclo := floor(v_meses)::int + 1;
  ELSE
    v_ciclo := p_ciclo;
  END IF;

  INSERT INTO va_projeto_razao
    (projeto_id, tipo, quantidade, preco_unitario_aplicado, valor_total, referencia, ciclo_numero, data)
  VALUES
    (p_projeto, p_tipo, p_qtd, v_preco, v_total, p_referencia, v_ciclo, CURRENT_DATE)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- 5) FUNÇÃO va_lancar_gestao (idempotente por ciclo) ─────────────
CREATE OR REPLACE FUNCTION va_lancar_gestao(
  p_projeto uuid,
  p_ciclo int
) RETURNS uuid AS $$
DECLARE
  v_existente uuid;
  v_id uuid;
BEGIN
  SELECT id INTO v_existente
  FROM va_projeto_razao
  WHERE projeto_id = p_projeto
    AND tipo = 'gestao_mensal'
    AND ciclo_numero = p_ciclo
  LIMIT 1;

  IF v_existente IS NOT NULL THEN
    RETURN v_existente;
  END IF;

  v_id := va_debitar(p_projeto, 'gestao_mensal', 1, 'Taxa de gestão · ciclo ' || p_ciclo, p_ciclo);
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- 6) VIEW va_projeto_financeiro ───────────────────────────────────
CREATE OR REPLACE VIEW va_projeto_financeiro AS
WITH pg AS (
  SELECT projeto_id, SUM(valor) AS total, COUNT(*) AS qtd
  FROM va_projeto_parcelas WHERE status='pago' GROUP BY projeto_id
),
cg AS (
  SELECT projeto_id, SUM(valor_total) AS total
  FROM va_projeto_razao GROUP BY projeto_id
),
pl AS (
  SELECT projeto_id, SUM(valor_previsto) AS total
  FROM va_projeto_plano GROUP BY projeto_id
)
SELECT
  p.id AS projeto_id,
  p.valor_mensal,
  p.fidelidade_meses,
  p.data_inicio,
  (COALESCE(p.valor_mensal,0) * COALESCE(p.fidelidade_meses,0))::numeric(14,2) AS contrato_total,
  COALESCE(pg.total, 0)::numeric(14,2) AS total_pago,
  COALESCE(pg.qtd,   0) AS parcelas_pagas,
  (COALESCE(pg.total, 0) * 0.5)::numeric(14,2) AS credito_liberado,
  (COALESCE(pg.total, 0) * 0.2)::numeric(14,2) AS apropriacao_impostos,
  (COALESCE(pg.total, 0) * 0.3)::numeric(14,2) AS apropriacao_gestao,
  COALESCE(cg.total, 0)::numeric(14,2) AS consumido,
  (COALESCE(pg.total, 0) * 0.5 - COALESCE(cg.total, 0))::numeric(14,2) AS saldo,
  COALESCE(pl.total, 0)::numeric(14,2) AS previsto_onda,
  (p.fidelidade_meses * 30) AS dias_onda,
  GREATEST(CURRENT_DATE - p.data_inicio, 0) AS dias_decorridos,
  (COALESCE(pg.total, 0) * 0.5 * LEAST(
      GREATEST(CURRENT_DATE - p.data_inicio, 0)::numeric / NULLIF(p.fidelidade_meses * 30, 0),
      1
  ))::numeric(14,2) AS consumo_esperado,
  ((COALESCE(pg.total, 0) * 0.5 * LEAST(
      GREATEST(CURRENT_DATE - p.data_inicio, 0)::numeric / NULLIF(p.fidelidade_meses * 30, 0),
      1
  )) - COALESCE(cg.total, 0))::numeric(14,2) AS desvio_ritmo,
  ((COALESCE(pg.total, 0) * 0.5 - COALESCE(cg.total, 0))
    / GREATEST(p.fidelidade_meses * 30 - GREATEST(CURRENT_DATE - p.data_inicio, 0), 1)
  )::numeric(14,2) AS ritmo_alvo_diario
FROM va_projetos p
LEFT JOIN pg ON pg.projeto_id = p.id
LEFT JOIN cg ON cg.projeto_id = p.id
LEFT JOIN pl ON pl.projeto_id = p.id;

-- 7) RLS ──────────────────────────────────────────────────────────
ALTER TABLE va_precos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE va_projeto_plano   ENABLE ROW LEVEL SECURITY;
ALTER TABLE va_projeto_razao   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS va_precos_read   ON va_precos;
DROP POLICY IF EXISTS va_precos_update ON va_precos;
DROP POLICY IF EXISTS va_plano_auth    ON va_projeto_plano;
DROP POLICY IF EXISTS va_razao_auth    ON va_projeto_razao;

CREATE POLICY va_precos_read   ON va_precos          FOR SELECT TO authenticated USING (true);
CREATE POLICY va_precos_update ON va_precos          FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY va_plano_auth    ON va_projeto_plano   FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY va_razao_auth    ON va_projeto_razao   FOR ALL    TO authenticated USING (true) WITH CHECK (true);
