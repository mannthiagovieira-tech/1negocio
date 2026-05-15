-- Bloco SQL #6: Snapshot v2026.05 — refactor de upsides + caps + pesos ISE
-- (Fase 3 pós-auditoria 585e9a0)
--
-- Mudanças vs v2026.04:
--   1. Inativa v2026.04
--   2. Insere v2026.05 derivado de v2026.04 + adições:
--      - caps_categoria   (ro/passivo/multiplo)
--      - caps_ise         (5 faixas)
--      - cap_absoluto     (0.80)
--      - tributario_dominante_threshold (0.40)
--      - fator_max_sobre_benchmark      (1.30)
--      - pesos_sub_metricas_ise         (28 pesos migrados — P8 sem presenca_digital)
--      - upsides_catalogo               (21 entries)
--      - _meta                          (versão / descrição / origem)
--
-- Nota sobre gates: as expressões em upsides_catalogo[i].gate.expressao são
-- strings JS avaliadas em runtime pelo gerarUpsidesV2 refatorado (commit 2).
-- Variáveis disponíveis no escopo do evaluator: D, dre, balanco, ise,
-- indicadores, valuation, analise_tributaria, P, setor, n.
--
-- Idempotência: se v2026.05 já existir, este script falha no INSERT — recriação
-- exige DELETE manual.

-- ============================================================
-- Step 1: inativa snapshot anterior
-- ============================================================
UPDATE parametros_versoes SET ativo = false WHERE id = 'v2026.04';

-- ============================================================
-- Step 2: insere v2026.05 derivado de v2026.04 + adições do refactor
-- ============================================================
INSERT INTO parametros_versoes (id, ativo, criado_por, snapshot)
SELECT
  'v2026.05',
  true,
  'thiago',
  jsonb_set(snapshot, '{_meta}',
    $json${"versao":"v2026.05","criado_em":"2026-04-28","descricao":"Refactor: catálogo de upsides + caps + pesos ISE migrados + ajustes P8 (auditoria 585e9a0)","derivado_de":"v2026.04"}$json$::jsonb,
    true)
  -- ── caps por categoria (não se aplica a tributário) ──
  || $json${"caps_categoria":{"ro":0.30,"passivo":0.25,"multiplo":0.25}}$json$::jsonb
  -- ── caps por faixa de ISE (aplicado APENAS sobre alavancas, não sobre tributário) ──
  || $json${"caps_ise":[{"ise_min":0,"ise_max":39,"cap":0.20},{"ise_min":40,"ise_max":59,"cap":0.35},{"ise_min":60,"ise_max":74,"cap":0.50},{"ise_min":75,"ise_max":89,"cap":0.65},{"ise_min":90,"ise_max":100,"cap":0.80}]}$json$::jsonb
  -- ── cap absoluto (defesa final pós-ISE+tributário) ──
  || $json${"cap_absoluto":0.80}$json$::jsonb
  -- ── threshold pra flag tributario_dominante ──
  || $json${"tributario_dominante_threshold":0.40}$json$::jsonb
  -- ── fator_max_sobre_benchmark (ratio acima do qual gates RO disparam) ──
  || $json${"fator_max_sobre_benchmark":1.30}$json$::jsonb
  -- ── pesos das sub-métricas do ISE (28 pesos migrados do código) ──
  -- P8 ajustado: presenca_digital removida (sempre score 0 por bug — campo nunca
  -- coletado pelo diagnóstico). Restantes redistribuídos 50/50.
  || $json${"pesos_sub_metricas_ise":{
       "p1_financeiro":{"margem_op_pct":0.25,"dre_separacao":0.25,"fluxo_caixa_positivo":0.25,"contabilidade_formal":0.25},
       "p2_resultado":{"ebitda_real":0.50,"margem_estavel":0.30,"rentabilidade_imobilizado":0.20},
       "p3_comercial":{"num_clientes":0.25,"recorrencia_pct":0.25,"concentracao_pct":0.25,"base_clientes_documentada":0.25},
       "p4_gestao":{"processos_documentados":0.333333,"tem_gestor":0.333333,"sistemas_implantados":0.333334},
       "p5_socio_dependencia":{"opera_sem_dono":0.333333,"equipe_permanece":0.333333,"prolabore_documentado":0.333334},
       "p6_risco_legal":{"sem_passivo_trabalhista":0.25,"sem_acao_judicial":0.25,"impostos_em_dia":0.25,"sem_impostos_atrasados":0.25},
       "p7_balanco":{"patrimonio_positivo":0.333333,"liquidez":0.333333,"ncg_saudavel":0.333334},
       "p8_marca":{"marca_inpi":0.50,"reputacao":0.50}
     }}$json$::jsonb
  -- ── catálogo de upsides (21 entries) ──
  -- Categorias: tributario, ro, passivo, multiplo, qualitativo, paywall
  -- formula_calculo.tipo:
  --   ro_direto, ro_via_margem, multiplo_aumento,
  --   passivo_direto, passivo_estimado, tributario_calculado,
  --   qualitativo_sem_calculo, paywall_display
  -- Notas de naming: o briefing menciona "indicadores.margem_bruta_pct.valor",
  -- mas a chave real em calc_json.indicadores_vs_benchmark é "margem_bruta"
  -- (sem _pct). Gates usam o nome real.
  || $json${"upsides_catalogo":[
    {
      "id":"tr_otimizar_tributario",
      "categoria":"tributario",
      "label":"Regularizar e otimizar tributário",
      "descricao":"Migração para regime ótimo elegível + regularização de impostos atrasados",
      "gate":{"expressao":"analise_tributaria && analise_tributaria.gera_upside_obrigatorio === true"},
      "formula_calculo":{"tipo":"tributario_calculado","parametros":{}},
      "fonte_de_calculo":"Calculado no Bloco 5: economia tributária real anual + redução de passivo de impostos atrasados"
    },
    {
      "id":"ro_otimizar_custos",
      "categoria":"ro",
      "label":"Otimizar custos operacionais",
      "descricao":"Revisar contratos, fornecedores e processos para recuperar margem operacional",
      "gate":{"expressao":"n((P.benchmarks_dre[setor]||{}).margem_op) > 0 && n(dre.margem_operacional_pct) < (n((P.benchmarks_dre[setor]||{}).margem_op) - 10)"},
      "formula_calculo":{"tipo":"ro_via_margem","parametros":{"recuperacao_pct_gap":0.5,"base":"gap_margem_op"}},
      "fonte_de_calculo":"Benchmark M&A: PMEs com margem abaixo do setor recuperam tipicamente 50% do gap em 12 meses via revisão de contratos. Calibrar com dados reais."
    },
    {
      "id":"ro_renegociar_custos_fixos",
      "categoria":"ro",
      "label":"Renegociar custos fixos",
      "descricao":"Aluguel, sistemas e outros custos fixos acima do benchmark setorial — oportunidade de renegociação",
      "gate":{"expressao":"(indicadores && indicadores.aluguel_pct && n(indicadores.aluguel_pct.valor) > n((P.benchmarks_dre[setor]||{}).aluguel) * n(P.fator_max_sobre_benchmark)) || (n(dre.fat_mensal) > 0 && (((n((dre.operacional_outros||{}).outros_cf) + n((dre.operacional_outros||{}).sistemas)) / n(dre.fat_mensal)) * 100) > (n((P.benchmarks_dre[setor]||{}).outros_cf) * n(P.fator_max_sobre_benchmark)))"},
      "formula_calculo":{"tipo":"ro_direto","parametros":{"economia_estimada_pct":0.15,"base":"custos_fixos_nao_ocupacao_total_anual"}},
      "fonte_de_calculo":"Benchmark renegociação de aluguel/contratos fixos: redução típica de 10-20% em renegociações sucessórias. Composição: outros_cf + sistemas (ocupação tem upside dedicado via Condição A do gate, que cobre aluguel vs benchmark). Calibrar."
    },
    {
      "id":"ro_otimizar_precificacao",
      "categoria":"ro",
      "label":"Revisar política de precificação",
      "descricao":"Margem bruta abaixo do setor sugere espaço para revisão de preços",
      "gate":{"expressao":"indicadores && indicadores.margem_bruta && n((P.benchmarks_indicadores[setor]||{}).margem_bruta) > 0 && n(indicadores.margem_bruta.valor) < (n((P.benchmarks_indicadores[setor]||{}).margem_bruta) - 8) && n(D.recorrencia_pct) < 50"},
      "formula_calculo":{"tipo":"ro_via_margem","parametros":{"recuperacao_pct_fat":0.03,"base":"fat_anual"}},
      "fonte_de_calculo":"Benchmark M&A: revisão de precificação em PMEs sem cultura de precificação recupera tipicamente 2-4% do faturamento. Calibrar."
    },
    {
      "id":"ro_reduzir_custo_folha",
      "categoria":"ro",
      "label":"Reduzir custo de folha",
      "descricao":"Folha acima do benchmark setorial — oportunidade de reestruturação de quadro",
      "gate":{"expressao":"indicadores && indicadores.folha_pct && n((P.benchmarks_dre[setor]||{}).folha) > 0 && n(indicadores.folha_pct.valor) > (n((P.benchmarks_dre[setor]||{}).folha) * n(P.fator_max_sobre_benchmark))"},
      "formula_calculo":{"tipo":"ro_direto","parametros":{"recuperacao_pct_gap":0.4,"base":"gap_folha_pct"}},
      "fonte_de_calculo":"Benchmark M&A: ineficiência de quadro corrige 30-50% do gap em 12 meses via reestruturação. Calibrar."
    },
    {
      "id":"ro_recuperar_inativos",
      "categoria":"ro",
      "label":"Recuperar receita de clientes inativos",
      "descricao":"Base recorrente com volume relevante de clientes — oportunidade de reativação",
      "gate":{"expressao":"n(D.recorrencia_pct) >= 30 && n(D.clientes) >= 100"},
      "formula_calculo":{"tipo":"ro_via_margem","parametros":{"recuperacao_pct_fat":0.05,"base":"fat_anual"}},
      "fonte_de_calculo":"Benchmark customer success: campanhas de reativação em base recorrente recuperam tipicamente 4-7% do faturamento anual. Calibrar."
    },
    {
      "id":"pa_regularizar_fornecedores",
      "categoria":"passivo",
      "label":"Regularizar fornecedores em atraso",
      "descricao":"Passivo de fornecedores em atraso impacta credibilidade na venda",
      "gate":{"expressao":"n((balanco.passivos||{}).fornecedores_atrasados) > n(dre.fat_mensal) && n(dre.fat_mensal) > 0"},
      "formula_calculo":{"tipo":"passivo_direto","parametros":{"fonte_passivo":"balanco.passivos.fornecedores_atrasados"}},
      "fonte_de_calculo":"Cálculo direto: passivo regularizado sai do balanço, aumentando valor líquido em proporção exata."
    },
    {
      "id":"pa_reestruturar_dividas",
      "categoria":"passivo",
      "label":"Reestruturar dívidas bancárias",
      "descricao":"Endividamento elevado pode ser reestruturado com redução de saldo e juros",
      "gate":{"expressao":"n((balanco.ativos||{}).total) > 0 && n((balanco.passivos||{}).saldo_devedor_emprestimos) > (n((balanco.ativos||{}).total) * 0.5)"},
      "formula_calculo":{"tipo":"passivo_estimado","parametros":{"reducao_passivo_pct":0.15,"juros_economizados_anual_pct":0.05,"base":"saldo_devedor_emprestimos"}},
      "fonte_de_calculo":"Reestruturação típica reduz 10-20% do passivo via desconto + 3-7% economia de juros anuais. Calibrar."
    },
    {
      "id":"pa_resolver_passivos_trabalhistas",
      "categoria":"passivo",
      "label":"Resolver passivos trabalhistas",
      "descricao":"Passivos trabalhistas declarados precisam ser endereçados antes da venda",
      "gate":{"expressao":"D.passivo_trabalhista === 'sim'"},
      "formula_calculo":{"tipo":"passivo_estimado","parametros":{"meses_estimados_folha":3,"base":"folha_mensal"}},
      "fonte_de_calculo":"Sem valor exato, estimamos passivo trabalhista típico em 3 meses de folha como proxy de mercado para PME. Calibrar quando houver dado real."
    },
    {
      "id":"mu_aumentar_recorrencia",
      "categoria":"multiplo",
      "label":"Aumentar receita recorrente",
      "descricao":"Recorrência abaixo do setor — estruturar contratos recorrentes paga prêmio na venda",
      "gate":{"expressao":"n((P.benchmarks_indicadores[setor]||{}).recorrencia_tipica) > 0 && n(D.recorrencia_pct) < (n((P.benchmarks_indicadores[setor]||{}).recorrencia_tipica) * 0.5)"},
      "formula_calculo":{"tipo":"multiplo_aumento","parametros":{"bonus_multiplo":1.0,"base":"ro_anual"}},
      "fonte_de_calculo":"Benchmark M&A: empresas que saem de recorrência <30% para >50% ganham +1× no múltiplo do comprador. Calibrar."
    },
    {
      "id":"mu_diversificar_clientes",
      "categoria":"multiplo",
      "label":"Diversificar carteira de clientes",
      "descricao":"Concentração acima do tolerável reduz múltiplo da venda",
      "gate":{"expressao":"n((P.benchmarks_indicadores[setor]||{}).concentracao_max) > 0 && n(D.concentracao_pct) > n((P.benchmarks_indicadores[setor]||{}).concentracao_max)"},
      "formula_calculo":{"tipo":"multiplo_aumento","parametros":{"bonus_multiplo":0.5,"base":"ro_anual"}},
      "fonte_de_calculo":"Benchmark M&A: sair da zona crítica de concentração ganha +0.5× no múltiplo. Calibrar."
    },
    {
      "id":"mu_reduzir_socio_dependencia",
      "categoria":"multiplo",
      "label":"Reduzir dependência do dono",
      "descricao":"Negócio que opera sem o dono paga prêmio significativo na venda",
      "gate":{"expressao":"D.tem_gestor !== 'sim' && D.opera_sem_dono !== 'sim'"},
      "formula_calculo":{"tipo":"multiplo_aumento","parametros":{"bonus_multiplo":0.7,"base":"ro_anual"}},
      "fonte_de_calculo":"Benchmark M&A: negócio menos sócio-dependente paga prêmio de 0.5-1× no múltiplo. Calibrar."
    },
    {
      "id":"rec_formalizar_contabilidade",
      "categoria":"qualitativo",
      "label":"Formalizar contabilidade",
      "descricao":"Contabilidade formal aumenta credibilidade no due diligence e reduz desconto na venda",
      "gate":{"expressao":"D.contabilidade !== 'sim'"},
      "formula_calculo":{"tipo":"qualitativo_sem_calculo","parametros":{}},
      "fonte_de_calculo":"Recomendação qualitativa — não soma no potencial monetário."
    },
    {
      "id":"rec_separar_pf_pj",
      "categoria":"qualitativo",
      "label":"Separar pessoa física de pessoa jurídica",
      "descricao":"Separação PF/PJ é pré-requisito de qualquer comprador profissional",
      "gate":{"expressao":"D.dre_separacao_pf_pj !== 'sim'"},
      "formula_calculo":{"tipo":"qualitativo_sem_calculo","parametros":{}},
      "fonte_de_calculo":"Recomendação qualitativa — não soma no potencial monetário."
    },
    {
      "id":"rec_documentar_processos",
      "categoria":"qualitativo",
      "label":"Documentar processos operacionais",
      "descricao":"Processos documentados reduzem risco percebido pelo comprador e aceleram a transição",
      "gate":{"expressao":"D.processos !== 'sim' && D.processos !== 'documentados'"},
      "formula_calculo":{"tipo":"qualitativo_sem_calculo","parametros":{}},
      "fonte_de_calculo":"Recomendação qualitativa — não soma no potencial monetário."
    },
    {
      "id":"rec_implementar_sistemas",
      "categoria":"qualitativo",
      "label":"Implementar sistemas de gestão",
      "descricao":"Sistemas estruturados aumentam transparência e facilitam o due diligence",
      "gate":{"expressao":"n(D.custo_sistemas) === 0"},
      "formula_calculo":{"tipo":"qualitativo_sem_calculo","parametros":{}},
      "fonte_de_calculo":"Recomendação qualitativa — não soma no potencial monetário. Gate proxy: ausência de gasto com sistemas."
    },
    {
      "id":"rec_registrar_marca",
      "categoria":"qualitativo",
      "label":"Registrar marca no INPI",
      "descricao":"Marca registrada no INPI é ativo intangível protegido que entra na composição do preço",
      "gate":{"expressao":"D.marca_inpi !== 'registrada' && D.marca_inpi !== 'sim'"},
      "formula_calculo":{"tipo":"qualitativo_sem_calculo","parametros":{}},
      "fonte_de_calculo":"Recomendação qualitativa — não soma no potencial monetário."
    },
    {
      "id":"rec_aumentar_presenca_digital",
      "categoria":"qualitativo",
      "label":"Aumentar presença digital",
      "descricao":"Presença digital robusta amplia base de compradores e reduz fricção comercial. Negócios com presença digital estruturada vendem mais rápido e com menos desconto.",
      "gate":{"expressao":"true"},
      "formula_calculo":{"tipo":"qualitativo_sem_calculo","parametros":{}},
      "fonte_de_calculo":"Recomendação qualitativa universal — gate sempre verdadeiro. Não soma no potencial monetário."
    },
    {
      "id":"pw_funil_vendas",
      "categoria":"paywall",
      "label":"Análise completa do funil de vendas",
      "descricao":"Disponível no laudo completo (R$ 99): mapeamento detalhado da geração de demanda e conversão.",
      "gate":{"expressao":"true"},
      "formula_calculo":{"tipo":"paywall_display","parametros":{}},
      "fonte_de_calculo":"Display fixo do laudo-pago — sem cálculo monetário."
    },
    {
      "id":"pw_mapeamento_concorrencia",
      "categoria":"paywall",
      "label":"Mapeamento competitivo do mercado",
      "descricao":"Disponível no laudo completo (R$ 99): posicionamento vs concorrentes e oportunidades de diferenciação.",
      "gate":{"expressao":"true"},
      "formula_calculo":{"tipo":"paywall_display","parametros":{}},
      "fonte_de_calculo":"Display fixo do laudo-pago — sem cálculo monetário."
    },
    {
      "id":"pw_plano_transicao_dono",
      "categoria":"paywall",
      "label":"Plano de transição do dono",
      "descricao":"Disponível no laudo completo (R$ 99): roteiro estruturado para reduzir dependência do sócio antes da venda.",
      "gate":{"expressao":"true"},
      "formula_calculo":{"tipo":"paywall_display","parametros":{}},
      "fonte_de_calculo":"Display fixo do laudo-pago — sem cálculo monetário."
    }
  ]}$json$::jsonb
FROM parametros_versoes
WHERE id = 'v2026.04';

-- ============================================================
-- Step 3: verificação
-- ============================================================
SELECT
  id,
  ativo,
  jsonb_array_length(snapshot->'upsides_catalogo') AS qtd_upsides,
  jsonb_object_keys(snapshot->'pesos_sub_metricas_ise') AS pilares_com_pesos
FROM parametros_versoes
WHERE id = 'v2026.05';

SELECT
  id, ativo,
  snapshot->'_meta' AS meta,
  snapshot->'caps_categoria' AS caps_cat,
  snapshot->'caps_ise' AS caps_ise,
  snapshot->'cap_absoluto' AS cap_abs,
  snapshot->'fator_max_sobre_benchmark' AS fator_max
FROM parametros_versoes
WHERE id = 'v2026.05';

SELECT id, ativo FROM parametros_versoes ORDER BY criado_em DESC;
