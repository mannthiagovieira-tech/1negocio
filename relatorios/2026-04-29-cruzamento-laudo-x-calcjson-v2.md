# Cruzamento — Laudo v1 × calc_json v2

**Pra cada elemento exibido no laudo-completo.html, identificar se EXISTE no calc_json v2 hoje, em qual path, e em que estado (idêntico, formato diferente, ausente).**

**Princípio:** o laudo NÃO calcula nada. Tudo que ele exibe deve vir pronto do calc_json v2. Os gaps abaixo dizem o que falta acrescentar (ou na skill v2, ou em parametros_versoes, ou via JOIN com `negocios`).

**Caso de referência:** Stuido Fit (negocio_id `1a553b5c-e5f8-4fc3-90ca-e6d2be4ed928`) — todas as queries SQL deste documento foram rodadas contra esse laudo ativo.

**Legenda de status:**
- ✓ TEM — existe no calc_json v2, formato idêntico/compatível
- ⚠ TEM-DIFERENTE — existe mas formato/nome/estrutura diferente da v1
- ⚠ FORA — existe mas fora do calc_json (em `negocios`, parametros, derivado de URL)
- ✗ FALTA — não existe — precisa ser adicionado à v2
- ❓ AMBÍGUO — origem v1 incerta — investigar

**Top-level keys do calc_json v2 (Stuido Fit):** `analise_tributaria`, `atratividade`, `balanco`, `dre`, `icd`, `identificacao`, `indicadores_vs_benchmark`, `inputs_origem`, `ise`, `operacional`, `potencial_12m`, `recomendacoes_pre_venda`, `textos_anuncio`, `textos_ia`, `upsides`, `valuation`.

---

## SEÇÃO 1 — ICD (Qualidade dos dados)

| # | Elemento (laudo v1) | Path no calc_json v2 | Status | Observação |
|---|---------------------|----------------------|--------|------------|
| 1.1 | "Qualidade dos dados" (label) | — | ⚠ FORA | hardcoded HTML |
| 1.2 | % ICD na barra/numérico | `icd.pct` | ✓ TEM | Idêntico (Stuido Fit: 24%) |
| 1.3 | Cor do dot (verde/amber/red) | derivar de `icd.pct` | ✓ TEM | Mesma regra ≥70/≥50/<50 |
| 1.4 | Lista respondidos | `icd.respondidos[].label` | ⚠ TEM-DIFERENTE | v1 espera array de strings; v2 tem array de `{id, label, critico}` |
| 1.5 | Lista não respondidos | `icd.nao_respondidos[].label` | ⚠ TEM-DIFERENTE | mesmo shape do anterior |
| 1.6 | Fallback hardcoded de 21 checks | — | ⚠ FORA | Pode/deve ser eliminado — `icd.respondidos`/`nao_respondidos` substitui |

---

## SEÇÃO 2 — HERO (Nome, data, tags, descrição)

| # | Elemento | Path no calc_json v2 | Status | Observação |
|---|----------|----------------------|--------|------------|
| 2.1 | Nome do negócio | `identificacao.nome` | ✓ TEM | "Stuido Fit" |
| 2.2 | "Avaliado em DD/MM/YYYY" | `_data_avaliacao` (top-level) | ✓ TEM | ISO; precisa formatar pt-BR |
| 2.3 | Tag setor | `identificacao.setor.label` | ⚠ TEM-DIFERENTE | v1 usa `D.setor_raw \|\| D.setor`; v2 tem `setor.{code, label}`. **Pegadinha:** no Stuido Fit, label está como "bem_estar" (slug em vez de label legível) — aparente bug do mapeamento de labels |
| 2.4 | Tag local | `identificacao.localizacao.{cidade,estado}` | ⚠ TEM-DIFERENTE | v1 usa `D.cidade + '/' + D.estado` flat; v2 aninha em `localizacao` |
| 2.5 | Tag tempo | `identificacao.tempo_operacao_anos` | ✓ TEM | |
| 2.6 | Tag regime | `identificacao.regime_tributario_declarado` | ⚠ TEM-DIFERENTE | v2 retorna `simples`/`presumido`/`real`/`mei` (slug); precisa map pra "Simples Nacional" etc. |
| 2.7 | Texto descritivo (parágrafo gerado inline) | `textos_ia.texto_contexto_negocio.conteudo` | ✓ TEM | **Nova fonte v2**: texto IA já gerado pela Edge Function (Sub-passo 4.6). Substitui o template-string inline da v1 |

---

## SEÇÃO 3 — VALOR DE VENDA

| # | Elemento | Path no calc_json v2 | Status | Observação |
|---|----------|----------------------|--------|------------|
| 3.1 | Valor R$ X | `valuation.valor_venda` | ✓ TEM | Stuido Fit: R$ 3.993.207 |
| 3.2 | "Porteira fechada — inclui estoque…" | — | ⚠ FORA | hardcoded HTML, ok manter |

---

## SEÇÃO 4 — TERMÔMETRO COMPARATIVO

| # | Elemento | Path no calc_json v2 | Status | Observação |
|---|----------|----------------------|--------|------------|
| 4.1 | Marker expectativa | `identificacao.expectativa_valor_dono` | ✓ TEM | |
| 4.2 | Marker 1N (avaliação) | `valuation.valor_venda` | ✓ TEM | |
| 4.3 | Marker potencial 1Sócio | `potencial_12m.potencial_final.valor_projetado_brl` | ✓ TEM | **Já calculado em v2!** Stuido Fit: R$ 5.512.308 |
| 4.4 | Legenda expectativa | idem 4.1 | ✓ TEM | |
| 4.5 | Legenda 1N | idem 4.2 | ✓ TEM | |
| 4.6 | Legenda potencial | idem 4.3 | ✓ TEM | |
| 4.7 | "Boa notícia/Atenção: X% acima/abaixo" | derivar: `(valuation.valor_venda - identificacao.expectativa_valor_dono) / expectativa × 100` | ✓ TEM | Cálculo trivial no front |

**Nota:** o cálculo `valorPot = valorVenda + (ganhoAnual × fator)` da v1 (linha 868) **NÃO é mais necessário** — v2 já entrega `valor_projetado_brl` pronto.

---

## SEÇÃO 5 — DRE (linhas detalhadas)

V1 espera os campos flat (`D.fat_mensal`, `D.impostos`, `D.cmv`, etc.). V2 organiza tudo em sub-objetos.

| # | Linha do DRE | Path no calc_json v2 | Status | Observação |
|---|--------------|----------------------|--------|------------|
| 5.1 | Faturamento Bruto | `dre.fat_mensal` / `dre.fat_anual` | ✓ TEM | |
| 5.2 | Impostos s/ faturamento | `dre.deducoes_receita.impostos.mensal` | ⚠ TEM-DIFERENTE | aninhado em `deducoes_receita` |
| 5.3 | Taxas de recebimento | `dre.deducoes_receita.taxas_recebimento` | ⚠ TEM-DIFERENTE | aninhado |
| 5.4 | Comissões | `dre.deducoes_receita.comissoes` | ⚠ TEM-DIFERENTE | aninhado |
| 5.5 | Royalties | derivar de `dre.deducoes_receita.royalty_pct_aplicado` × fat | ⚠ TEM-DIFERENTE | v2 tem só pct, não valor absoluto |
| 5.6 | Fundo de propaganda | derivar de `dre.deducoes_receita.mkt_franquia_pct_aplicado` × fat | ⚠ TEM-DIFERENTE | idem |
| 5.7 | Receita Líquida | `dre.rec_liquida_mensal` | ✓ TEM | |
| 5.8 | CMV / Custo de produção | ❓ não encontrei `dre.cmv_mensal` direto | ❓ AMBÍGUO | Precisa investigar — pode estar em `dre` mas não apareceu nas keys que listei |
| 5.9 | Lucro Bruto | `dre.lucro_bruto_mensal` | ✓ TEM | |
| 5.10 | Folha CLT bruta | `dre.pessoal.clt_folha_bruta` | ⚠ TEM-DIFERENTE | aninhado em `pessoal` |
| 5.11 | Encargos CLT | `dre.pessoal.clt_encargos` (+ detalhes em `clt_encargos_detalhes`) | ⚠ TEM-DIFERENTE | aninhado, tem mais detalhe (RAT, FGTS, INSS patronal) |
| 5.12 | Provisões CLT | ❓ não vi `clt_provisoes` | ❓ AMBÍGUO | Pode estar em `balanco.passivos.provisao_clt_calculada` (visto: `valor`, `formula`) — outra estrutura |
| 5.13 | Equipe PJ / freela | `dre.pessoal.pj_custo` | ⚠ TEM-DIFERENTE | aninhado |
| 5.14 | Aluguel | `dre.ocupacao.aluguel` | ⚠ TEM-DIFERENTE | aninhado em `ocupacao` |
| 5.15 | Facilities | `dre.ocupacao.facilities` | ⚠ TEM-DIFERENTE | aninhado |
| 5.16 | Terceirizados | `dre.ocupacao.terceirizados` | ⚠ TEM-DIFERENTE | aninhado |
| 5.17 | Sistemas | `dre.operacional_outros.sistemas` | ⚠ TEM-DIFERENTE | aninhado em `operacional_outros` |
| 5.18 | Outros custos fixos | `dre.operacional_outros.outros_cf` | ⚠ TEM-DIFERENTE | aninhado |
| 5.19 | Marketing pago | `dre.operacional_outros.mkt_pago` | ⚠ TEM-DIFERENTE | aninhado |
| 5.20 | Resultado Operacional | `dre.ro_mensal` / `dre.ro_anual` | ✓ TEM | |
| 5.21 | Pró-labore dos sócios | `operacional.prolabore_mensal_total` | ⚠ TEM-DIFERENTE | em `operacional`, não `dre` |
| 5.22 | Antecipação de recebíveis | ✗ não encontrei | ✗ FALTA | v1 mostra; v2 não tem campo dedicado |
| 5.23 | Parcelas de dívidas | ✗ não encontrei | ✗ FALTA | idem |
| 5.24 | Investimentos recorrentes | ✗ não encontrei | ✗ FALTA | idem |
| 5.25 | Potencial de caixa | `dre.potencial_caixa_mensal` | ✓ TEM | |
| 5.26 | Flag "estimado" por linha (`D.dre_estimados.{cmv,folha,aluguel,outros_cf}`) | ✗ não encontrei flags por linha | ✗ FALTA | v1 rotula linhas em laranja como "estimado" |
| 5.27 | Coluna % (vs faturamento) | derivar (calc trivial) | ✓ TEM | |
| 5.28 | Coluna anual (× 12) | já existe (`fat_anual`, `ro_anual`) ou calc | ✓ TEM | |

---

## SEÇÃO 6 — BALANÇO PATRIMONIAL

| # | Elemento | Path no calc_json v2 | Status | Observação |
|---|----------|----------------------|--------|------------|
| 6.1 | Caixa | `balanco.ativos.caixa` | ⚠ TEM-DIFERENTE | aninhado em `ativos` |
| 6.2 | Contas a receber | `balanco.ativos.contas_receber` | ⚠ TEM-DIFERENTE | |
| 6.3 | Estoque | `balanco.ativos.estoque` | ⚠ TEM-DIFERENTE | |
| 6.4 | Equipamentos | `balanco.ativos.equipamentos` | ⚠ TEM-DIFERENTE | |
| 6.5 | Imóvel | `balanco.ativos.imovel` | ⚠ TEM-DIFERENTE | |
| 6.6 | Taxa de franquia | `balanco.ativos.ativo_franquia` | ⚠ TEM-DIFERENTE | |
| 6.7 | Total Ativos | `balanco.ativos.total` | ⚠ TEM-DIFERENTE | |
| 6.8 | Fornecedores | `balanco.passivos.fornecedores_a_vencer` (+ `fornecedores_atrasados`) | ⚠ TEM-DIFERENTE | v2 desdobra em a vencer / atrasados |
| 6.9 | Dívidas/Saldo devedor | `balanco.passivos.saldo_devedor_emprestimos` | ⚠ TEM-DIFERENTE | |
| 6.10 | Total Passivos | `balanco.passivos.total` | ⚠ TEM-DIFERENTE | |
| 6.11 | Patrimônio Líquido | `balanco.patrimonio_liquido` | ✓ TEM | |

---

## SEÇÃO 7 — ISE (10 pilares v1 × 8 pilares v2)

| # | Elemento | Path no calc_json v2 | Status | Observação |
|---|----------|----------------------|--------|------------|
| 7.1 | Score 0-100 | `ise.ise_total` | ✓ TEM | Stuido Fit: 48.5 |
| 7.2 | Cor (verde/amber/red ≥70/≥50/<50) | derivar | ✓ TEM | |
| 7.3 | Classe ("Estruturado"/"Consolidado"/etc.) | `ise.classe` | ⚠ TEM-DIFERENTE | v1 tem 5 classes hardcoded com descrições inline; v2 tem `classe` + `fator_classe` (Stuido Fit: "Dependente", 0.85). Mapeamento de descrições continua hardcoded ou mover pra parametros |
| 7.4 | Descrição da classe | — | ⚠ FORA | hardcoded `clsMap` no front |
| 7.5 | Pilar Comercial | `ise.pilares[id=p3_comercial].score_0_10` | ⚠ TEM-DIFERENTE | v1: 0-10 simples; v2: objeto com `score_0_10` + `peso_pct` + `sub_metricas[]` |
| 7.6 | Pilar Financeiro | `ise.pilares[id=p1_financeiro].score_0_10` | ⚠ TEM-DIFERENTE | |
| 7.7 | Pilar Gestão | `ise.pilares[id=p4_gestao].score_0_10` | ⚠ TEM-DIFERENTE | |
| 7.8 | Pilar Independência (v1: `ise_dep`) | `ise.pilares[id=p5_socio_dependencia].score_0_10` | ⚠ TEM-DIFERENTE | rename |
| 7.9 | Pilar Concentração (v1: `ise_conc`) | sub-métrica `p3_comercial.sub_metricas[id=concentracao_pct]` | ⚠ TEM-DIFERENTE | virou sub-métrica de Comercial em v2 |
| 7.10 | Pilar Escalabilidade (v1: `ise_esc`) | ✗ não vi pilar dedicado | ✗ FALTA | v2 não tem "escalabilidade" nominalmente |
| 7.11 | Pilar Balanço | `ise.pilares[id=p7_balanco].score_0_10` | ⚠ TEM-DIFERENTE | rename |
| 7.12 | Pilar Marca | `ise.pilares[id=p8_marca].score_0_10` | ⚠ TEM-DIFERENTE | rename |
| 7.13 | Pilar Dívida (v1: `ise_div`) | sub-métrica em `p7_balanco` ou `p1_financeiro` | ⚠ TEM-DIFERENTE | desce de pilar pra sub-métrica |
| 7.14 | Pilar Risco (v1: `ise_ris`) | `ise.pilares[id=p6_risco_legal]` | ⚠ TEM-DIFERENTE | rename |

**Mapeamento agregado dos 10 pilares v1 → 8 pilares v2:**

| Pilar v1 | Pilar v2 (ou sub-métrica) | Observação |
|----------|---------------------------|------------|
| `ise_com` (Comercial) | `p3_comercial` | rename |
| `ise_fin` (Financeiro) | `p1_financeiro` | rename |
| `ise_ges` (Gestão) | `p4_gestao` | rename |
| `ise_dep` (Independ.) | `p5_socio_dependencia` | rename + sub-métricas (`opera_sem_dono`, `equipe_permanece`, `prolabore_documentado`) |
| `ise_conc` (Concentração) | `p3_comercial.sub_metricas[concentracao_pct]` | virou sub-métrica |
| `ise_esc` (Escalab.) | — | **✗ FALTA** sem equivalente direto |
| `ise_bal` (Balanço) | `p7_balanco` | rename |
| `ise_mar` (Marca) | `p8_marca` | rename + sub-métricas |
| `ise_div` (Dívida) | sub-métrica de balanço/financeiro | virou sub-métrica |
| `ise_ris` (Risco) | `p6_risco_legal` | rename |
| — | `p2_resultado` | **novo em v2** (não tinha em v1) |

---

## SEÇÃO 8 — FATOR (equação de valor)

| # | Elemento | Path no calc_json v2 | Status | Observação |
|---|----------|----------------------|--------|------------|
| 8.1 | RO Anual | `valuation.ro_anual` (também em `dre.ro_anual`) | ✓ TEM | |
| 8.2 | Fator 1N (×) | `valuation.fator_final` | ✓ TEM | Stuido Fit: 1.6405 |
| 8.3 | Patrimônio | `valuation.patrimonio_liquido` | ✓ TEM | |
| 8.4 | Valor de Venda | `valuation.valor_venda` | ✓ TEM | |
| 8.5 | Múltiplo base | `valuation.multiplo_base` | ✓ TEM | Stuido Fit: 1.93 |
| 8.6 | Modificador setorial | `valuation.multiplo_setor.valor` | ⚠ TEM-DIFERENTE | v2 tem objeto `{label, valor, codigo}`; v1 esperava número simples |
| 8.7 | Fator ISE | `valuation.fator_ise.valor` | ⚠ TEM-DIFERENTE | v2 objeto `{faixa, valor, classe}` |
| 8.8 | Aviso RO negativo | `valuation.ro_negativo` (boolean) + `valuation.ro_negativo_msg` | ✓ TEM | v2 já fornece flag e mensagem |
| 8.9 | Texto explicativo Fator 1N | gerar com `multiplo_base × multiplo_setor.valor + (fator_ise × ajuste_forma_atuacao)` | ⚠ TEM-DIFERENTE | v1 mistura nomenclatura "mul_base + mul_mod + mul_ise"; v2 separa diferente |
| 8.10 | Ajuste forma de atuação (NÃO existia em v1) | `valuation.ajuste_forma_atuacao` | ✓ TEM | extra v2: `{principal: {valor, codigo}, outras[], total_ajuste}` |

---

## SEÇÃO 9 — INDICADORES CHAVE

V1 usa cards simples com status (`green`/`amber`/`red`). V2 tem `indicadores_vs_benchmark.<id>` com mais riqueza.

| # | Indicador v1 | Path no calc_json v2 | Status |
|---|--------------|----------------------|--------|
| 9.1 | Margem Operacional | `indicadores_vs_benchmark.margem_operacional.{valor, status, benchmark, delta_pp}` | ✓ TEM |
| 9.2 | Recorrência de receita | `indicadores_vs_benchmark.recorrencia` | ✓ TEM |
| 9.3 | Concentração de clientes | `indicadores_vs_benchmark.concentracao` | ✓ TEM |
| 9.4 | Endividamento total | ❓ não encontrei indicador dedicado de "endividamento ÷ RO anual" | ❓ AMBÍGUO | Pode derivar de `balanco.passivos.saldo_devedor_emprestimos / dre.ro_anual` |
| 9.5 | Resultado por colaborador | `indicadores_vs_benchmark.ro_por_funcionario_mensal` | ✓ TEM | (sem benchmark; v1 hardcoda 1200/600) |
| 9.6 | Ticket médio mensal | `indicadores_vs_benchmark.ticket_medio` | ✓ TEM | |
| 9.7 | CMV sobre faturamento | `indicadores_vs_benchmark.cmv_pct` | ✓ TEM | (com benchmark vindo já no objeto) |
| 9.8 | `D.bench_ind.{margem_op,cmv,folha_pct,...}` | cada `indicadores_vs_benchmark.<id>.benchmark` | ✓ TEM | benchmarks já embutidos |

**Status de cada indicador em v2:** `no_alvo`/`atencao`/`abaixo`/`null` (sem benchmark). V1 usa `green`/`amber`/`red`. Mapeamento trivial: `no_alvo→green`, `atencao→amber`, `abaixo→red`.

---

## SEÇÃO 10 — ANÁLISE TRIBUTÁRIA

| # | Elemento | Path no calc_json v2 | Status | Observação |
|---|----------|----------------------|--------|------------|
| 10.1 | Regime atual | `analise_tributaria.regime_declarado` | ✓ TEM | "simples" |
| 10.2 | Regime ótimo | `analise_tributaria.regime_otimo_calculado` | ✓ TEM | "presumido" |
| 10.3 | Imposto/mês atual | `analise_tributaria.comparativo_regimes[regime=declarado].imposto_anual / 12` | ⚠ TEM-DIFERENTE | v2 dá anual, v1 espera mensal |
| 10.4 | % fat atual | `analise_tributaria.comparativo_regimes[regime=declarado].aliquota_efetiva_pct` | ✓ TEM | |
| 10.5 | Linha MEI | `analise_tributaria.comparativo_regimes[regime=mei]` | ✓ TEM | tem `elegivel`, `motivo_inelegibilidade`, etc. |
| 10.6 | Linha Simples Nacional | idem `regime=simples` | ✓ TEM | |
| 10.7 | Linha Lucro Presumido | idem `regime=presumido` | ✓ TEM | |
| 10.8 | Linha Lucro Real | idem `regime=real` | ✓ TEM | |
| 10.9 | Economia mensal | derivar de `analise_tributaria.economia_potencial.economia_anual / 12` | ✓ TEM | v1 espera mensal direto; v2 tem anual em `economia_anual` |
| 10.10 | Economia anual | `analise_tributaria.economia_potencial.economia_anual` | ✓ TEM | |
| 10.11 | Tem oportunidade? | derivar de `analise_tributaria.economia_potencial.economia_anual > 0` ou `gera_upside_obrigatorio` | ✓ TEM | |
| 10.12 | Alerta regime atual inelegível | `analise_tributaria.alerta_inelegibilidade.{motivo, regime}` | ✓ TEM | extra v2 |
| 10.13 | Detalhes do imposto (PIS/COFINS/IRPJ/CSLL/ISS/ICMS) | `comparativo_regimes[].decomposicao` | ✓ TEM | extra v2 — bem mais granular |
| 10.14 | Fator R (Simples) | `analise_tributaria.fator_r_calculado` + `fator_r_observacao` | ✓ TEM | extra v2 |

---

## SEÇÃO 11 — POTENCIAL 1SÓCIO

⚠️ **Antes registrei como ✗ FALTA. Estava errado.** Os campos existem em `potencial_12m`.

| # | Elemento | Path no calc_json v2 | Status | Observação |
|---|----------|----------------------|--------|------------|
| 11.1 | "Ganho anual" | `potencial_12m.potencial_final.brl` | ✓ TEM | Stuido Fit: R$ 1.519.102 |
| 11.2 | "Ganho mensal" | `potencial_12m.potencial_final.brl / 12` | ✓ TEM | derivar |
| 11.3 | "Valorização 12m" | `potencial_12m.potencial_final.valor_projetado_brl - valuation.valor_venda` | ✓ TEM | derivar (Stuido: 5.512.308 − 3.993.207 = R$ 1.519.101) |
| 11.4 | "% no valor" | `potencial_12m.potencial_final.pct × 100` | ✓ TEM | Stuido Fit: 38% |
| 11.5 | Lista de oportunidades top 3 | `potencial_12m.upsides_ativos[]` ordenado por `contribuicao_brl` desc | ✓ TEM | **CADA upside ATIVO TEM `contribuicao_brl` em v2** (corrigindo erro do mapa anterior) |
| 11.6 | `D.ops[i].titulo` | `potencial_12m.upsides_ativos[i].label` | ⚠ TEM-DIFERENTE | rename `titulo`→`label` |
| 11.7 | `D.ops[i].descricao` | ✗ FALTA em `potencial_12m.upsides_ativos[i]` | ✗ FALTA | descrição vive em `upsides.ativos[i].descricao` (catálogo) — precisa fazer JOIN por `id` ou mover descrição pra dentro de `potencial_12m.upsides_ativos[i]` |
| 11.8 | `D.ops[i].ganho` em BRL | `potencial_12m.upsides_ativos[i].contribuicao_brl` | ⚠ TEM-DIFERENTE | rename `ganho`→`contribuicao_brl` |
| 11.9 | `D.ops[i].ganho_label` | derivar (`+R$ X/mês`) | ✓ TEM | calc trivial |
| 11.10 | `D.ops[i].tipo` | `potencial_12m.upsides_ativos[i].categoria` | ⚠ TEM-DIFERENTE | rename + valores diferentes (`tipo: "tributario"/"calculada"/"fixa"` v1 vs `categoria: "tributario"/"ro"/"multiplo"` v2) |
| 11.11 | `D.total_ops` (soma) | `potencial_12m.potencial_final.brl` | ✓ TEM | é exatamente isso |
| 11.12 | "+ X ações totalizam +R$ Y/ano" | derivar dos `upsides_ativos[3:].contribuicao_brl × 12` | ✓ TEM | calc trivial |
| 11.13 | "Investimento R$ 1.621/mês" | — | ⚠ FORA | hardcoded; deve ir pra parametros |

---

## SEÇÃO 12 — 1N PERFORMANCE / ATRATIVIDADE

| # | Elemento | Path no calc_json v2 | Status | Observação |
|---|----------|----------------------|--------|------------|
| 12.1 | "2.847 negócios avaliados" | — | ⚠ FORA | hardcoded (já no handoff) |
| 12.2 | "R$ 1.2B Volume total" | — | ⚠ FORA | idem |
| 12.3 | "1.423 Compradores ativos" | — | ⚠ FORA | idem |
| 12.4 | Score atratividade /10 | `atratividade.total` | ✓ TEM | Stuido Fit: 4.85 (escala 0-10? ou 0-100? Verificar) |
| 12.5 | Label (Alta/Boa/Moderada/Baixa) | `atratividade.label` | ⚠ TEM-DIFERENTE | v2 já fornece label; v1 deriva dos thresholds |
| 12.6 | Pilar ISE — Solidez | `atratividade.componentes[id=ise].score_0_10` | ⚠ TEM-DIFERENTE | v2 tem 3 componentes, v1 tem 6 |
| 12.7 | Pilar Setor | `atratividade.componentes[id=setor].score_0_10` | ⚠ TEM-DIFERENTE | |
| 12.8 | Pilar Recorrência | ✗ não existe componente dedicado | ✗ FALTA | v1 mostra; v2 não tem nominalmente |
| 12.9 | Pilar Independência | ✗ não existe componente dedicado | ✗ FALTA | idem |
| 12.10 | Pilar Crescimento | `atratividade.componentes[id=crescimento].score_0_10` | ✓ TEM | |
| 12.11 | Pilar Margem vs Benchmark | ✗ não existe componente dedicado | ✗ FALTA | idem |
| 12.12 | Pesos (17%/17%/17%/17%/17%/15%) | `atratividade.componentes[i].peso_pct` | ⚠ TEM-DIFERENTE | v2 tem 50/?/? (Stuido: ise=50%); v1 tem 17×5+15 |
| 12.13 | Comentário inline | gerar com template | ✓ TEM | calc trivial |

---

## SEÇÃO 13 — UPSIDES (CATÁLOGO vs RESULTADO)

V2 tem **2 estruturas diferentes** pra upsides:
- `upsides.ativos[]` — catálogo descritivo (id, label, descricao, categoria, gate, formula_calculo, fonte_de_calculo). **Sem valor monetário.**
- `potencial_12m.upsides_ativos[]` — resultado da agregação (id, label, categoria, **contribuicao_brl**, contribuicao_bruta_pct, contribuicao_pos_cap_categoria_pct).

Pra renderizar "Top 3 oportunidades" o laudo deve LEAR DE `potencial_12m.upsides_ativos` (já com BRL). Pra puxar a `descricao` legível, JOIN com `upsides.ativos` pelo `id`.

---

## SEÇÃO 14 — POPUPS, CTAs, RODAPÉ, MODAL

Quase tudo é **hardcoded HTML** (preços R$ 99 / R$ 588, comissões 5%/10%, mensagens). Os únicos campos vindos do calc_json:

| # | Elemento | Path no calc_json v2 | Status |
|---|----------|----------------------|--------|
| 14.1 | Popup 1Sócio "Ganho anual" | `potencial_12m.potencial_final.brl` | ✓ TEM |
| 14.2 | Popup 1Sócio "Valorização 12m" | derivar | ✓ TEM |
| 14.3 | Popup grátis: campo Código | `identificacao.codigo_diagnostico` ou `identificacao.slug` | ✓ TEM |
| 14.4 | Popup grátis: pré-preenchido valor | `valuation.valor_venda` | ✓ TEM |
| 14.5 | Popup grátis: indicador (✓/◎/⚠/✕) | derivar de `valor_pub / valuation.valor_venda` | ✓ TEM |

Tudo o resto é hardcoded. Inclui números de telefone WhatsApp (`5548999279320`), URLs Stripe, mensagens pré-preenchidas.

---

## SEÇÃO 15 — DEMO_DATA

DEMO_DATA hardcoded (linhas 1411-1456 do laudo) usa schema **antigo v1 flat** (`fat_mensal`, `ise_com`, `mul_base`, etc.). Após migração pra v2, o demo deve receber um calc_json v2 inteiro (estruturado) ou ser reescrito completamente. Já está catalogado no handoff.

---

## STATUS CONSOLIDADO

| Status | Quantidade aproximada | Significado |
|--------|----------------------|-------------|
| ✓ TEM | ~50 | Existe no calc_json v2, mesmo formato ou idêntico |
| ⚠ TEM-DIFERENTE | ~35 | Existe mas formato/path/nome diferente |
| ⚠ FORA | ~30 | Hardcoded HTML, ou pertence a `negocios`/parametros |
| ✗ FALTA | ~10 | Não existe na v2 — gap real a resolver |
| ❓ AMBÍGUO | ~3 | Origem v1 incerta — verificar |

**Total elementos cruzados:** ~128 (alguns dos ~140 do mapa são variações de exibição do mesmo dado, que aqui consolidei).

---

## ITENS QUE FALTAM NA V2 (✗ FALTA)

### Crítico (sem isso o laudo perde funcionalidade)

1. **`D.ops[i].descricao` (descrição legível do upside) acessível em `potencial_12m.upsides_ativos`** — hoje só tem em `upsides.ativos` (catálogo). Pra renderizar top 3 com descrição precisa JOIN por `id` ou copiar `descricao` pra dentro de `potencial_12m.upsides_ativos[i]`.
   - **Onde adicionar:** skill v2 (na agregação de `potencial_12m`) — copiar `descricao` do catálogo.

2. **Pilar ISE "Escalabilidade" (`ise_esc`)** — v1 mostra 10 pilares; v2 tem 8 e não tem equivalente direto pra "Escalabilidade".
   - **Onde decidir:** skill v2 cria pilar ou laudo v2 mostra só 8.

3. **Pilares de atratividade "Recorrência", "Independência", "Margem vs Benchmark"** — v1 mostra 6 pilares de atratividade; v2 tem 3 componentes (`ise`, `setor`, `crescimento`).
   - **Onde decidir:** skill v2 expandir componentes OU laudo v2 mostrar só 3.

### Não-crítico (laudo pode esconder se vazio)

4. **DRE: "Antecipação de recebíveis" (`D.antecipacao`)** — linha do bloco "informativo, não entra no valuation".
5. **DRE: "Parcelas de dívidas" (`D.parcelas`)** — idem.
6. **DRE: "Investimentos recorrentes" (`D.investimentos`)** — idem.
7. **DRE: flag `dre_estimados.{cmv,folha,aluguel,outros_cf}`** — booleanos por linha rotulando "estimado" em laranja.
   - **Onde adicionar:** skill v2 — flags por linha do DRE.
8. **Stats da plataforma** ("2.847 negócios", "R$ 1.2B", "1.423 compradores") — já no handoff, não pertence ao calc_json.

---

## ITENS COM FORMATO DIFERENTE (⚠ TEM-DIFERENTE) — adaptação necessária

### ISE 10 → 8 pilares (mapeamento)

Visto na seção 7 acima. 6 renames diretos, 2 viram sub-métricas (`ise_conc` → `p3_comercial.sub_metricas[concentracao_pct]`; `ise_div` → sub-métrica), 1 sumiu (`ise_esc`), 1 novo aparece (`p2_resultado`).

### Atratividade 6 → 3 componentes

V1: 6 pilares de atratividade. V2: 3 componentes (`ise`, `setor`, `crescimento`). 3 pilares v1 sumiram nominalmente: `recorrencia`, `independencia`, `margem`. **Decisão de produto pendente.**

### DRE flat → estruturado

V1 espera campos flat (`D.fat_mensal`, `D.cmv`, `D.aluguel`, `D.mkt`, etc.). V2 organiza em sub-objetos:
- `dre.fat_mensal` (flat ainda)
- `dre.deducoes_receita.{impostos.mensal, taxas_recebimento, comissoes}`
- `dre.pessoal.{clt_folha_bruta, clt_encargos, pj_custo}`
- `dre.ocupacao.{aluguel, facilities, terceirizados}`
- `dre.operacional_outros.{mkt_pago, sistemas, outros_cf}`

Camada de adaptação: cada acesso `D.X` no laudo vira `calc_json.dre.<grupo>.<X>`.

### Balanço flat → estruturado

V1: `D.{caixa, receber, estoque, equip, totAtiv, forn, emprest, totPass, pl}`. V2: `balanco.{ativos.{caixa, contas_receber, estoque, equipamentos, total}, passivos.{fornecedores_a_vencer, saldo_devedor_emprestimos, total}, patrimonio_liquido}`.

### Análise tributária: anual em vez de mensal

V1 usa imposto **mensal** em todas as linhas. V2 fornece em `comparativo_regimes[].imposto_anual` (anual). Adaptação: dividir por 12 ao renderizar.

### Identificação: setor.{code,label} aninhado

V1: `D.setor` (string). V2: `identificacao.setor.{code, label}`. **Pegadinha:** no Stuido Fit o `label` vem como "bem_estar" (slug em vez de label legível) — provável bug a investigar (não escopo deste mapa, registrar pendência).

---

## ITENS AMBÍGUOS (❓) — investigar

1. **CMV mensal direto** — v1 lê `D.cmv`. Não vi `dre.cmv_mensal` nas keys top que listei de `dre`. Pode estar lá com outro nome ou ser derivado de `lucro_bruto = rec_liquida - cmv`.
2. **Provisões CLT** — v1 espera `D.clt_provisoes`. V2 tem `balanco.passivos.provisao_clt_calculada.{valor, formula, fator_encargo_aplicado}` — outra estrutura. Investigar se é o mesmo número.
3. **Endividamento total como indicador** — v1 calcula como `D.emprest / D.ro_anual`. V2 não tem indicador dedicado em `indicadores_vs_benchmark`. Pode derivar.

---

*Cruzamento gerado em 29/04/2026 contra o calc_json v2 ativo do Stuido Fit (id `1a553b5c-e5f8-4fc3-90ca-e6d2be4ed928`). Apenas mapeamento — sem propor implementação.*
