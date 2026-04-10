-- ═══════════════════════════════════════════════════════════════
-- SEED: 1 negócio real fictício para teste da home 1Negócio
-- Colar no Supabase SQL Editor e executar
-- ═══════════════════════════════════════════════════════════════

INSERT INTO negocios (
  codigo, titulo_anuncio, categoria, cidade, estado,
  faturamento_anual, margem_ebitda, resultado_liquido_mensal,
  score_saude, valor_1n, preco_pedido, patrimonio_liquido,
  recorrencia_pct, anos_existencia, num_funcionarios,
  modelo_negocio, descricao,
  crescimento_status, notas_admin,
  upsides_json, avaliacao_finalizada_em,
  status, vendedor_id,
  plano, comissao_pct
)
VALUES (
  '1N-0001',
  'Clínica de Estética e Bem-Estar Consolidada em Florianópolis',
  'Saúde & Estética',
  'Florianópolis', 'SC',

  -- Financeiro
  1200000,   -- faturamento_anual: R$ 1,2M
  28,        -- margem_ebitda: 28%
  28000,     -- resultado_liquido_mensal: R$ 28k/mês

  -- Avaliação
  74,        -- score_saude ISE: 74/100
  480000,    -- valor_1n (avaliação DCF): R$ 480k
  390000,    -- preco_pedido: R$ 390k (19% abaixo da avaliação)
  220000,    -- patrimonio_liquido: R$ 220k

  -- Operacional
  35,        -- recorrencia_pct: 35% (mensalidades de pacotes)
  8,         -- anos_existencia: 8 anos
  6,         -- num_funcionarios: 6 (3 esteticistas, 1 recepcionista, 1 gerente, 1 sócia)

  'b2c',
  'Clínica de estética com 8 anos de operação em Florianópolis/SC. '
  'Especializada em procedimentos faciais e corporais de alta performance. '
  'Base de clientes fidelizada com 35% de receita recorrente via pacotes mensais. '
  'Localização privilegiada no bairro Itacorubi, próxima a condomínios residenciais de alto padrão.',

  'crescendo',

  -- Notas do admin (aparecem na aba 1N)
  'Negócio sólido com clientela fidelizada e localização estratégica. ISE 74 reflete leve dependência da sócia fundadora — oportunidade de profissionalizar com gerente contratado. Preço pedido 19% abaixo da avaliação 1N: excelente entrada para comprador do setor.',

  -- Upsides JSON
  '[
    {"titulo": "Expansão para procedimentos estéticos avançados", "ganho_mensal": 18000, "descricao": "Adição de laser CO2 fracionado e radiofrequência — equipamentos com payback de 8 meses e ticket médio 3x maior."},
    {"titulo": "Programa de fidelidade e pacotes anuais", "ganho_mensal": 9000, "descricao": "Migrar 20% da base atual para contratos anuais aumenta recorrência de 35% para 55% e reduz churn."},
    {"titulo": "B2B com empresas da região", "ganho_mensal": 6000, "descricao": "Convênios corporativos com empresas do Sapiens Parque e Iguatemi — perfil de cliente de alta renda já atendido."}
  ]'::jsonb,

  NOW() - INTERVAL '15 days',  -- avaliacao_finalizada_em

  'publicado',

  -- Vendedor: usar o usuário vendedor de teste
  (SELECT id FROM auth.users WHERE email = 'thiago.usuario@1negocio.com.br' LIMIT 1),

  'guiado',
  5
);

-- ═══════════════════════════════════════════════════════════════
-- VERIFICAR SE INSERIU:
-- SELECT codigo, titulo_anuncio, preco_pedido, score_saude, status FROM negocios WHERE codigo = '1N-0001';
-- ═══════════════════════════════════════════════════════════════
