# Mapa de campos — calc_json v2 (schema v2026.07)

**Data:** 29/04/2026
**Tipo:** Investigação somente leitura — input pra escrever os 9 prompts da Fase 4
**Fonte:** dump empírico do Forste sintético via `gen-demo-data.js` + leitura de `montarCalcJsonV2` em `skill-avaliadora-v2.js:2638`
**Total:** 21 top-level keys, ~250 campos folha (incluindo aninhados)

> Forste sintético usado: nome "Forste Consultoria (DEMO)", servicos_empresas, Florianópolis/SC, 7 anos, fat 65k/mês, recorrência 90%, crescimento_pct 8%, 3 funcionários (2 CLT + 1 PJ), 22 clientes ativos.

---

## SUMÁRIO RÁPIDO — top-level keys

| key | tipo | sempre presente? |
|---|---|---|
| `_versao_calc_json` | string `"2.0"` | sim |
| `_versao_parametros` | string `"v2026.07"` | sim |
| `_data_avaliacao` | string ISO timestamp | sim |
| `_skill_versao` | string `"2.0.0-etapa2.9"` | sim |
| `_modo` | string `"preview"\|"commit"\|"demo"` | sim |
| `identificacao` | object (13 keys) | sim |
| `inputs_origem` | object (54 keys) | sim |
| `dre` | object (22 keys, 5 blocos) | sim |
| `balanco` | object (5 keys) | sim |
| `ise` | object (4 keys + pilares[8]) | sim |
| `valuation` | object (13 keys) | sim |
| `atratividade` | object (3 keys + componentes[3]) | sim |
| `operacional` | object (8 keys) | sim |
| `icd` | object (5 keys) | sim |
| `indicadores_vs_benchmark` | object (18 indicadores) | sim |
| `analise_tributaria` | object (11 keys + comparativo[4]) | sim |
| `upsides` | object `{ativos[], paywalls[]}` | sim |
| `textos_ia` | object (placeholders Fase 4) | sim |
| `textos_anuncio` | object (placeholders Fase 4-bis) | sim |
| `potencial_12m` | object (agregação + caps + final) | sim |
| `recomendacoes_pre_venda` | array `[{id, label, mensagem}]` | sim |

---

## ESTRUTURA DETALHADA POR BLOCO

### `identificacao` (13 keys)

```
identificacao
├── id: uuid|null                           # null em modo preview/demo
├── codigo_diagnostico: string              # "DEMO" / "1N-RZHUYL"
├── slug: string|null                       # "forste-demo"
├── nome: string                            # "Forste Consultoria (DEMO)"
├── nome_responsavel: string|null
├── tipo_negocio_breve: string|null         # ⚠ frequentemente null
├── setor
│   ├── code: string                        # "servicos_empresas"
│   └── label: string                       # ⚠ HOJE igual a code (não humano)
├── modelo_atuacao
│   ├── selecionados: string[]              # ["presta_servico"]
│   └── principal: string                   # "presta_servico"
├── regime_tributario_declarado
│   ├── code: string                        # "simples" / "presumido" / "real" / "mei"
│   ├── label: string                       # "Simples Nacional"
│   ├── anexo_simples: string|null          # "III"
│   ├── fator_r_calculado: number           # 0.2615 (proporção, não %)
│   └── observacao_fator_r: string|null
├── localizacao
│   ├── cidade: string                      # "Florianópolis"
│   └── estado: string                      # "SC"
├── tempo_operacao_anos: number             # 7
├── expectativa_valor_dono: number          # 600000 (R$)
└── pct_produto: number                     # 0 (% — 0=puro serviço)
```

**Pra prompts**: `nome`, `setor.code/label`, `cidade`, `estado`, `tempo_operacao_anos`, `regime_tributario_declarado.{code,label,anexo_simples}` são essenciais. **Atenção**: `setor.label` hoje é igual a `setor.code` (label cru "servicos_empresas") — pendência da skill v2026.07.

### `dre` (22 keys, 5 blocos)

Estrutura tem **redundância proposital**: 5 blocos detalhados (`bloco_1_receita` até `bloco_5_caixa`) **E** campos top-level com valores agregados (`fat_anual`, `ro_anual`, etc). Pra prompts, usar os top-level (mais simples).

```
dre (top-level — usar isso nos prompts)
├── fat_mensal: number              # 65000 (R$)
├── fat_anual: number               # 780000 (R$)
├── rec_liquida: number             # 57570 (R$ mensal)
├── rec_liquida_mensal: number      # 57570 (alias)
├── cmv: number                     # 0
├── lucro_bruto: number             # 57570
├── lucro_bruto_mensal: number      # 57570
├── folha_total: number             # 18360 (R$ mensal)
├── ro_mensal: number               # 21510
├── ro_anual: number                # 258120
├── margem_operacional_pct: number  # 33.09 (%)
├── lucro_liquido_mensal: number    # 21510
├── potencial_caixa_mensal: number  # 21510
├── deducoes_receita: object        # 10 keys (impostos, taxas, royalties)
├── pessoal: object                 # clt_folha_bruta, encargos, pj_custo
├── ocupacao: object                # aluguel, facilities, terceirizados
└── operacional_outros: object      # sistemas, mkt_pago, outros_cf
```

**Cuidado com NÃO existência de `crescimento_pct` em dre**: a skill v2 NÃO armazena `crescimento_pct` no calc_json em campo dedicado. Aparece em `inputs_origem.crescimento_pct = 'informado'` e em `atratividade.componentes[2].crescimento_pct_aplicado`. Pra usar em prompts, ler de lá.

### `balanco` (5 keys)

```
balanco
├── ativos
│   ├── caixa: number               # 25000
│   ├── contas_receber: number      # 8000
│   ├── estoque: number              # 0
│   ├── equipamentos: number        # 12000
│   ├── imovel: number              # 0
│   ├── ativo_franquia: number      # 0
│   ├── outros: number               # 0
│   ├── total: number                # 45000
│   └── imobilizado_total: number   # 12000
├── passivos
│   ├── fornecedores_a_vencer: number              # 6000
│   ├── fornecedores_atrasados: number             # 0
│   ├── impostos_atrasados_sem_parcelamento: number # 0
│   ├── saldo_devedor_emprestimos: number          # 22000
│   ├── provisao_clt_calculada: object             # {valor, formula, fator, regime_referencia}
│   ├── outros_passivos: number                    # 0
│   └── total: number                              # 42321
├── patrimonio_liquido: number                     # 2679 (PL)
├── ncg
│   ├── valor: number                              # 2000
│   └── calculo: string                            # fórmula
└── ciclo_financeiro
    ├── pmr_dias: number                           # 30
    ├── pmp_dias: number                           # 15
    └── ciclo_dias: number                         # 15 (= PMR - PMP)
```

### `ise` (4 keys + 8 pilares)

```
ise
├── ise_total: number               # 84.1 (0-100)
├── classe: string                  # "Consolidado" (Embrionario|Operacional|Consolidado|Estruturado)
├── fator_classe: number            # 1.15 (multiplicador no valuation)
└── pilares: array (8 itens)
    └── [i]
        ├── id: string              # "p1_financeiro"|"p2_resultado"|...|"p8_marca"
        ├── label: string           # "Financeiro"
        ├── peso_pct: number        # 20 (proporcional, soma 100)
        ├── score_0_10: number      # 10.0
        ├── contribuicao_no_total: number   # 20.0 (peso × score / 10)
        └── sub_metricas: array     # 2-4 itens, cada com {id, label, score_0_10, peso_decimal}
```

### `valuation` (13 keys)

```
valuation
├── multiplo_setor
│   ├── codigo: string              # "servicos_empresas"
│   ├── label: string
│   └── valor: number               # 2.06
├── ajuste_forma_atuacao
│   ├── principal: object           # {codigo, valor}
│   ├── outras: array
│   └── total_ajuste: number        # 0.06
├── multiplo_base: number           # 2.12 (= multiplo_setor + total_ajuste)
├── fator_ise
│   ├── classe: string              # "Consolidado"
│   ├── valor: number               # 1.15
│   └── faixa: string               # "Consolidado (ISE: 84.1)"
├── fator_final: number             # 2.438 (= multiplo_base × fator_ise)
├── ro_anual: number                # 258120 (echo de dre.ro_anual)
├── valor_operacao: number          # 629296 (= ro_anual × fator_final)
├── patrimonio_liquido: number      # 2679 (echo de balanco.patrimonio_liquido)
├── valor_venda: number             # 631976 (= valor_operacao + PL)  ⭐ KPI principal
├── ro_negativo: boolean            # false
├── ro_negativo_msg: string|null
├── cta_especialista: string|null   # tema RO≤0
└── alerta_pl_negativo: object|null # {mensagem} se PL<0
```

⭐ **Pra prompts**: `valor_venda` é o número soberano. Quando `ro_negativo=true`, usar fluxo alternativo (ver §11.5 da spec).

### `atratividade` (3 keys)

```
atratividade
├── total: number                   # 77 (0-100, integer)
├── label: string                   # "Atrativa" (faixas: Alta|Atrativa|Padrão|Limitada|Baixa)
└── componentes: array (3)
    └── [i]
        ├── id: string              # "ise"|"setor"|"crescimento"
        ├── label: string           # "Saúde do negócio"|"Apelo do setor"|"Momentum de crescimento"
        ├── peso_pct: number        # 50|25|25
        ├── score_0_10: number      # 8.41|9|5
        ├── contribuicao_no_total: number
        └── (componente 'crescimento' tem campos extras)
            ├── fonte_crescimento: string   # "historico_real"|"sem_resposta"
            ├── crescimento_pct_aplicado: number   # 8 (%)
            ├── penalidade_aplicada: number # 0
            └── metadata: object|null       # {componente, motivo, score} quando sem_resposta
```

⭐ **Aqui mora o `crescimento_pct` real**: `atratividade.componentes[2].crescimento_pct_aplicado`.

### `operacional` (8 keys)

```
operacional
├── num_funcionarios: number        # 3 (CLT + PJ)
├── num_clientes: number            # 22
├── tempo_operacao_anos: number     # 7 (echo)
├── fat_mensal: number              # 65000 (echo)
├── fat_anual: number               # 780000 (echo)
├── num_socios: number              # 1
├── prolabore_mensal_total: number  # 0 (R$)
└── concentracao_status: string     # "abaixo"|"atencao"|"no_alvo" (status da concentração de cliente top-1)
```

### `indicadores_vs_benchmark` (18 indicadores)

Cada chave é um id de indicador, valor é objeto:

```
indicadores_vs_benchmark.<id>
├── id: string
├── label: string                   # human-readable
├── valor: number                   # do negócio
├── unidade: string                 # "%"|"R$"|"dias"|"unid"
├── benchmark: number|null          # do setor (null quando sem bench)
├── delta_pp: number|null           # diferença em pontos percentuais
├── status: string|null             # "no_alvo"|"atencao"|"abaixo"|"neutro"|null
├── sentido: string                 # "maior_melhor"|"menor_melhor"|"neutro"
├── regra_aplicada: string          # explicação da regra
└── observacao: string|null
```

**18 indicadores**: `margem_operacional`, `margem_bruta`, `margem_liquida`, `cmv_pct`, `folha_pct`, `aluguel_pct`, `mkt_pct`, `outros_cf_pct`, `deducoes_pct`, `concentracao`, `recorrencia`, `num_clientes`, `ticket_medio`, `pmr_dias`, `pmp_dias`, `ciclo_financeiro_dias`, `ncg_valor`, `ro_por_funcionario_mensal`.

⭐ **Pra prompts**: filtrar por `status === "abaixo"` ou `status === "atencao"` lista os críticos. Pra "diferenciais", filtrar por `status === "no_alvo"`. **Sempre checar null em `benchmark`** (8 dos 18 não têm bench setorial).

### `analise_tributaria` (11 keys)

```
analise_tributaria
├── regime_declarado: string        # "simples"|"presumido"|"real"|"mei"
├── anexo_simples: string|null      # "III"
├── fator_r_calculado: number       # 0.2615 (proporção)
├── fator_r_observacao: string|null
├── regime_otimo_calculado: string  # "simples" — pode ser igual ou diferente do declarado
├── regime_otimo_anexo: string|null
├── comparativo_regimes: array (4)  # MEI/Simples/Presumido/Real
│   └── [i]
│       ├── regime: string
│       ├── elegivel: boolean
│       ├── motivo_inelegibilidade: string|null
│       ├── imposto_anual: number
│       ├── encargo_folha_anual: number
│       ├── total_anual: number
│       ├── aliquota_efetiva_pct: number
│       ├── viabilidade: string     # "viavel"|"inviavel"
│       ├── razao_inviabilidade: string|null
│       ├── detalhes: string
│       └── decomposicao: object    # PIS, COFINS, IRPJ, etc
├── economia_potencial
│   ├── comparado_a: string         # regime atual
│   ├── regime_recomendado: string
│   ├── economia_anual: number      # 0 quando já está no ótimo
│   ├── economia_pct_do_ro: number  # %
│   └── observacao: string          # "Negócio já está no regime ótimo"
├── gera_upside_obrigatorio: boolean
├── alerta_inelegibilidade: object|null
└── regra_obrigatorio: string       # "economia anual > R$ 10.000 E > 5% do RO anual"
```

### `upsides` (objeto, NÃO array — schema v2026.07)

```
upsides
├── ativos: array (até ~10)         # gates dispararam, contribuição calculada
│   └── [i]
│       ├── id: string              # "ro_renegociar_custos_fixos"
│       ├── categoria: string       # "ro"|"passivo"|"multiplo"|"qualitativo"
│       ├── label: string           # "Renegociar custos fixos"
│       ├── descricao: string
│       ├── gate: object            # {expressao}
│       ├── formula_calculo: object # {tipo, parametros}
│       └── fonte_de_calculo: string
└── paywalls: array (3 fixos)       # categoria sempre "paywall"
    └── [i]                         # mesma estrutura, label R$99
```

⭐ **Pra prompts**: iterar `upsides.ativos[]` filtrando por `categoria` (qualitativo não tem brl). Pra contribuições monetárias, cruzar com `potencial_12m.upsides_ativos[]`.

### `potencial_12m` (5 keys) — **Schema novo v2026.07**

```
potencial_12m
├── _versao: string                 # "v2.1"
├── upsides_ativos: array           # SUBSET de upsides.ativos (só os com brl)
│   └── [i]
│       ├── id: string
│       ├── categoria: string       # "ro"|"passivo"|"multiplo"
│       ├── label: string
│       ├── contribuicao_bruta_pct: number       # 0.0481 (proporção)
│       ├── contribuicao_pos_cap_categoria_pct: number
│       └── contribuicao_brl: number              # 30406 (R$)
├── agregacao
│   ├── tributario
│   │   ├── brl: number             # 0 quando já no ótimo
│   │   ├── pct: number
│   │   ├── sem_cap: boolean        # true (tributário não passa por caps)
│   │   └── fonte: string
│   ├── por_categoria
│   │   ├── ro: {bruto_pct, cap_aplicado, capped_pct}
│   │   ├── passivo: {bruto_pct, cap_aplicado, capped_pct}
│   │   └── multiplo: {bruto_pct, cap_aplicado, capped_pct}
│   ├── potencial_alavancas_pre_ise_pct: number  # 0.2523
│   ├── cap_ise
│   │   ├── ise_score: number
│   │   ├── ise_score_arredondado: number
│   │   ├── faixa: string           # "75-89"
│   │   ├── cap_aplicavel: number   # 0.65
│   │   ├── cap_aplicado: boolean   # false (não atingiu o cap)
│   │   └── potencial_pos_ise_pct: number
│   ├── cap_absoluto
│   │   ├── threshold: number       # 0.80
│   │   ├── aplicado: boolean
│   │   └── potencial_pos_absoluto_pct: number
│   └── tributario_dominante: boolean
├── potencial_final
│   ├── pct: number                 # 0.2523 (proporção)
│   ├── brl: number                 # 159466 (R$ delta)
│   └── valor_projetado_brl: number # 791441 (R$ valor_venda + delta)
└── ordenacao_exibicao: array
```

⭐ **Pra prompts** especialmente texto #9 "Considerações sobre valor": `potencial_final.pct` (delta proporcional) e `valor_projetado_brl` são os números-chave.

### `recomendacoes_pre_venda` (array)

```
recomendacoes_pre_venda: array (4 itens no Forste)
└── [i]
    ├── id: string                  # "rec_separar_pf_pj"
    ├── label: string
    └── mensagem: string
```

### `textos_ia` (10 keys — **placeholders Fase 4**)

```
textos_ia
├── _gerados_em: string|null        # ISO timestamp quando gerados
├── _modelos_usados: object|null    # {haiku: "claude-haiku-...", sonnet: "..."}
├── status: string                  # "pendente_geracao"|"concluido"|"erro_persistente"
├── texto_resumo_executivo_completo: {modelo: "haiku", conteudo: null}
├── texto_contexto_negocio: {modelo: "haiku", conteudo: null}
├── texto_parecer_tecnico: {modelo: "sonnet", conteudo: null}
├── texto_riscos_atencao: {modelo: "sonnet", conteudo: null}
├── texto_diferenciais: {modelo: "haiku", conteudo: null}
├── texto_publico_alvo_comprador: {modelo: "sonnet", conteudo: null}
└── descricoes_polidas_upsides: array (vazio)  # itens: {id, conteudo}
```

### `textos_anuncio` (5 keys — **placeholders Fase 4-bis**)

```
textos_anuncio
├── _gerados_em: null
├── _status: string                 # "nao_gerado"
├── texto_resumo_executivo_anonimo: {modelo: "haiku", conteudo: null, _aguarda: "criacao_anuncio"}
├── sugestoes_titulo_anuncio: {modelo: "haiku", conteudo: []}
└── texto_consideracoes_valor: {modelo: "sonnet", conteudo: null, _input_necessario: "negocios.preco_pedido"}
```

---

## CAMPOS ESPECIALMENTE ÚTEIS PROS PROMPTS

### Valores em R$ (pra formatar com `fc()` ou template `R$ X`)

- `valuation.valor_venda` ⭐
- `valuation.valor_operacao`
- `valuation.patrimonio_liquido`
- `valuation.ro_anual`
- `dre.fat_mensal`, `dre.fat_anual`, `dre.ro_mensal`, `dre.ro_anual`
- `dre.folha_total`, `dre.lucro_bruto`, `dre.rec_liquida`
- `balanco.ativos.total`, `balanco.passivos.total`, `balanco.patrimonio_liquido`, `balanco.ncg.valor`
- `identificacao.expectativa_valor_dono`
- `operacional.prolabore_mensal_total`
- `analise_tributaria.economia_potencial.economia_anual`
- `potencial_12m.potencial_final.brl` ⭐ delta
- `potencial_12m.potencial_final.valor_projetado_brl` ⭐
- `potencial_12m.upsides_ativos[].contribuicao_brl`
- `potencial_12m.agregacao.tributario.brl`
- `comparativo_regimes[].imposto_anual / total_anual`
- `indicadores_vs_benchmark.{ticket_medio,ncg_valor,ro_por_funcionario_mensal}.valor`

### Valores em % (já como número 0-100, NÃO proporção)

- `dre.margem_operacional_pct` (33.09)
- `ise.ise_total` (84.1)
- `atratividade.total` (77)
- `atratividade.componentes[].peso_pct`, `score_0_10`, `contribuicao_no_total`
- `identificacao.regime_tributario_declarado.fator_r_calculado` ⚠ (PROPORÇÃO 0-1, não %)
- `analise_tributaria.fator_r_calculado` idem
- `analise_tributaria.comparativo_regimes[].aliquota_efetiva_pct`
- `analise_tributaria.economia_potencial.economia_pct_do_ro`
- `indicadores_vs_benchmark.<id>.valor` (quando `unidade === "%"`)

### Valores em proporção (0-1, multiplicar por 100 pra %)

- `potencial_12m.potencial_final.pct` (0.2523 = 25.23%)
- `potencial_12m.upsides_ativos[].contribuicao_bruta_pct`
- `potencial_12m.agregacao.{cap_ise.cap_aplicavel, cap_absoluto.threshold}`
- `identificacao.regime_tributario_declarado.fator_r_calculado` (0.26)

### Arrays pra iterar

- `ise.pilares` (8 — sempre completo)
- `atratividade.componentes` (3 — sempre completo)
- `upsides.ativos` (variável; até ~10)
- `upsides.paywalls` (3 fixos)
- `potencial_12m.upsides_ativos` (variável; subset monetário)
- `recomendacoes_pre_venda` (variável)
- `analise_tributaria.comparativo_regimes` (4 — MEI/Simples/Presumido/Real)
- `icd.respondidos[]` e `icd.nao_respondidos[]`
- `inputs_origem` (54 keys — não array, mas iterável via Object.entries)

### Campos que podem vir null/undefined (precisa fallback no prompt)

- `identificacao.id` — null em `_modo: 'preview'` e `'demo'`
- `identificacao.tipo_negocio_breve` — frequentemente null
- `identificacao.regime_tributario_declarado.{anexo_simples, observacao_fator_r}` — null se não-Simples
- `valuation.{ro_negativo_msg, cta_especialista, alerta_pl_negativo}` — null no caminho feliz
- `indicadores_vs_benchmark.<id>.{benchmark, delta_pp, status, observacao}` — null em 8/18 indicadores (sem bench setorial)
- `analise_tributaria.{alerta_inelegibilidade}` — null no caminho feliz
- `analise_tributaria.comparativo_regimes[].{anexo, motivo_inelegibilidade, observacao, razao_inviabilidade}` — variam
- `balanco.passivos.provisao_clt_calculada` — só se folha CLT > 0
- `textos_ia.*.conteudo` — todos null até Fase 4 rodar
- `textos_anuncio.*.conteudo` — todos null até Fase 4-bis rodar

### Campos com benchmark/comparativo embutido

- `indicadores_vs_benchmark.<id>` — formato uniforme `{valor, benchmark, delta_pp, status}`
- `analise_tributaria.comparativo_regimes[]` — comparação cross-regime
- `ise.pilares[].sub_metricas[]` — score_0_10 por sub-métrica (peso interno)

### Campos derivados que **parecem dados crus mas vêm calculados pela skill**

- `potencial_12m.potencial_final.valor_projetado_brl` — soma de `valuation.valor_venda + potencial_final.brl`
- `valuation.fator_final` — `multiplo_base × fator_ise.valor`
- `dre.margem_operacional_pct` — `ro_anual / fat_anual × 100`
- `balanco.ncg.valor` — `contas_receber + estoque - fornecedores_a_vencer - fornecedores_atrasados`
- `balanco.ciclo_financeiro.ciclo_dias` — `pmr_dias - pmp_dias`
- `atratividade.total` — agregação dos 3 componentes
- `ise.ise_total` — soma de `pilares[].contribuicao_no_total`
- `icd.pct` — `respondidos.length / total × 100`

---

## PEGADINHAS PRA PROMPT ENGINEERING

1. **`setor.label === setor.code`** hoje — labels humanos (e.g. "Serviços B2B" em vez de `servicos_empresas`) **não vêm da skill**. Prompts que querem mostrar setor humano precisam ter mapa local ou tratar a feiura.

2. **`regime_tributario_declarado.fator_r_calculado` é PROPORÇÃO** (0.2615), não percentual (26.15%). Multiplicar por 100 antes de exibir.

3. **`crescimento_pct` NÃO está em `dre`** — vive em `atratividade.componentes[2].crescimento_pct_aplicado`.

4. **`upsides` é OBJETO `{ativos, paywalls}`**, não array (schema v2026.07). Loops antigos `upsides.forEach()` quebram.

5. **`upsides.ativos[]` ⊃ `potencial_12m.upsides_ativos[]`** — o segundo é subset (só os com `categoria !== 'qualitativo'` e gate disparou contribuição monetária). Pra valores R$, usar `potencial_12m.upsides_ativos[]`. Pra cards qualitativos (sem R$), usar `upsides.ativos[].filter(u => u.categoria === 'qualitativo')`.

6. **`indicadores_vs_benchmark.<id>.benchmark` pode ser null** em 8 dos 18 indicadores. Prompts devem checar antes de comparar.

7. **`potencial_final.pct` é proporção (0.2523)**, não percentual (25.23%).

8. **`valuation.ro_negativo === true`** muda toda a lógica do laudo (ver §11.5 da spec). Prompts devem ter caminho alternativo pra esse cenário.

9. **Frases prescritivas hardcoded foram deletadas em 29/04** (Atratividade veredicto, "Negócio já está no regime ótimo", Fator R) — geração via IA é o caminho oficial. Mas os campos-fonte (`economia_potencial.observacao`, `fator_r_observacao`) ainda existem como input pra IA.

10. **`textos_ia.*.modelo`** define qual modelo Anthropic usar pra cada texto. Edge Function deve respeitar essa atribuição (`haiku` pros descritivos, `sonnet` pros analíticos) — alinha com spec rev3 §11.3.

---

## REFERÊNCIAS

- Spec rev3 §11 (textos IA) e §3 (schema): `relatorios/spec-v2-final-rev3.md`
- Mapeamento de textos editoriais: `relatorios/2026-04-29-mapeamento-textos-editoriais.md`
- Função fonte: `skill-avaliadora-v2.js:2638` (`montarCalcJsonV2`)
- Dump fonte: `/tmp/demo-data-fresh.json` (Forste sintético)
