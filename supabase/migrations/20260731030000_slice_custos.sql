-- ═══════════════════════════════════════════════════════════════════
-- SLICE · Modelo de custos completo
-- ═══════════════════════════════════════════════════════════════════
-- Regra: preço = custo × 3. Exceção: impulsionamento repasse × 1,5 (mídia, não trabalho nosso).
-- Impostos 15% do valor pago = apropriação (não debitável).
-- Reprecifica va_precos mas NÃO recalcula lançamentos já em va_projeto_razao (preço congelado).

CREATE TABLE IF NOT EXISTS va_pilares_piso (
  pilar text PRIMARY KEY CHECK (pilar IN ('impulsionamento','lead')),
  piso_mensal numeric(12,2), provedor text, observacao text,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
INSERT INTO va_pilares_piso (pilar, piso_mensal, provedor, observacao)
VALUES ('impulsionamento', 450.00, 'meta', 'R$ 15/dia × 30 dias · mínimo Meta Ads BR. UPDATE aqui se mudar.'),
       ('lead', 0, 'kipflow+maps', 'Sem piso mínimo · cobrado por resultado')
ON CONFLICT (pilar) DO UPDATE SET piso_mensal=EXCLUDED.piso_mensal, observacao=EXCLUDED.observacao;

-- Nova estrutura va_precos
INSERT INTO va_precos (tipo, rotulo, unidade, custo_real, preco, fornecedor, ativo, ordem, repassa_sem_margem) VALUES
  ('avaliacao_guiada',   'Avaliação guiada (vale 12 meses)',    'ativacao',  NULL,   588,  'interno', true, 11, false),
  ('setup_arquetipos',   'Setup de arquétipos (por bloco)',     'por bloco', NULL,   150,  'interno', true, 12, false),
  ('combo_criativos',    'Combo criativos (até 3 peças/onda)',  'por onda',  NULL,   100,  'interno', true, 13, false),
  ('setup_campanha',     'Setup de campanha (por onda)',        'por onda',  NULL,   100,  'interno', true, 14, false),
  ('anuncio_plataforma', 'Anúncio: home + parceiros + landing', 'mensal',    NULL,    30,  'interno', true, 15, false),
  ('lead_qualificado',   'Lead qualificado (custo x 3)',        'por lead',  0.50,  1.50,  'kipflow', true, 16, false),
  ('impulsionamento',    'Impulsionamento Meta (repasse × 1,5)','diaria',   10.00,  15.00, 'meta',    true, 17, false)
ON CONFLICT (tipo) DO UPDATE SET rotulo=EXCLUDED.rotulo, unidade=EXCLUDED.unidade, custo_real=EXCLUDED.custo_real,
  preco=EXCLUDED.preco, fornecedor=EXCLUDED.fornecedor, ordem=EXCLUDED.ordem;
UPDATE va_precos SET preco=1.00, rotulo='Disparo WhatsApp (arbitrado)' WHERE tipo='disparo_whatsapp';

-- Projeto: avaliação com validade 12m
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS avaliacao_paga_em date;
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS avaliacao_valida_ate date
  GENERATED ALWAYS AS (avaliacao_paga_em + INTERVAL '365 days') STORED;

-- Onda: setup consome verba, não prazo
ALTER TABLE va_projeto_ondas ADD COLUMN IF NOT EXISTS setup_dias int NOT NULL DEFAULT 10;
ALTER TABLE va_projeto_ondas ADD COLUMN IF NOT EXISTS setup_iniciado_em date;
ALTER TABLE va_projeto_ondas ADD COLUMN IF NOT EXISTS setup_concluido_em date;
ALTER TABLE va_projeto_ondas ADD COLUMN IF NOT EXISTS operacao_inicio date;
ALTER TABLE va_projeto_ondas ADD COLUMN IF NOT EXISTS motivo_atraso_setup text;

CREATE TABLE IF NOT EXISTS va_projeto_alocacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  onda_id uuid REFERENCES va_projeto_ondas(id) ON DELETE CASCADE,
  ciclo_numero int,
  percent_impulsionamento numeric(5,2) NOT NULL,
  percent_lead numeric(5,2) NOT NULL,
  origem text NOT NULL CHECK (origem IN ('inicial','sugerida','manual')),
  base_calculo jsonb, aplicada boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS va_onda_balanco (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  onda_id uuid NOT NULL REFERENCES va_projeto_ondas(id) ON DELETE CASCADE UNIQUE,
  payload jsonb NOT NULL, alocacao_sugerida jsonb,
  criado_em timestamptz NOT NULL DEFAULT now()
);

-- RPC va_simular_orcamento(valor, meses, projeto_id?) → jsonb completo
-- RPC va_alocacao_sugerir(onda_id) → jsonb com sugestão baseado em CPI
-- RPC va_gerar_balanco_onda(onda_id) → congela balanço + sugere alocação
-- (Definições completas aplicadas via MCP)

-- View cliente: nunca vaza custo real / ID Meta
-- va_cliente_investimento inclui 'impulsionamento' na frente 'Mídia paga'
--   agrupa por 'Prospecção ativa', 'Abordagem direta', 'Mídia paga', 'Produção e publicação', 'Gestão'
--   expõe SÓ valor_total (preço cobrado), nunca custo_unitario_aplicado nem fornecedor
