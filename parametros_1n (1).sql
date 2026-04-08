-- =====================================================
-- TABELA parametros_1n
-- 1Negócio · Parâmetros centralizados de avaliação
-- Criado em 08/04/2026
-- =====================================================

CREATE TABLE IF NOT EXISTS parametros_1n (
  id          TEXT PRIMARY KEY,
  categoria   TEXT NOT NULL,
  descricao   TEXT,
  valor       JSONB NOT NULL,
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: somente admin lê e escreve
ALTER TABLE parametros_1n ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Leitura publica parametros"
  ON parametros_1n FOR SELECT
  USING (true);

CREATE POLICY "Escrita somente admin"
  ON parametros_1n FOR ALL
  USING (auth.role() = 'service_role');

-- =====================================================
-- INSERÇÃO DOS VALORES INICIAIS
-- =====================================================

-- 1. MÚLTIPLOS BASE por modelo de negócio
INSERT INTO parametros_1n (id, categoria, descricao, valor) VALUES (
  'multiplos_base',
  'valuation',
  'Múltiplo base por modelo de negócio (T05)',
  '{
    "saas": 2.52,
    "assinatura": 2.33,
    "vende_governo": 2.52,
    "distribuicao": 2.44,
    "presta_servico": 1.61,
    "revenda": 1.49,
    "fabricacao": 1.56,
    "produz_revende": 1.95
  }'::jsonb
) ON CONFLICT (id) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = NOW();

-- 2. MODIFICADORES por setor
INSERT INTO parametros_1n (id, categoria, descricao, valor) VALUES (
  'modificadores_setor',
  'valuation',
  'Modificador setorial aplicado ao múltiplo base (T03)',
  '{
    "servicos_b2b": 0.5,
    "educacao": 0.5,
    "saude": 0.5,
    "beleza_estetica": 0.3,
    "academia": 0.2,
    "alimentacao": 0.1,
    "varejo": 0.0,
    "hospedagem": 0.0,
    "outros_servicos": 0.0,
    "logistica": -0.3,
    "industria": -0.3,
    "construcao": -0.5
  }'::jsonb
) ON CONFLICT (id) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = NOW();

-- 3. FATOR ISE por faixa
INSERT INTO parametros_1n (id, categoria, descricao, valor) VALUES (
  'fator_ise',
  'valuation',
  'Multiplicador do Fator 1N baseado no ISE total',
  '[
    {"min": 85, "max": 100, "fator": 1.30, "nome": "Estruturado"},
    {"min": 70, "max": 84,  "fator": 1.15, "nome": "Consolidado"},
    {"min": 50, "max": 69,  "fator": 1.00, "nome": "Operacional"},
    {"min": 35, "max": 49,  "fator": 0.85, "nome": "Dependente"},
    {"min": 0,  "max": 34,  "fator": 0.70, "nome": "Embrionário"}
  ]'::jsonb
) ON CONFLICT (id) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = NOW();

-- 4. PESOS ISE — 10 pilares
INSERT INTO parametros_1n (id, categoria, descricao, valor) VALUES (
  'pesos_ise',
  'ise',
  'Peso de cada pilar no cálculo do ISE total (soma = 1.0)',
  '{
    "p1_dependencia":    0.09,
    "p2_comercial":      0.22,
    "p3_financeiro":     0.18,
    "p4_gestao":         0.15,
    "p5_marca":          0.05,
    "p6_balanco":        0.08,
    "p7_divida":         0.05,
    "p8_risco":          0.05,
    "p9_concentracao":   0.08,
    "p10_escalabilidade":0.05
  }'::jsonb
) ON CONFLICT (id) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = NOW();

-- 5. REGRAS ISE — notas dos pilares qualitativos
INSERT INTO parametros_1n (id, categoria, descricao, valor) VALUES (
  'regras_ise',
  'ise',
  'Regras de pontuação dos pilares qualitativos do ISE',
  '{
    "p1_dependencia": {
      "total": 1, "parcial": 5, "nenhuma": 8, "default": 5
    },
    "p3_financeiro": {
      "margem_25_mais": 9, "margem_15_24": 7, "margem_8_14": 5, "margem_menor_8": 3
    },
    "p4_gestao": {
      "documentados": 8, "parcial": 5, "nao": 2, "default": 5
    },
    "p5_marca": {
      "sim": 8, "processo": 6, "nao": 4, "default": 4
    },
    "p6_balanco": {
      "pl_maior_2x_ro": 10, "pl_maior_1x_ro": 8, "pl_positivo": 6,
      "pl_negativo_ate_1x": 4, "pl_negativo_ate_2x": 2, "pl_negativo_mais_2x": 0
    },
    "p7_divida": {
      "zero": 10, "ate_10pct": 9, "ate_20pct": 7,
      "ate_35pct": 5, "ate_50pct": 3, "acima_50pct": 1
    },
    "p8_risco": {
      "sem_passivo": 8, "com_passivo": 3, "default": 8
    },
    "p9_concentracao": {
      "ate_5pct": 10, "ate_15pct": 8, "ate_25pct": 6,
      "ate_40pct": 4, "ate_60pct": 2, "acima_60pct": 0,
      "default": 8
    },
    "p10_escalabilidade": {
      "zero": 5,
      "ate_20pct": 6, "ate_40pct": 7, "ate_60pct": 8,
      "ate_80pct": 9, "acima_80pct": 10,
      "default": 5
    }
  }'::jsonb
) ON CONFLICT (id) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = NOW();

-- 6. BENCHMARKS DRE por setor (% sobre faturamento)
INSERT INTO parametros_1n (id, categoria, descricao, valor) VALUES (
  'benchmarks_dre',
  'benchmarks',
  'Benchmarks de DRE por setor (percentuais sobre faturamento)',
  '{
    "alimentacao":   {"imp":8,  "tax":6, "com":3, "cmv":42, "fol":22, "alu":10, "cf":8,  "ro":18, "marg":12},
    "saude":         {"imp":10, "tax":4, "com":3, "cmv":32, "fol":38, "alu":8,  "cf":8,  "ro":22, "marg":15},
    "beleza_estetica":{"imp":10,"tax":5, "com":3, "cmv":38, "fol":32, "alu":10, "cf":8,  "ro":18, "marg":12},
    "educacao":      {"imp":10, "tax":4, "com":3, "cmv":28, "fol":42, "alu":8,  "cf":9,  "ro":25, "marg":18},
    "varejo":        {"imp":10, "tax":5, "com":4, "cmv":62, "fol":14, "alu":10, "cf":6,  "ro":10, "marg":8},
    "academia":      {"imp":10, "tax":5, "com":2, "cmv":22, "fol":35, "alu":14, "cf":8,  "ro":18, "marg":12},
    "hospedagem":    {"imp":10, "tax":5, "com":3, "cmv":45, "fol":28, "alu":12, "cf":8,  "ro":15, "marg":10},
    "logistica":     {"imp":10, "tax":4, "com":3, "cmv":72, "fol":38, "alu":8,  "cf":8,  "ro":6,  "marg":5},
    "industria":     {"imp":9,  "tax":3, "com":3, "cmv":68, "fol":20, "alu":5,  "cf":10, "ro":10, "marg":8},
    "construcao":    {"imp":9,  "tax":3, "com":3, "cmv":78, "fol":22, "alu":3,  "cf":8,  "ro":8,  "marg":6},
    "servicos_b2b":  {"imp":12, "tax":4, "com":5, "cmv":32, "fol":42, "alu":5,  "cf":10, "ro":28, "marg":20},
    "outros_servicos":{"imp":10,"tax":5, "com":4, "cmv":48, "fol":30, "alu":8,  "cf":8,  "ro":15, "marg":10},
    "default":       {"imp":10, "tax":5, "com":4, "cmv":40, "fol":25, "alu":8,  "cf":8,  "ro":15, "marg":10}
  }'::jsonb
) ON CONFLICT (id) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = NOW();

-- 7. BENCHMARKS INDICADORES por setor
INSERT INTO parametros_1n (id, categoria, descricao, valor) VALUES (
  'benchmarks_indicadores',
  'benchmarks',
  'Benchmarks de indicadores implícitos por setor',
  '{
    "alimentacao":    {"margem_bruta":58, "margem_op":12, "conc_max":8,  "folha_pct":26, "aluguel_pct":10, "pmr":0,  "pmp":25},
    "saude":          {"margem_bruta":68, "margem_op":22, "conc_max":12, "folha_pct":38, "aluguel_pct":8,  "pmr":25, "pmp":30},
    "beleza_estetica":{"margem_bruta":62, "margem_op":18, "conc_max":8,  "folha_pct":32, "aluguel_pct":10, "pmr":0,  "pmp":30},
    "educacao":       {"margem_bruta":72, "margem_op":25, "conc_max":6,  "folha_pct":42, "aluguel_pct":8,  "pmr":10, "pmp":30},
    "varejo":         {"margem_bruta":38, "margem_op":10, "conc_max":5,  "folha_pct":14, "aluguel_pct":10, "pmr":25, "pmp":40},
    "academia":       {"margem_bruta":78, "margem_op":18, "conc_max":2,  "folha_pct":35, "aluguel_pct":14, "pmr":0,  "pmp":30},
    "hospedagem":     {"margem_bruta":55, "margem_op":15, "conc_max":8,  "folha_pct":28, "aluguel_pct":12, "pmr":0,  "pmp":30},
    "logistica":      {"margem_bruta":28, "margem_op":6,  "conc_max":20, "folha_pct":38, "aluguel_pct":8,  "pmr":30, "pmp":30},
    "industria":      {"margem_bruta":32, "margem_op":10, "conc_max":25, "folha_pct":20, "aluguel_pct":5,  "pmr":40, "pmp":35},
    "construcao":     {"margem_bruta":22, "margem_op":8,  "conc_max":35, "folha_pct":22, "aluguel_pct":3,  "pmr":55, "pmp":40},
    "servicos_b2b":   {"margem_bruta":68, "margem_op":28, "conc_max":18, "folha_pct":42, "aluguel_pct":5,  "pmr":28, "pmp":30},
    "outros_servicos":{"margem_bruta":52, "margem_op":15, "conc_max":12, "folha_pct":30, "aluguel_pct":8,  "pmr":12, "pmp":30},
    "default":        {"margem_bruta":50, "margem_op":15, "conc_max":15, "folha_pct":28, "aluguel_pct":8,  "pmr":15, "pmp":30}
  }'::jsonb
) ON CONFLICT (id) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = NOW();

-- 8. PESOS ATRATIVIDADE — 6 pilares
INSERT INTO parametros_1n (id, categoria, descricao, valor) VALUES (
  'pesos_atratividade',
  'atratividade',
  'Pesos dos 6 pilares do Índice de Atratividade (soma = 1.0)',
  '{
    "p1_ise_solidez":    0.17,
    "p2_setor":          0.17,
    "p3_recorrencia":    0.17,
    "p4_independencia":  0.17,
    "p5_crescimento":    0.17,
    "p6_margem":         0.15
  }'::jsonb
) ON CONFLICT (id) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = NOW();

-- 9. SCORE SETOR atratividade (4 estágios: 5 a 8)
INSERT INTO parametros_1n (id, categoria, descricao, valor) VALUES (
  'score_setor_atratividade',
  'atratividade',
  'Nota de atratividade por setor (5=baixa, 6=média, 7=boa, 8=alta)',
  '{
    "saude": 8,
    "educacao": 8,
    "servicos_b2b": 8,
    "beleza_estetica": 7,
    "academia": 7,
    "hospedagem": 7,
    "alimentacao": 6,
    "outros_servicos": 6,
    "varejo": 5,
    "industria": 5,
    "logistica": 5,
    "construcao": 5,
    "default": 6
  }'::jsonb
) ON CONFLICT (id) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = NOW();

-- 10. MAPEAMENTO SETOR — texto livre → código T03
INSERT INTO parametros_1n (id, categoria, descricao, valor) VALUES (
  'mapeamento_setor',
  'config',
  'Mapeamento de texto livre do setor para código T03',
  '{
    "restaurante": "alimentacao", "bar": "alimentacao", "cafe": "alimentacao",
    "padaria": "alimentacao", "pizzaria": "alimentacao", "lanchonete": "alimentacao",
    "cafeteria": "alimentacao", "food": "alimentacao", "delivery": "alimentacao",
    "alimentacao": "alimentacao",
    "saude": "saude", "clinica": "saude", "medic": "saude", "odonto": "saude",
    "fisio": "saude", "nutri": "saude", "psico": "saude", "farma": "saude",
    "educacao": "educacao", "escola": "educacao", "curso": "educacao",
    "treinamento": "educacao", "idioma": "educacao", "creche": "educacao",
    "beleza": "beleza_estetica", "estetica": "beleza_estetica", "salao": "beleza_estetica",
    "barbearia": "beleza_estetica", "spa": "beleza_estetica", "cabeleir": "beleza_estetica",
    "academia": "academia", "crossfit": "academia", "pilates": "academia", "fitness": "academia",
    "varejo": "varejo", "loja": "varejo", "comercio": "varejo", "ecommerce": "varejo",
    "pet": "varejo", "otica": "varejo", "moda": "varejo",
    "hotel": "hospedagem", "pousada": "hospedagem", "hostel": "hospedagem", "airbnb": "hospedagem",
    "logistica": "logistica", "transporte": "logistica", "frete": "logistica",
    "industria": "industria", "fabrica": "industria", "manufat": "industria",
    "construcao": "construcao", "obra": "construcao", "engenharia": "construcao",
    "b2b": "servicos_b2b", "consultoria": "servicos_b2b", "agencia": "servicos_b2b",
    "tecnologia": "servicos_b2b", "software": "servicos_b2b", "ti": "servicos_b2b",
    "contabilidade": "servicos_b2b", "advocacia": "servicos_b2b", "saas": "servicos_b2b"
  }'::jsonb
) ON CONFLICT (id) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = NOW();

-- 11. MAPEAMENTO MODELO — texto livre → código T05
INSERT INTO parametros_1n (id, categoria, descricao, valor) VALUES (
  'mapeamento_modelo',
  'config',
  'Mapeamento de modelo de negócio para código T05',
  '{
    "saas": "saas_plataforma", "plataforma": "saas_plataforma", "software": "saas_plataforma",
    "assinatura": "assinatura", "recorr": "assinatura",
    "governo": "governo", "licita": "governo", "licitacao": "governo",
    "distribui": "distribuicao",
    "revenda": "revenda", "comercio": "revenda",
    "fabric": "fabricacao", "industria": "fabricacao",
    "producao": "producao_direta", "artesanal": "producao_direta",
    "restaurante": "producao_direta", "alimenta": "producao_direta", "bar": "producao_direta"
  }'::jsonb
) ON CONFLICT (id) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = NOW();

-- 12. LIMITES GLOBAIS
INSERT INTO parametros_1n (id, categoria, descricao, valor) VALUES (
  'limites_globais',
  'config',
  'Limites mínimos e máximos aplicados nos cálculos',
  '{
    "fator_min": 1.5,
    "fator_max": 6.0,
    "ise_min": 0,
    "ise_max": 100,
    "ise_trava_criticos": 40,
    "pilares_criticos_para_trava": 2,
    "nota_critico_abaixo_de": 3,
    "atratividade_min": 0,
    "atratividade_max": 10
  }'::jsonb
) ON CONFLICT (id) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = NOW();

-- 13. ICD — campos que contam como informados
INSERT INTO parametros_1n (id, categoria, descricao, valor) VALUES (
  'icd_campos',
  'icd',
  'Campos que contam como informados pelo usuário no ICD',
  '{
    "informados": [
      "fat_mensal", "regime", "meios_recebimento", "cmv_pct",
      "clt_folha", "aluguel", "prolabore", "clientes_ativos",
      "recorrencia_pct", "processos", "saldo_devedor"
    ],
    "estimados": [
      "at_caixa", "at_cr", "taxas_recebimento", "impostos_calculados"
    ]
  }'::jsonb
) ON CONFLICT (id) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = NOW();

-- =====================================================
-- VERIFICAÇÃO
-- =====================================================
SELECT id, categoria, descricao FROM parametros_1n ORDER BY categoria, id;
