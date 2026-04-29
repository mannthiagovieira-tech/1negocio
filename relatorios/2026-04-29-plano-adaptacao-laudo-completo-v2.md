# Plano de adaptação — laudo-completo.html → 100% v2

**Data:** 29/04/2026
**Princípio:** laudo é PURO RENDERIZADOR. Tudo vem pronto da v2.

**Princípio v2 ganha:** quando v2 e v1 divergem em estrutura ou conceito, a v2 vence. Adaptações retrocedem v2 pra parecer com v1 são proibidas.

---

## DECISÕES DE PRODUTO REGISTRADAS

| Tema | Decisão Thiago |
|------|----------------|
| ISE | 8 pilares (apenas os da v2). Sem Escalabilidade. |
| Atratividade | 3 pilares (apenas os da v2). |
| DRE | Mostrar completo, incluindo Antecipação, Parcelas, Investimentos, flags `dre_estimados`. |
| Balanço Patrimonial | Mostrar completo. |
| Stats plataforma | Hardcode segue. Decisão depois. |
| Provisões trabalhistas | SÓ no Balanço Patrimonial. Label "Provisões trabalhistas". Não aparece no DRE. |
| Endividamento | Skill v2 calcula `endividamento_pct = saldo_devedor / ro_anual` e expõe como indicador. |
| Princípio | ZERO cálculo na hora no laudo. |

---

## TRABALHO NA SKILL V2

(itens que exigem skill v2 calcular novos campos)

### S2.1 — Propagar `descricao` em `potencial_12m.upsides_ativos[]`
**Categoria A do cruzamento.**

Hoje: `upsides.ativos[]` tem `descricao` (catálogo). Mas `potencial_12m.upsides_ativos[]` (resultado agregado) NÃO tem.

Pra renderizar top 3 upsides com texto descritivo, skill v2 precisa propagar.

**Trabalho:** ao montar `potencial_12m.upsides_ativos`, fazer JOIN com `upsides.ativos` por `id` e copiar campo `descricao` (e talvez `label` se ainda não estiver).

**Prioridade:** P0 (bloqueia bloco "Potencial 1Sócio" do laudo).

---

### S2.2 — Adicionar linhas DRE faltantes
**Decisão Thiago: DRE completo, mostrar tudo.**

Adicionar à `calc_json.dre` (3 campos):

- `antecipacao_recebiveis_mensal` (BRL)
- `parcelas_dividas_mensal` (BRL)
- `investimentos_recorrentes_mensal` (BRL)

Origem: vir do questionário do diagnóstico (se o vendedor declarou) ou calculado pela skill v2 (se houver heurística).

**Trabalho:** verificar se diagnóstico já captura. Se não, adicionar perguntas. Se sim, propagar pro calc_json.

**Prioridade:** P0 (Thiago quer mostrar no laudo).

---

### S2.3 — Adicionar flags `dre_estimados`
**Decisão Thiago: rotular linhas como "estimado" quando aplicável.**

Adicionar à `calc_json.dre`:

```json
"dre_estimados": {
  "cmv": true | false,
  "folha": true | false,
  "aluguel": true | false,
  "outros_cf": true | false
}
```

A skill v2 já decide internamente quando usa benchmark vs valor declarado; só precisa expor essa info.

**Prioridade:** P0 (Thiago quer mostrar rótulo "estimado" no laudo).

---

### S2.4 — Calcular indicador de endividamento
**AMB.3 resolvido. Decisão Thiago: skill v2 calcula.**

Adicionar à `calc_json.indicadores_vs_benchmark` novo item:

```json
"endividamento_vs_ro": {
  "id": "endividamento_vs_ro",
  "label": "Endividamento vs RO Anual",
  "valor": <saldo_devedor_emprestimos / ro_anual>,
  "valor_formatado": "<X>%",
  "benchmark_no_alvo_max": 1.0,
  "benchmark_atencao_max": 2.0,
  "status": "no_alvo" | "atencao" | "abaixo",
  "sentido": "menor_melhor",
  "regra_aplicada": "endividamento sobre RO anual"
}
```

Inputs:
- `balanco.passivos.saldo_devedor_emprestimos`
- `dre.ro_anual` (ou `valuation.ro_anual`)

**Trabalho:** adicionar cálculo na skill v2, expor no calc_json.

**Prioridade:** P0.

---

## TRABALHO NO CALC_JSON V2 (sem mexer skill, só formato)

### CJ.1 — Confirmar estrutura completa do Balanço Patrimonial

O calc_json v2 já tem `balanco.ativos.{caixa,contas_receber,estoque,equipamentos,imovel,ativo_franquia,outros,imobilizado_total,total}` e `balanco.passivos.{fornecedores_a_vencer,fornecedores_atrasados,saldo_devedor_emprestimos,outros_passivos,impostos_atrasados_sem_parcelamento,provisao_clt_calculada,total}`. Validar se TODOS os campos do BP do laudo v1 estão cobertos.

**Trabalho:** mapear linha por linha do BP exibido no laudo v1 e confirmar existência no calc_json v2 do Stuido Fit.

**Prioridade:** P0 (Thiago quer BP completo no laudo).

---

## TRABALHO NO LAUDO-COMPLETO.HTML

### L.1 — Trocar query de `laudos_completos` para `laudos_v2`

Linha atual 1497: `D = data[0].calc_json;`
Linha atual 1494: `fetch(SUPABASE_URL+'/rest/v1/laudos_completos?slug=eq.'+negocioId+'&select=calc_json', ...)`

Hoje: query em `laudos_completos`.
Depois: query em `laudos_v2` filtrando por `negocio_id` + `ativo=true`:
```js
fetch(SUPABASE_URL + '/rest/v1/laudos_v2?negocio_id=eq.' + negocioId + '&ativo=eq.true&select=calc_json&limit=1', {headers:H})
```

**Prioridade:** P0 (é o switch que liga tudo).

---

### L.2 — Atualizar paths para schema v2

Lista consolidada vinda do cruzamento (relatorios/2026-04-29-cruzamento-laudo-x-calcjson-v2.md). Cada acesso `D.X` no laudo precisa virar o novo path.

**Identificação:**
| Path antigo (v1) | Path novo (v2) |
|------------------|----------------|
| `D.nome` | `identificacao.nome` |
| `D.codigo` | `identificacao.codigo_diagnostico` ou `identificacao.slug` |
| `D.setor`, `D.setor_raw` | `identificacao.setor.label` (atenção: hoje vem "bem_estar" como label — pode precisar ajuste) |
| `D.cidade` | `identificacao.localizacao.cidade` |
| `D.estado` | `identificacao.localizacao.estado` |
| `D.anos` | `identificacao.tempo_operacao_anos` |
| `D.regime` | `identificacao.regime_tributario_declarado` (slug; mapear pra label) |
| `D.expectativa_val` | `identificacao.expectativa_valor_dono` |
| `D.data_avaliacao` | `_data_avaliacao` (top-level) |

**DRE:**
| Path antigo (v1) | Path novo (v2) |
|------------------|----------------|
| `D.fat_mensal` | `dre.fat_mensal` |
| `D.fat_anual` | `dre.fat_anual` |
| `D.ro_mensal` | `dre.ro_mensal` |
| `D.ro_anual` | `dre.ro_anual` |
| `D.rec_liq` | `dre.rec_liquida_mensal` |
| `D.lb` | `dre.lucro_bruto_mensal` |
| `D.margem_pct` | `dre.margem_operacional_pct` |
| `D.potencial_caixa` | `dre.potencial_caixa_mensal` |
| `D.impostos` | `dre.deducoes_receita.impostos.mensal` |
| `D.taxas` | `dre.deducoes_receita.taxas_recebimento` |
| `D.comissoes` | `dre.deducoes_receita.comissoes` |
| `D.royalty` | derivar de `dre.deducoes_receita.royalty_pct_aplicado × fat` |
| `D.mkt_franq` | derivar de `dre.deducoes_receita.mkt_franquia_pct_aplicado × fat` |
| `D.cmv` | `dre.cmv` (AMB.1 resolvido — sem `_mensal` no nome) |
| `D.clt_folha` | `dre.pessoal.clt_folha_bruta` |
| `D.clt_encargos` | `dre.pessoal.clt_encargos` |
| `D.clt_provisoes` | **NÃO renderizar no DRE.** Mover pra BP como "Provisões trabalhistas" via `balanco.passivos.provisao_clt_calculada.valor` (AMB.2 — decisão Thiago) |
| `D.pj_custo` | `dre.pessoal.pj_custo` |
| `D.folha` | `dre.pessoal.folha_total` |
| `D.aluguel` | `dre.ocupacao.aluguel` |
| `D.facilities` | `dre.ocupacao.facilities` |
| `D.terceirizados` | `dre.ocupacao.terceirizados` |
| `D.sistemas` | `dre.operacional_outros.sistemas` |
| `D.cf` | `dre.operacional_outros.outros_cf` |
| `D.mkt` | `dre.operacional_outros.mkt_pago` |
| `D.prol` | `operacional.prolabore_mensal_total` |
| `D.antecipacao` | `dre.antecipacao_recebiveis_mensal` (S2.2) |
| `D.parcelas` | `dre.parcelas_dividas_mensal` (S2.2) |
| `D.investimentos` | `dre.investimentos_recorrentes_mensal` (S2.2) |
| `D.dre_estimados.{cmv,folha,aluguel,outros_cf}` | `dre.dre_estimados.{cmv,folha,aluguel,outros_cf}` (S2.3) |

**Balanço:**
| Path antigo (v1) | Path novo (v2) |
|------------------|----------------|
| `D.caixa` | `balanco.ativos.caixa` |
| `D.receber` | `balanco.ativos.contas_receber` |
| `D.estoque` | `balanco.ativos.estoque` |
| `D.equip` | `balanco.ativos.equipamentos` |
| `D.imovel` | `balanco.ativos.imovel` |
| `D.ativo_franquia` | `balanco.ativos.ativo_franquia` |
| `D.totAtiv` | `balanco.ativos.total` |
| `D.forn` | `balanco.passivos.fornecedores_a_vencer` (+ `fornecedores_atrasados` se mostrar) |
| `D.emprest` | `balanco.passivos.saldo_devedor_emprestimos` |
| `D.totPass` | `balanco.passivos.total` |
| `D.pl` | `balanco.patrimonio_liquido` |

**Valuation / Fator:**
| Path antigo (v1) | Path novo (v2) |
|------------------|----------------|
| `D.valor_venda` | `valuation.valor_venda` |
| `D.valor_op` | `valuation.valor_operacao` |
| `D.fator` | `valuation.fator_final` |
| `D.mul_base` | `valuation.multiplo_base` |
| `D.mul_mod` | `valuation.multiplo_setor.valor` |
| `D.mul_ise` | `valuation.fator_ise.valor` |
| `D.mul_ise_nome` | `valuation.fator_ise.classe` |
| `D.mul_range` | derivar (não há campo equivalente direto) |

**ISE:**
| Path antigo (v1) | Path novo (v2) |
|------------------|----------------|
| `D.ise_total` | `ise.ise_total` |
| `D.ise_class` | `ise.classe` |
| `D.ise_com` | `ise.pilares[id=p3_comercial].score_0_10` |
| `D.ise_fin` | `ise.pilares[id=p1_financeiro].score_0_10` |
| `D.ise_ges` | `ise.pilares[id=p4_gestao].score_0_10` |
| `D.ise_dep` | `ise.pilares[id=p5_socio_dependencia].score_0_10` |
| `D.ise_bal` | `ise.pilares[id=p7_balanco].score_0_10` |
| `D.ise_mar` | `ise.pilares[id=p8_marca].score_0_10` |
| `D.ise_ris` | `ise.pilares[id=p6_risco_legal].score_0_10` |
| `D.ise_conc` | (decisão produto: 8 pilares — não renderizar) |
| `D.ise_div` | (decisão produto: 8 pilares — não renderizar) |
| `D.ise_esc` | (decisão produto: sem Escalabilidade — não renderizar) |
| (novo) `p2_resultado` | `ise.pilares[id=p2_resultado].score_0_10` (renderizar) |

**Atratividade:**
| Path antigo (v1) | Path novo (v2) |
|------------------|----------------|
| `D.atr_score` | `atratividade.total` |
| `D.atr_lbl` | `atratividade.label` |
| `D.atr_sol` | `atratividade.componentes[id=ise].score_0_10` |
| `D.atr_set` | `atratividade.componentes[id=setor].score_0_10` |
| `D.atr_cre` | `atratividade.componentes[id=crescimento].score_0_10` |
| `D.atr_rec`, `D.atr_ind`, `D.atr_ges`, `D.atr_mar` | (decisão produto: 3 pilares — não renderizar) |

**Indicadores vs Benchmark:**
| Path antigo (v1) | Path novo (v2) |
|------------------|----------------|
| margem op (`ro/fat × 100` calc) | `indicadores_vs_benchmark.margem_operacional.{valor,status,benchmark,delta_pp}` |
| `D.recorrencia` | `indicadores_vs_benchmark.recorrencia.valor` |
| `D.concentracao` | `indicadores_vs_benchmark.concentracao.valor` |
| `D.ticket` | `indicadores_vs_benchmark.ticket_medio.valor` |
| `D.clientes` | `indicadores_vs_benchmark.num_clientes.valor` |
| `D.bench_ind.*` | cada indicador já traz `benchmark` embutido |
| (status `green/amber/red`) | mapear `no_alvo→green`, `atencao→amber`, `abaixo→red` |
| Endividamento total (calc inline em v1: `D.emprest / D.ro_anual`) | `indicadores_vs_benchmark.endividamento_vs_ro` (AMB.3 — calculado por S2.4) |
| Resultado por colaborador | `indicadores_vs_benchmark.ro_por_funcionario_mensal.valor` |
| CMV % | `indicadores_vs_benchmark.cmv_pct.valor` |

**ICD:**
| Path antigo (v1) | Path novo (v2) |
|------------------|----------------|
| `D.icd_pct` | `icd.pct` |
| `D.icd_respondidos[]` (strings) | `icd.respondidos[].label` |
| `D.icd_nao_respondidos[]` (strings) | `icd.nao_respondidos[].label` |

**Análise tributária:**
| Path antigo (v1) | Path novo (v2) |
|------------------|----------------|
| `D.analise_regimes.regime_atual` | `analise_tributaria.regime_declarado` |
| `D.analise_regimes.regime_otimo` | `analise_tributaria.regime_otimo_calculado` |
| `D.analise_regimes.imposto_atual_mensal` | `analise_tributaria.comparativo_regimes[regime=declarado].imposto_anual / 12` |
| `D.analise_regimes.imposto_atual_pct` | `analise_tributaria.comparativo_regimes[regime=declarado].aliquota_efetiva_pct` |
| `D.analise_regimes.regimes[]` | `analise_tributaria.comparativo_regimes[]` |
| `D.analise_regimes.regimes[].regime` | `comparativo_regimes[].regime` (slug) — mapear pra label legível |
| `D.analise_regimes.regimes[].imposto_mensal` | `comparativo_regimes[].imposto_anual / 12` |
| `D.analise_regimes.regimes[].pct` | `comparativo_regimes[].aliquota_efetiva_pct` |
| `D.analise_regimes.regimes[].elegivel` | `comparativo_regimes[].elegivel` |
| `D.analise_regimes.regimes[].motivo` | `comparativo_regimes[].motivo_inelegibilidade` |
| `D.analise_regimes.economia_mensal` | `analise_tributaria.economia_potencial.economia_anual / 12` |
| `D.analise_regimes.economia_anual` | `analise_tributaria.economia_potencial.economia_anual` |
| `D.analise_regimes.tem_oportunidade` | `analise_tributaria.gera_upside_obrigatorio` (ou derivar de `economia_anual > 0`) |

**Potencial 1Sócio:**
| Path antigo (v1) | Path novo (v2) |
|------------------|----------------|
| `valorPot` (calc inline) | `potencial_12m.potencial_final.valor_projetado_brl` |
| `ganhoAnual` (calc inline) | `potencial_12m.potencial_final.brl` |
| `ganhoMens` (calc inline) | `potencial_12m.potencial_final.brl / 12` |
| `valoriz` % (calc inline) | `potencial_12m.potencial_final.pct × 100` |
| `D.ops[]` | `potencial_12m.upsides_ativos[]` |
| `D.ops[i].titulo` | `potencial_12m.upsides_ativos[i].label` |
| `D.ops[i].descricao` | `potencial_12m.upsides_ativos[i].descricao` (S2.1) |
| `D.ops[i].ganho` | `potencial_12m.upsides_ativos[i].contribuicao_brl` |
| `D.ops[i].ganho_label` | derivar (`+R$ X/mês`) |
| `D.ops[i].tipo` | `potencial_12m.upsides_ativos[i].categoria` (valores diferentes — mapear se precisar) |
| `D.total_ops` | `potencial_12m.potencial_final.brl` |

**Operacional:**
| Path antigo (v1) | Path novo (v2) |
|------------------|----------------|
| `D.num_funcs` | `operacional.num_funcionarios` |
| `D.clientes` (em hero-desc) | `operacional.num_clientes` |

**Prioridade:** P0.

---

### L.3 — Renderizar 8 pilares ISE (não 10)

Loop atual (linhas 1159-1171 do laudo) itera sobre 10 pilares (`com`, `fin`, `ges`, `dep`, `conc`, `esc`, `bal`, `mar`, `div`, `ris`).

Depois: iterar sobre `ise.pilares[]` (array de 8). Cada pilar v2 já tem `id`, `label`, `score_0_10`, `peso_pct`. Manter cor verde/amber/red conforme score.

**Prioridade:** P0.

---

### L.4 — Renderizar 3 pilares Atratividade (não 6)

Loop atual (linhas 1035-1050 do laudo) itera sobre 6 pilares (`atr_sol`, `atr_set`, `atr_rec`, `atr_ind`, `atr_cre`, `atr_mar`).

Depois: iterar sobre `atratividade.componentes[]` (array de 3). Pilares hoje: `ise`, `setor`, `crescimento`.

Pesos vêm de `componentes[i].peso_pct` (não mais hardcoded "17%/15%").

**Prioridade:** P0.

---

### L.5 — Não calcular nada inline

Remover qualquer cálculo no front. Em particular, eliminar:

- Bloco `descTexto` (linhas 875-892) — substituir por `textos_ia.texto_contexto_negocio.conteudo`
- Cálculo de `valorPot` (linha 868) — usar `potencial_12m.potencial_final.valor_projetado_brl`
- Cálculo de `ganhoMens`/`ganhoAnual` (linhas 866-867) — usar `potencial_12m.potencial_final.brl`
- Heurísticas de upsides fallback (linhas 1286-1300) — usar `potencial_12m.upsides_ativos`
- Mapa de classes ISE inline (linhas 1146-1152) — mover pra parametros ou tirar
- Lista hardcoded de 21 checks ICD (linhas 916-938) — usar `icd.respondidos`/`nao_respondidos`

Se um valor exibido não está em calc_json v2, NÃO calcular — voltar pro plano e adicionar à skill v2.

**Prioridade:** P0 (princípio mestre).

---

### L.6 — Tratar itens "FORA do calc_json"

Itens que continuam vindo de outro lugar:

- **`negocios.nome`** — não usar mais. `identificacao.nome` está no calc_json v2.
- **`negocios.setor`** — idem, usar `identificacao.setor`.
- **`negocios.cidade`/`estado`** — idem, usar `identificacao.localizacao`.
- **Stats da plataforma** — hardcode segue (P.1).
- **Preços/comissões** — hardcode segue (P.2).
- **URLs Stripe / WhatsApp / modelo** — hardcode segue (configuração).

Resultado: o laudo deixa de fazer 2 fetches em `negocios` (resolver código → uuid) e passa a buscar tudo num único fetch em `laudos_v2`.

**Prioridade:** P0.

---

### L.7 — Mover provisões trabalhistas do DRE pro BP
**AMB.2 resolvido. Decisão Thiago: provisões só no BP.**

No DRE atual do laudo v1 (linha 1105): existe a linha "Provisões CLT — Férias e 13º" na seção mensal. **REMOVER essa linha do DRE renderizado.**

No BP: garantir que renderiza `balanco.passivos.provisao_clt_calculada.valor` com label "Provisões trabalhistas".

**Justificativa semântica:** v2 trata provisão CLT como passivo total acumulado (férias + 13º a pagar — fórmula `clt_folha × 0.13 × 6 × fator_encargo`), não como despesa mensal corrente. Conceitualmente pertence ao Balanço, não ao DRE.

**Prioridade:** P0.

---

## TRABALHO EM PARÂMETROS / OUTRAS TABELAS

### P.1 — Stats da plataforma
**Decisão pendente** (Thiago: deixar como está por enquanto).

Hardcode atual: "2.847 negócios", "R$ 1.2B", "1.423 compradores".

Decisão futura: tabela própria `stats_plataforma` ou query ao vivo ou `parametros_versoes`.

**Prioridade:** P2 (não-bloqueante).

---

### P.2 — Preços e comissões hardcoded

14 ocorrências espalhadas:
- R$ 99 (laudo PDF) × 5
- R$ 588 (plano guiado) × 3
- 10% comissão grátis × 3
- 5% comissão guiado × 3
- "1% da receita" / "20% ganho mensal" / "R$ 1.621/mês" (1Sócio)

Decisão futura: mover pra `parametros_versoes` ou tabela própria.

**Prioridade:** P2 (não-bloqueante).

---

## ITENS AMBÍGUOS — RESOLVIDOS EM 29/04/2026

### AMB.1 — CMV mensal ✅ RESOLVIDO
Path correto: `dre.cmv` (sem `_mensal` no nome). É mensal por convenção da v2 (confirmado contra Stuido Fit: `rec_liquida_mensal - cmv = lucro_bruto_mensal`).
Aplicado em L.2.

### AMB.2 — Provisões trabalhistas ✅ RESOLVIDO
Decisão Thiago: provisões só no BP, label "Provisões trabalhistas". V2 ganha — provisão é passivo acumulado (não despesa mensal), conceito v2 fica.
Aplicado em L.2 e L.7.

### AMB.3 — Endividamento ✅ RESOLVIDO
Decisão Thiago: skill v2 calcula `endividamento_pct = saldo_devedor / ro_anual` e expõe em `indicadores_vs_benchmark.endividamento_vs_ro`.
Aplicado como S2.4 (skill v2) e L.2 (novo path).

---

## ORDEM DE EXECUÇÃO SUGERIDA

1. **Investigar 3 ambíguos** (rápido, dá clareza)
2. **Trabalho na skill v2** (S2.1, S2.2, S2.3) — adiciona campos faltantes
3. **Validar calc_json v2 completo** com novo Stuido Fit gerado
4. **Adaptar laudo-completo.html** (L.1 a L.6) — em uma só passada
5. **Testar fim-a-fim** — cadastrar negócio, abrir laudo, comparar valores

---

## PRINCÍPIOS NÃO-NEGOCIÁVEIS (não esquecer durante execução)

- ZERO cálculo na hora no laudo. Se faltar, volta pro plano e adiciona à skill v2.
- v1 INTOCADA. `laudo-completo.html` será adaptada, não substituída.
- Teste com Stuido Fit (id `1a553b5c-e5f8-4fc3-90ca-e6d2be4ed928`) como caso de referência.
- Sem branch. Tudo na main.
- Briefings curtos pro Claude Code, uma demanda por vez.

---

## RESUMO QUANTITATIVO

| Categoria | Itens |
|-----------|-------|
| Trabalho na skill v2 (S2.x) | 4 |
| Trabalho no calc_json v2 (CJ.x) | 1 |
| Trabalho no laudo-completo.html (L.x) | 7 |
| Trabalho em parâmetros (P.x) | 2 |
| Ambíguos resolvidos (AMB.x) | 3 (histórico) |
| **Total ativo (sem AMB)** | **14** |
| **Total registrado** | **17** |

**Itens P0 (12):** S2.1, S2.2, S2.3, S2.4, CJ.1, L.1, L.2, L.3, L.4, L.5, L.6, L.7
**Itens P2 (2):** P.1, P.2

---

*Plano gerado em 29/04/2026 ao final de sessão. Pronto pra próxima sessão executar.*
