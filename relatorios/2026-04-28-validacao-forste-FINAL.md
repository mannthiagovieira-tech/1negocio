# Validação Forste — FINAL (snapshot v2026.07 + skill atualizada)

Data: 2026-04-28 · Branch: `backend-v2` · Base: commit `f233f0a`

Validação consolidada após o ciclo completo do refactor ISE (Frentes 2.1–2.6,
2.5 calcAtratividadeV2, 2.4 fixtures versionados, fix de gap em fator_ise) e
com Forste sintética usando `crescimento_pct: 8` (resposta vendedor real).

---

## 1. ISE — final

| | valor |
|---|---|
| ISE total | **84.1** |
| Classe | **Consolidado** |
| Fator de classe | **1.15** |

ISE rodado contra v2026.07 (P2 reduzido a 2 sub-métricas, margem_estavel removida)
+ todos os campos novos (`reputacao`, `online`, `remuneracao_socios`, `gestor_autonomo`).

## 2. Atratividade — final

| | valor |
|---|---|
| Atratividade total | **77** |
| Label | **Atrativa** |

Componentes (3, peso 50/25/25):

| componente | score 0-10 | contribuição | fonte |
|---|---|---|---|
| `ise` (Saúde do negócio) | 8.41 | 42.05 | `ise.ise_total` |
| `setor` (Apelo do setor) | 9.00 | 22.50 | `parametros.score_setor_atratividade[servicos_empresas]` |
| `crescimento` (Momentum) | **5.00** | 12.50 | `historico_real` (`crescimento_pct_aplicado=8`) |

Componente Crescimento agora reflete corretamente:
- Vendedor respondeu 8% → fonte `historico_real` → faixa 5-9.9% → score 5
- Pré-Frente 2.5: consumia `crescimento_proj_pct` (projeção do vendedor — viola Regra 2)

## 3. Breakdown por pilar (P1–P8)

| pilar | score | peso | contrib | sub-métricas |
|---|---|---|---|---|
| P1 Financeiro | **10.00** | 20% | 20.00 | margem_op=10, dre_separacao=10, fluxo_caixa=10, contabilidade=10 |
| P2 Resultado | **10.00** | 15% | 15.00 | ebitda_real=10, rentab_imobilizado=10 (margem_estavel removida) |
| P3 Comercial | 6.25 | 15% | 9.38 | num_clientes=5, recorrencia=10, concentracao=0, base_clientes=10 |
| P4 Gestão | 7.67 | 15% | 11.50 | processos=6, tem_gestor=10, sistemas=7 |
| P5 Sócio/Dependência | 8.33 | 10% | 8.33 | opera_sem_dono=10, equipe_permanece=10, prolabore=5 |
| P6 Risco Legal | **10.00** | 10% | 10.00 | passivos_juridicos=10, sem_acao=10, impostos_atrasados_volume=10, sem_impostos_atrasados=10 |
| P7 Balanço | 7.33 | 8% | 5.87 | patrimonio_pos=10, liquidez=5, ncg=7 |
| P8 Marca | 5.67 | 7% | 3.97 | marca_inpi=0, reputacao=7, presenca_digital=10 |
| **Total** | — | — | **84.13** | (skill arredonda pra 84.1) |

## 4. Valuation

| | valor |
|---|---|
| RO anual | R$ 258.120 |
| Múltiplo setor (servicos_empresas) | 2.06 |
| Ajuste forma de atuação (presta_servico) | +0.06 |
| Múltiplo base | 2.12 |
| Fator ISE (Consolidado) | 1.15 |
| Fator final | **2.438** |
| Valor operação | R$ 629.296,56 |
| Patrimônio líquido | R$ 2.679,20 |
| **Valor de venda** | **R$ 631.975,76** |

## 5. Potencial 12m

### 5.1 Tributário

| | valor |
|---|---|
| Regime declarado | Simples (Anexo III) |
| Regime ótimo calculado | Simples (Anexo III) — **já no ótimo** |
| Economia anual | R$ 0 |
| `gera_upside_obrigatorio` | false |

Comparativo de regimes (anual):

| regime | total | alíquota efetiva | viabilidade |
|---|---|---|---|
| MEI | — | — | inelegível (fat > R$ 81k/ano) |
| **Simples III** | **R$ 105.480** | **11.43%** | viável (atual) |
| Presumido | R$ 206.874 | 16.45% | viável |
| Real | R$ 253.450,80 | 22.42% | viável |

### 5.2 Upsides ativos por categoria

| categoria | upside | bruto pct | pos cap pct | brl |
|---|---|---|---|---|
| ro | `ro_renegociar_custos_fixos` | 4.811% | 4.811% | R$ 30.406 |
| multiplo | `mu_diversificar_clientes` | 20.422% | 20.422% | R$ 129.060 |

Total: **2 upsides ativos** + 4 recomendações qualitativas.

### 5.3 Caps por categoria (cap_categoria não aplicado)

| | bruto pct | cap aplicado | capped pct |
|---|---|---|---|
| ro | 4.811% | false | 4.811% |
| passivo | 0% | false | 0% |
| multiplo | 20.422% | false | 20.422% |

### 5.4 Caps globais

| cap | valor | aplicado | resultado |
|---|---|---|---|
| `cap_ise` (faixa 75-89) | 0.65 | false | 25.23% < 65% — passa |
| `cap_absoluto` | 0.80 | false | 25.23% < 80% — passa |

### 5.5 Final monetário

| | valor |
|---|---|
| `potencial_final.pct` | 25.233% |
| `potencial_final.brl` | **R$ 159.466** |
| `valor_projetado_brl` | **R$ 791.441** |

## 6. Recomendações pré-venda (qualitativas)

4 recomendações disparadas (gates do catálogo):

1. **`rec_separar_pf_pj`** — "Separação PF/PJ é pré-requisito de qualquer comprador profissional"
2. **`rec_documentar_processos`** — "Processos documentados reduzem risco percebido pelo comprador e aceleram a transição"
3. **`rec_registrar_marca`** — "Marca registrada no INPI é ativo intangível protegido que entra na composição do valuation"
4. **`rec_aumentar_presenca_digital`** — "Presença digital robusta amplia base de compradores e reduz fricção comercial"

## 7. Comparação Antes vs Depois

### 7.1 Linha do tempo dos commits relevantes

| momento | commit | ISE | valor_venda | observação |
|---|---|---|---|---|
| Pré-refactor (fantasmas ativos) | `629359b` | 82.4 | — | bug: crescimento_proj_pct inflava atratividade |
| Pós ISE refactor (sem fantasmas, margem_estavel zerado) | `6faabdb` | 79.6 | R$ 631.975,76 | drop esperado |
| Pós Frente 2.2/2.3 (margem_estavel removida da P2) | `5201960` | — | — | P2: 3 sub → 2 sub |
| Pós Frente 2.5 (calcAtratividadeV2 corrigido) | `5c938df` | — | — | Crescimento Regra 2 + bug B |
| Pós fix gap fator_ise (ISE arredondado antes do lookup) | `f233f0a` | — | — | classe não fall-through mais |
| **FINAL** (com `crescimento_pct: 8`) | `f233f0a` + fixture v07 | **84.1** | **R$ 631.975,76** | classe Consolidado correta |

### 7.2 Variações principais

- **ISE**: 82.4 (com fantasmas) → 79.6 (limpo, P2 com margem_estavel) → **84.1** (P2 sem margem_estavel + crescimento_pct preenchido)
- **Classe**: era Consolidado em ambos os cenários (75-89), mas pré-fix de gap caía em "Embrionario" por bug de fall-through
- **Atratividade.crescimento**: pré-2.5 score era inflado por `crescimento_proj_pct`; agora score=5 vem da resposta real (`8%` → faixa 5-9.9%)
- **valor_venda**: estável em R$ 631.976 (RO × multiplo_base × fator_classe + PL)
- **valor_projetado_brl**: estável em R$ 791.441 (alavancas pre_ise=25.23%, abaixo do cap 0.65)

## 8. Mismatches que ficam pra resolver depois

Pendência arquitetural já documentada em
[`relatorios/2026-04-28-pendencia-camada-normalizacao.md`](2026-04-28-pendencia-camada-normalizacao.md):

- **9 campos fantasmas** — skill consome, diag nunca salva (parcialmente resolvidos por mapDadosV2; ainda restam)
- **5 mismatches de nome** entre diag e skill (parcialmente endereçados)
- **2 fallbacks ocos** que mascaram dados ausentes
- **Múltiplos mismatches de domínio** ('sim'/'nao' vs booleano vs label)

### Proposta de próxima frente (P1, fora do escopo atual)

Criar função `normalizarDiagnostico(D_raw)` na skill:

1. Recebe D como vem do diagnóstico
2. Aplica todos os mapeamentos de nome conhecidos (`reputacao→reputacao_online`, `online→presenca_digital`, etc.)
3. Aplica padronizações de domínio (sim/nao → boolean, etc.)
4. Devolve `D_normalizado` com schema explícito

Vantagens:
- Único ponto de verdade contratual entre diag e skill
- Adicionar campo novo = mexer em 1 lugar
- Schema documentado em código
- Testes de mapeamento triviais

Esforço estimado: 4–6 horas. Não bloqueia trabalho atual; atacar após merge do refactor em main.

## 9. Fixtures de validação

5 fixtures versionados em `validacao/skill-fixtures/`, todos rodando com exit 0:

| fixture | snapshot | foco |
|---|---|---|
| `test-mapdados.js` | v2026.07 | smoke `mapDadosV2` (5 mapeamentos novos) |
| `test-gerar-upsides-v2.js` | v2026.07 | listar ativos/paywalls do `gerarUpsidesV2` |
| `test-agregar-potencial.js` | v2026.07 | 16 asserções numéricas em `agregarPotencial12mV2` |
| `test-v06.js` | v2026.06 | regressão da v06 (P2 ainda com margem_estavel) |
| `forste-completo.js` | v2026.07 | dump amplo do Forste (este relatório) |

Roteiro de execução: `node validacao/skill-fixtures/<arquivo>.js` (cada um stand-alone).

## 10. Snapshot atual em `parametros_versoes`

| versão | ativo | notas |
|---|---|---|
| v2026.04 | false | inicial |
| v2026.05 | false | catálogo upsides + caps + pesos |
| v2026.06 | false | pesos_sub_metricas_ise reestruturado (P6 renomeada, P8 reativa presenca_digital) |
| **v2026.07** | **true** | **P2 reduzido a 2 sub-métricas (margem_estavel removida)** |

Migração SQL `008_seed_parametros_v2026_07.sql` aguarda aplicação manual no banco.

## 11. Resumo executivo

Forste pós-refactor completo, com `crescimento_pct: 8`, snapshot v2026.07 ativo:

- **ISE 84.1** (Consolidado, fator 1.15) — classe correta após fix de gap
- **Atratividade 77** (Atrativa) — Crescimento agora reflete resposta real
- **Valor de venda R$ 631.976**
- **Potencial 12m R$ 159.466** → **valor projetado R$ 791.441**
- **2 upsides monetários ativos** (RO + Múltiplo) + 4 recomendações qualitativas
- **Tributário não dominante** (já no regime ótimo)
- **Cap ISE não acionou** (25.23% bem abaixo do cap 65% da faixa 75-89)

Próxima frente sugerida: refactor da camada de normalização (item 8).
