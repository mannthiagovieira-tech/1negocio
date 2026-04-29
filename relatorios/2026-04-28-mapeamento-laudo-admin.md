# Mapeamento — laudo-admin.html × schema novo do calc_json

Data: 2026-04-28 · Branch: `backend-v2` · Arquivo analisado: `laudo-admin.html` (1912 linhas)
Schema de referência: `calc_json` produzido pela skill em `validacao/skill-fixtures/forste-completo.js` (snapshot v2026.07)

> **Etapa 1 — somente leitura.** Nenhum código alterado. Documento serve de input
> pra decisão visual e priorização da Etapa 2 (implementação).

---

## 1.1 — Inventário do que o laudo lê hoje (por seção)

| # | seção visual | função | caminhos de `calcJson` consumidos | presente no schema novo? |
|---|---|---|---|---|
| 01 | METADATA | `renderMetadata` (linha ~995) | `_versao_calc_json`, `_versao_parametros`, `_modo`, `_data_avaliacao`, `_skill_versao`, `_laudo_v2_id`, `_versao_laudo` | **NÃO** — meta fields `_versao_*`, `_modo` não existem no calc_json atual da skill (presumido vir do persister no banco) |
| 02 | IDENTIFICAÇÃO | `renderIdentificacao` (1009) | `identificacao.{nome, codigo_diagnostico, slug, tipo_negocio_breve, setor.{label,code}, modelo_atuacao.{selecionados[], principal}, regime_tributario_declarado.{label,code,anexo_simples,fator_r_calculado,observacao_fator_r}, localizacao.{cidade,estado}, tempo_operacao_anos, expectativa_valor_dono, pct_produto}` | **NÃO** — `identificacao` não existe no calc_json da skill atual (top-level keys: ise, atratividade, valuation, potencial_12m, recomendacoes_pre_venda, upsides, analise_tributaria) |
| 03 | INPUTS — ORIGEM | `renderInputsOrigem` (1056) | `inputs_origem` (mapa), `icd.{total, pct, respondidos[], nao_respondidos[].{critico,label}, benchmarks[]}` | **NÃO** — não existem no calc_json novo |
| 04 | DRE — 5 BLOCOS | `renderDREv2` (1109) | `dre.{fat_mensal, fat_anual, ro_mensal, ro_anual, margem_operacional_pct, deducoes_receita.{...}, rec_liquida_mensal, cmv, lucro_bruto_mensal, pessoal.{...}, ocupacao.{...}, operacional_outros.{...}}`, `indicadores_vs_benchmark.{deducoes_pct, cmv_pct, folha_pct, aluguel_pct, mkt_pct, margem_operacional}` | **NÃO** — `dre` e `indicadores_vs_benchmark` ausentes no calc_json novo |
| 05 | BALANÇO | `renderBalanco` (1234) | `balanco.{ativos.{caixa,...,total,imobilizado_total}, passivos.{...,provisao_clt_calculada.{valor,formula,fator_encargo_aplicado,regime_referencia},total}, patrimonio_liquido, ncg.{valor,calculo}, ciclo_financeiro.{pmr_dias,pmp_dias,ciclo_dias}}` | **NÃO** — `balanco` ausente |
| 06 | ISE — 8 PILARES | `renderISEAdmin` (1349) | `inputs_origem`, `ise.{ise_total, classe, fator_classe, pilares[].{score_0_10,contribuicao_no_total,peso_pct,label,id,sub_metricas[].{score_0_10,peso_decimal,label,id}}}` | **PARCIAL** — `ise.*` existe e é compatível. Sub-métricas mudaram: P2 reduzida (3→2), P8 reativada `presenca_digital`. Loop `forEach` é data-driven, adapta sozinho. Mas `inputs_origem` (consumido por `SUBMET_ORIGEM_MAP` linhas 1297-1333) **não existe no calc_json novo** |
| 07 | VALUATION | `renderValuationAdmin` (1392) | `valuation.{ro_negativo, ro_negativo_msg, alerta_pl_negativo.mensagem, valor_venda, valor_operacao, fator_final, multiplo_setor.{codigo,valor}, ajuste_forma_atuacao.{total_ajuste,principal.{codigo,valor},outras[].{codigo,contribuicao_no_total}}, multiplo_base, fator_ise.{classe,valor}, ro_anual, patrimonio_liquido}` | **SIM (todos)** — schema 1:1. Apenas verificar se label `multiplo_setor.label` segue válido (hoje vem como `'servicos_empresas'` cru — pode estar errado, mas é dado da skill) |
| 08 | ATRATIVIDADE | `renderAtratividadeAdmin` (1450) | `atratividade.{total, label, componentes[].{score_0_10,contribuicao_no_total,label,id,peso_pct,fonte,fonte_crescimento,crescimento_pct_aplicado,penalidade_aplicada}}` | **PARCIAL** — schema 1:1 do alto; mas valores de `fonte_crescimento` mudaram (era `'projecao_vendedor'`/`'sem_dados'`; agora `'historico_real'`/`'sem_resposta'`). Linha 1477 tem condicional checando os valores antigos |
| 09 | ANÁLISE TRIBUTÁRIA | `renderTributariaAdmin` (1495) | `analise_tributaria.{alerta_inelegibilidade.{regime,motivo}, regime_declarado, regime_otimo_calculado, regime_otimo_anexo, anexo_simples, fator_r_calculado, economia_potencial.{economia_anual,economia_pct_do_ro,observacao}, gera_upside_obrigatorio, regra_obrigatorio, fator_r_observacao, comparativo_regimes[].{regime,anexo,elegivel,total_anual,imposto_anual,encargo_folha_anual,aliquota_efetiva_pct,motivo_inelegibilidade,viabilidade,observacao}}` | **SIM (todos)** — schema 1:1 |
| 10 | UPSIDES | `renderUpsidesAdmin` (1580) | `upsides[]` (assume **array**), cada item: `{categoria,acesso,impacto_no_valuation.{label,valor_min_estimado,valor_max_estimado},ordem_no_laudo,titulo,id,subtitulo,descricao_curta,descricao_polida_ia,complexidade,tempo_estimado,exige_apoio,exige_apoio_tipo,cta_consultoria,fonte_regra,tipo,label_visivel}`. Categorias esperadas: `'obrigatorio'`, `'ganho_rapido'`, `'estrategico'`, `'transformacional'`, `'bloqueado'` | **NÃO — schema mudou completamente** — agora `upsides` é objeto `{ativos[], paywalls[]}`. Cada item: `{id,categoria:'ro'\|'passivo'\|'multiplo'\|'qualitativo'\|'paywall',label,descricao,gate.{expressao,...},formula_calculo.{tipo,parametros},fonte_de_calculo}`. Categorias antigas (obrigatorio, ganho_rapido, etc.) **não existem mais** |
| (NOVO) | POTENCIAL 12M | — | (não existe seção atual) | **NOVO bloco** — `potencial_12m.{upsides_ativos[].{id,categoria,label,contribuicao_bruta_pct,contribuicao_pos_cap_categoria_pct,contribuicao_brl}, agregacao.{tributario.{brl,pct,sem_cap,fonte}, por_categoria.{ro,passivo,multiplo}.{bruto_pct,cap_aplicado,capped_pct}, potencial_alavancas_pre_ise_pct, cap_ise.{ise_score,ise_score_arredondado,faixa,cap_aplicavel,cap_aplicado,potencial_pos_ise_pct}, cap_absoluto.{threshold,aplicado,potencial_pos_absoluto_pct}, tributario_dominante}, potencial_final.{pct,brl,valor_projetado_brl}, ordenacao_exibicao[]}` |
| (NOVO) | RECOMENDAÇÕES PRÉ-VENDA | — | (não existe seção atual) | **NOVO bloco** — `recomendacoes_pre_venda[].{id,label,mensagem}` (4 itens no Forste: rec_separar_pf_pj, rec_documentar_processos, rec_registrar_marca, rec_aumentar_presenca_digital) |
| 11 | OPERACIONAL | `renderOperacional` (1670) | `operacional.{_placeholder, num_funcionarios, num_clientes, tempo_operacao_anos, fat_mensal, fat_anual, num_socios, prolabore_mensal_total, concentracao_status}` | **NÃO** — `operacional` ausente no calc_json novo |
| 12 | INDICADORES VS BENCHMARK | `renderIndicadores` (1704) | `indicadores_vs_benchmark` (mapa): `{[id]:{valor,benchmark,delta_pp,status,sentido,label,unidade,observacao}}`. `status ∈ {'no_alvo','atencao','abaixo','neutro',null}`, `sentido ∈ {'maior_melhor','menor_melhor','neutro'}` | **NÃO** — ausente no calc_json novo |
| 13 | TEXTOS GERADOS POR IA | `renderTextosIA` (1801) | `textos_ia.{status,_gerados_em,_modelos_usados, texto_resumo_executivo_completo,texto_contexto_negocio,texto_parecer_tecnico,texto_riscos_atencao,texto_diferenciais,texto_publico_alvo_comprador, descricoes_polidas_upsides[].{upside_id,conteudo}}`, `textos_anuncio.{_status, texto_resumo_executivo_anonimo,sugestoes_titulo_anuncio,texto_consideracoes_valor}` | **NÃO** — ausentes |
| 14 | JSON BRUTO COMPLETO | renderização inline (~1907) | `JSON.stringify(calcJson, null, 2)` | **SIM** — agnóstico do schema, sempre funciona |

> **Achado crítico:** `calc_json` da skill atual contém apenas **7 top-level keys**: `ise`, `atratividade`, `valuation`, `potencial_12m`, `recomendacoes_pre_venda`, `upsides`, `analise_tributaria`. As seções 01-05, 11-13 do laudo-admin leem campos (`identificacao`, `inputs_origem`, `icd`, `dre`, `balanco`, `operacional`, `indicadores_vs_benchmark`, `textos_ia`, `textos_anuncio`) **que não estão no objeto produzido pela skill**. Esses campos provavelmente são montados em outra camada (persister, página, ou ETL) — **fora do escopo do mapeamento atual** e **fora do escopo do refactor da skill**.

---

## 1.2 — Schema novo do calc_json (resumo executivo)

Top-level keys (7), com dump completo gerado a partir de `forste-completo.js`:

```
ise: { ise_total, classe, fator_classe, pilares[8] }
  └ pilares[i]: { id, label, peso_pct, score_0_10, contribuicao_no_total, sub_metricas[] }
      └ sub_metricas[j]: { id, label, score_0_10, peso_decimal, valor, benchmark }

atratividade: { total, label, componentes[3] }
  └ componentes[i]: { id, label, peso_pct, score_0_10, contribuicao_no_total,
                      fonte | fonte_crescimento, crescimento_pct_aplicado,
                      penalidade_aplicada, metadata }

valuation: { multiplo_setor.{codigo,label,valor},
             ajuste_forma_atuacao.{principal.{codigo,valor},outras[],total_ajuste},
             multiplo_base, fator_ise.{classe,valor,faixa}, fator_final,
             ro_anual, valor_operacao, patrimonio_liquido, valor_venda,
             ro_negativo, ro_negativo_msg, cta_especialista, alerta_pl_negativo }

potencial_12m: { _versao,
                 upsides_ativos[] (filtrado: ativos com contribuição monetária),
                 agregacao.{tributario, por_categoria.{ro,passivo,multiplo},
                            potencial_alavancas_pre_ise_pct, cap_ise, cap_absoluto,
                            tributario_dominante},
                 potencial_final.{pct,brl,valor_projetado_brl},
                 ordenacao_exibicao[] }

recomendacoes_pre_venda: [{ id, label, mensagem }]

upsides: { ativos[6], paywalls[3] }
  └ cada item: { id, categoria:'ro'|'passivo'|'multiplo'|'qualitativo'|'paywall',
                 label, descricao, gate.{expressao,...},
                 formula_calculo.{tipo,parametros}, fonte_de_calculo }

analise_tributaria: { regime_declarado, anexo_simples, fator_r_calculado,
                      fator_r_observacao, regime_otimo_calculado, regime_otimo_anexo,
                      comparativo_regimes[4],
                      economia_potencial.{comparado_a,regime_recomendado,
                                          economia_anual,economia_pct_do_ro,observacao},
                      gera_upside_obrigatorio, alerta_inelegibilidade,
                      regra_obrigatorio }
```

Tree completa em `/tmp/calc-json-schema-tree.txt` (155 linhas, máx profundidade 4).

---

## 1.3 — Mapa de mudanças (priorizado)

Categorias: **ADAPT** (campo renomeado/estrutura mudou — só leitura), **NEW** (seção nova), **REMOVE** (seção referencia campo inexistente — sumir ou indicar lacuna), **REVAMP** (rework completo).
Esforço: **P** (pequeno, <30min), **M** (médio, 30-90min), **G** (grande, >90min).

### Seções com mudança técnica direta

| seção | mudança | esforço | detalhe |
|---|---|---|---|
| **10 UPSIDES** | **REVAMP** | **G** | Schema mudou de array → objeto `{ativos,paywalls}`; categorias mudaram de 5 produto-style (`obrigatorio`/`ganho_rapido`/etc.) pra 5 técnicas (`ro`/`passivo`/`multiplo`/`qualitativo`/`paywall`). Re-fazer o sumário, a card, a pill de categoria, o agrupamento. Itens não têm mais `titulo`/`subtitulo`/`descricao_polida_ia`/`impacto_no_valuation.label`/`complexidade`/`tempo_estimado` — agora têm `label`/`descricao`/`gate.expressao`/`formula_calculo.tipo`/`fonte_de_calculo`. Renderer admin precisa mostrar TUDO (decisão 27): ativos + paywalls + recomendações qualitativas separados. |
| **NOVO POTENCIAL 12M** | **NEW** | **G** | Nova seção dedicada. Mostra: tributário (brl + flag dominante), tabela 3 linhas RO/Passivo/Múltiplo (bruto_pct, cap_aplicado, capped_pct), cap_ise (ise_score, faixa, cap_aplicavel, cap_aplicado), cap_absoluto (threshold, aplicado), potencial_final (pct/brl/valor_projetado_brl), `upsides_ativos[]` ordenados por contribuição. Decisão 27 (admin soberano): mostrar TUDO, incluindo zerados. |
| **NOVO RECOMENDAÇÕES PRÉ-VENDA** | **NEW** | **P** | Nova seção curta. Lista os 4 itens `{id,label,mensagem}`. Pode ficar dentro da seção UPSIDES (sub-bloco "qualitativos") ou seção dedicada. **Decisão de produto pendente** (item 1.4). |
| **08 ATRATIVIDADE** | **ADAPT** | **P** | Linha 1477 condicional checa `'projecao_vendedor'` e `'sem_dados'` — strings antigas. Nova skill emite `'historico_real'` e `'sem_resposta'`. Atualizar mapa de strings + cores. Adicionar handle pra `metadata.{componente,motivo,score}` (linha 1475+ não lê). |
| **06 ISE** | **ADAPT** | **P** | Estrutura compatível. **Mas:** `SUBMET_ORIGEM_MAP` (linhas 1297-1333) referencia `inputs_origem` que não vem no calc_json da skill. Solução: ou esconder o "indicador de origem" das sub-métricas, ou passar a fazer best-effort com fallback "sem origem". Schema das sub-métricas mudou (P2: 3→2, P8: presenca_digital reativada) mas como o render é data-driven `forEach`, **isso adapta sozinho** — só validar visualmente. |
| **07 VALUATION** | **ADAPT** | **P** | Schema 1:1. Apenas validar que `multiplo_setor.label` (hoje vem cru `'servicos_empresas'`) renderiza ok. Verificar `valuation.fator_ise.faixa` que agora vem com formato `"Consolidado (ISE: 84.1)"`. |
| **09 ANÁLISE TRIBUTÁRIA** | **ADAPT** | **P** | Schema 1:1. **Possível ADAPT-zero**. Validar visualmente apenas. |

### Seções fora do escopo da skill

Os campos que **não vêm no calc_json da skill** (`identificacao`, `inputs_origem`, `icd`, `dre`, `balanco`, `operacional`, `indicadores_vs_benchmark`, `textos_ia`, `textos_anuncio`) provavelmente são compostos por outra camada (página, persister, ETL). **3 caminhos possíveis** pro laudo-admin:

| seção | opção A (recomendado) | opção B | opção C |
|---|---|---|---|
| 01 METADATA, 02 IDENTIFICAÇÃO, 03 INPUTS-ORIGEM, 04 DRE, 05 BALANÇO, 11 OPERACIONAL, 12 INDICADORES, 13 TEXTOS IA | Manter rendering, deixar "ausente" se faltar (fallback `'—'`) — **laudo-admin é soberano (D27), mostra tudo o que vier**, lacunas viram diagnóstico visual | Remover seções (laudo-admin foca só no que a skill produz) — **muda escopo do laudo-admin** | Documentar que essas seções dependem de outra camada e adicionar pill "fonte: extra-skill" no header |

**Recomendação:** opção A — laudo-admin já tem fallback `|| {}` e renderização defensiva. Não quebra se campo ausente; apenas mostra "—". Mantém SOBERANO conforme D27.

### Quadro consolidado por esforço

| esforço | quantos | seções |
|---|---|---|
| G (>90min) | 2 | 10 UPSIDES (REVAMP), NOVO POTENCIAL 12M (NEW) |
| M (30-90min) | 0 | — |
| P (<30min) | 5 | NOVO RECOMENDAÇÕES (NEW), 08 ATRATIVIDADE (ADAPT), 06 ISE (ADAPT — só esconder origem indicator), 07 VALUATION (ADAPT-validate), 09 TRIBUTÁRIA (ADAPT-validate) |

Esforço total estimado da Etapa 2: **4-6 horas** (incluindo testes visuais).

---

## 1.4 — Decisões pendentes (produto/visual)

### D-A: Como exibir flag `tributario_dominante`?

A flag fica em `potencial_12m.agregacao.tributario_dominante` (boolean). Indica se o tributário sozinho responde por >50% do potencial total — caso em que sobressai dos upsides operacionais.

**Opções:**
- (a) **Pill no topo da seção POTENCIAL 12M**: `Tributário dominante` (cor amarela) ou `Tributário acessório` (cor cinza). Pequena. Sempre visível.
- (b) **Badge na linha do tributário** dentro da tabela de agregação. Mais sutil. Só destaca quando `true`.
- (c) **Card kpi separado** ao lado de "Total tributário" mostrando "% do potencial total".

**Recomendação:** (a) + (b) combinados. Pill no header pra leitura rápida; badge na linha pra rastreabilidade.

### D-B: Como diferenciar visualmente upsides ativos vs paywalls?

Hoje (laudo-admin antigo) usa `cat-bloqueado` muted + pill "Visível só em laudo-pago R$99". Schema novo: `upsides.ativos` vs `upsides.paywalls` são listas separadas. Categoria `paywall` é técnica.

**Opções:**
- (a) **Duas listas separadas** (sub-headings "Ativos (n)" / "Paywalls (n)"). Mantém soberania D27, paywalls visíveis sem blur.
- (b) **Lista unificada** ordenada por categoria, paywalls com pill amber/muted.
- (c) **Tabs ou toggle** ativos/paywalls/qualitativos.

**Recomendação:** (a) — coerente com a separação do schema (`ativos` e `paywalls` já são arrays distintos). Sem reordenar dados.

### D-C: Recomendações pré-venda — seção própria ou sub-bloco de UPSIDES?

`recomendacoes_pre_venda[]` (4 itens) são qualitativos sem contribuição monetária. No schema antigo, isso ia como categoria `'estrategico'`/`'transformacional'`. Na skill nova, vem em array dedicado.

**Opções:**
- (a) **Sub-bloco dentro da seção UPSIDES** ("Qualitativos / pré-venda — n itens"). Coloca tudo de upsides em um lugar.
- (b) **Seção própria** numerada (entre UPSIDES e POTENCIAL 12M).

**Recomendação:** (a). Visualmente mais coeso. Em laudo-pago/gratuito provavelmente vai junto também.

### D-D: Status badges Bom/Atenção/Crítico/N/A — D29 já está implementada?

**Já implementada** em `renderIndicadores` (linhas 1738-1742). Cards: "Bom" (no_alvo) / "Atenção" (atencao) / "Crítico" (abaixo) / "N/A" (neutro). Inline status via `statusToInline()`. **Apenas validar no laudo-admin novo se nada quebrou e se o `statusToInline` segue retornando o label novo.**

### D-E: Box "Onde aparece" — D28 já está implementada?

**Já implementada** em `renderOndeAparece` (linhas 941-971), CSS em 320-336. Mapa hardcoded por `secId` → string descritiva de destinos (laudo-fonte, laudo-gratuito, laudo-pago, negocio.html).

**Pendente:** atualizar texto do mapa pra novas seções (POTENCIAL 12M, RECOMENDAÇÕES). Verificar se descrições ainda batem com produto atual ("laudo-gratuito (4 free) · laudo-pago (10)" — 4 e 10 ainda valem?).

### D-F: Seções "fora do escopo da skill" (DRE, balanço, identificação, etc.) — manter ou remover?

Ver §1.3. **Recomendação:** opção A (manter, deixar ausentes vírem como "—"). Laudo-admin é soberano, mostra tudo o que aparecer.

### D-G: meta-fields `_versao_calc_json`/`_versao_parametros`/`_modo`/`_data_avaliacao` — cabe injetar na skill ou vêm do persister?

Ausentes no calc_json novo. Decisão arquitetural: skill injeta auto, ou persister composta após salvar.

**Recomendação:** persister injeta (skill é pura — saída determinística por input). Laudo-admin já tem fallback `|| '—'`. Sem mudança de código no laudo-admin.

### D-H: Tributário com `economia_anual = 0` — esconder ou mostrar com nota?

No Forste atual: já está no regime ótimo. Linha do tributário em POTENCIAL 12M fica com `brl=0`/`pct=0`. Mostrar zero ou suprimir?

**Decisão 27 (admin soberano):** mostrar zero, com observação `economia_potencial.observacao` ("Negócio já está no regime ótimo") destacada.

---

## 1.5 — Achados extras (do passe técnico)

### Acessos defensivos pré-existentes

- Quase todas as seções usam `|| {}` ou `|| []` no top: `inputs_origem || {}`, `dre || {}`, `balanco || {}`, `valuation || {}`, `analise_tributaria || {}`, `componentes || []`. **Resiliente a campos ausentes** — adapta-se naturalmente ao calc_json novo onde só 7 keys existem.
- `renderOperacional` e `renderIndicadores` têm checagem `_placeholder` pra versões antigas.
- JSON.stringify aparece em **13 lugares** do código (debug box por seção). Isso não quebra mesmo com schema diferente.

### Bug latente já presente (não introduzido pelo schema novo)

- Linha 1581: `const ups = calcJson.upsides || []` — se vier `{ativos,paywalls}`, `.length === 0` é undefined (objeto não tem `.length`), e `.forEach` quebra com TypeError. **Em produção com calc_json novo, esta seção está jogando erro silencioso (`forEach is not a function`)**. Coerente com a hipótese do briefing: "Está quebrado em produção".

### Funções utilitárias estáveis

`pill()`, `kvLine()`, `escapeHtml()`, `fc()` (formatação currency), `n()` (parse number), `linhaTbl6()`, `statusToInline()`, `catColor()` — todas estáveis e reaproveitáveis na nova versão. Não exigem mudança.

---

## 1.6 — Ordem sugerida pra Etapa 2

Baseado em risco × esforço × valor:

1. **(P, ADAPT)** Atualizar `renderAtratividadeAdmin` com novos valores de `fonte_crescimento`. Já testável com Forste do fixture.
2. **(P, ADAPT-validate)** Validar `renderValuationAdmin` e `renderTributariaAdmin` rodando contra calc_json novo — provável zero mudanças.
3. **(P, ADAPT)** Esconder ou suavizar `submet-origem` em `renderISEAdmin` quando `inputs_origem` não vier (preservar pillar render).
4. **(G, REVAMP)** Reescrever `renderUpsidesAdmin` pra schema novo `{ativos,paywalls}` + categorias técnicas. Decisão D-B aplicada.
5. **(G, NEW)** Criar `renderPotencial12m` (HTML novo da seção + mount no `<main>`). Decisões D-A, D-H aplicadas.
6. **(P, NEW)** Criar render de `recomendacoes_pre_venda` (sub-bloco da Upsides ou seção própria — D-C).
7. **(P, ADAPT)** Atualizar `renderOndeAparece` com seções novas.
8. **(validação)** Rodar `forste-completo.js`, copiar `calc_json` pra mock, abrir laudo-admin local, conferir cada seção visualmente.

---

## 1.7 — Próximo passo

**Aguardando análise do mapeamento e decisões D-A a D-H.** Não tocar em `laudo-admin.html` até alinhamento das decisões pendentes.

Sugestão: responder com as 8 decisões (mesmo que algumas sejam "aceito a recomendação"), aí parto pra Etapa 2 com plano de commits granulares.

---

# 2. CORREÇÃO MAJOR — investigação dos "7 campos faltantes"

> O usuário pediu pra investigar como esses 7 campos eram populados antes do refactor.
> A investigação **invalidou a premissa** do mapeamento original. **Os 7 campos NÃO
> estão faltando** — estavam sendo cherry-pickados pelo dump fixture.

## 2.1 — Reproduzindo a falha do mapeamento original

O dump usado em §1.1/§1.2 veio de um script auxiliar (`/tmp/forste-final-dump.js`) que **explicitamente cherry-pickou** 7 keys ao serializar:

```js
console.log(JSON.stringify({
  ise: calc.ise, atratividade: calc.atratividade, valuation: calc.valuation,
  potencial_12m: calc.potencial_12m, recomendacoes_pre_venda: calc.recomendacoes_pre_venda,
  upsides: calc.upsides, analise_tributaria: calc.analise_tributaria,
}, null, 2));
```

Aí concluí erradamente que **só essas 7 keys existem** no calc_json. Repeti o dump
sem cherry-pick (`Object.keys(calc)`):

```
TOP-LEVEL-KEYS: _versao_calc_json,_versao_parametros,_data_avaliacao,_skill_versao,
identificacao,inputs_origem,dre,balanco,ise,valuation,atratividade,operacional,
icd,indicadores_vs_benchmark,analise_tributaria,upsides,textos_ia,textos_anuncio,
potencial_12m,recomendacoes_pre_venda
```

**20 top-level keys**, não 7. Todos os campos que o laudo-admin lê **estão presentes**.

## 2.2 — Onde cada campo é populado (todos pela skill)

Ponto-pelo-ponto da pergunta do usuário:

### Pergunta 1 — Como esses campos eram populados antes do refactor?

**Eram populados pela própria skill, no commit `montarCalcJsonV2`** (linha 2638 de
`skill-avaliadora-v2.js`). Isso continua igual hoje. O refactor não alterou
`montarCalcJsonV2`. Refactor adicionou `potencial_12m` e `recomendacoes_pre_venda`
**sem remover nada**:

```js
const calcJson = montarCalcJsonV2(D, dre, balanco, ise, valuation, atratividade,
                                  operacional, icd, indicadores, analise_tributaria,
                                  upsidesObj, _parametrosVersaoId);
calcJson.potencial_12m = agregado.potencial_12m;
calcJson.recomendacoes_pre_venda = agregado.recomendacoes_pre_venda;
return calcJson;
```

(linhas 2832-2853)

### Pergunta 2 — Onde está a "outra camada"?

**Não existe.** A skill é a única camada. Não há ETL, persister composto, ou
montagem em laudo-admin.html. A função `salvarCalcJsonV2` (linhas 2721-2782)
apenas **persiste** o objeto produzido pela skill — ela não compõe nem
enriquece nada além de `_laudo_v2_id` e `_versao_laudo` (apenas em `modo: 'commit'`).

### Pergunta 3 — Quais campos são triviais de "adicionar" à skill?

**Nenhum precisa ser adicionado** — todos já estão. Verificação campo-por-campo:

| campo do laudo-admin | já existe? | populado por | observação |
|---|---|---|---|
| `_versao_calc_json` | ✓ | `montarCalcJsonV2` (`'2.0'`) | hardcoded |
| `_versao_parametros` | ✓ | `montarCalcJsonV2` (`P_versao_id`) | vem da migration ativa |
| `_data_avaliacao` | ✓ | `montarCalcJsonV2` (`hoje()`) | data de geração |
| `_skill_versao` | ✓ | `montarCalcJsonV2` (`'2.0.0-etapa2.9'`) | hardcoded |
| `_modo` | **✗** | — | laudo-admin lê mas skill não emite — **dead read** |
| `_laudo_v2_id` | ✓ | só `modo:'commit'` (linha 2845) | null em preview |
| `_versao_laudo` | ✓ | só `modo:'commit'` (linha 2846) | null em preview |
| `identificacao.{nome,setor,modelo_atuacao,regime_tributario_declarado,localizacao,tempo_operacao_anos,expectativa_valor_dono,pct_produto}` | ✓ | `montarCalcJsonV2` linhas 2645-2668 | schema 1:1 com o que laudo-admin espera |
| `inputs_origem` | ✓ | `D._origem_campos` (54 keys; valores: `'informado'`/`'informado_zero'`/`'fallback_zero'`/`'informado_pct'`) | linha 2670 |
| `icd` | ✓ | `calcICDv2` (linha 2184) → mapeado em montarCalcJsonV2 linha 2678 | tem `total`, `pct`, `respondidos[]`, `nao_respondidos[]`, `benchmarks[]` |
| `dre` (5 blocos) | ✓ | `calcDREv2` (linha 917) | bloco_1_receita..bloco_5_caixa + fat/cmv/lucros + deducoes/pessoal/ocupacao/operacional_outros |
| `balanco` | ✓ | `calcBalancoV2` (linha 1109) | `ativos`, `passivos`, `patrimonio_liquido`, `ncg`, `ciclo_financeiro` (1:1 com renderBalanco) |
| `operacional` | ✓ | computed inline em `avaliarV2` linhas 2811-2821 | `num_funcionarios`, `num_clientes`, `tempo_operacao_anos`, `fat_mensal`, `fat_anual`, `num_socios`, `prolabore_mensal_total`, `concentracao_status` (1:1) |
| `indicadores_vs_benchmark` (18 indicadores) | ✓ | `calcIndicadoresV2` (linha 2030) | cada item: `{id,label,valor,unidade,benchmark,delta_pp,status,sentido,regra_aplicada,observacao}`. **Schema 1:1** com o que `renderIndicadores` espera |
| `textos_ia` | ✓ (placeholder) | `montarCalcJsonV2` linhas 2683-2694 | `status: 'pendente_geracao'`, todos os textos com `conteudo: null` esperando Edge Function popular |
| `textos_anuncio` | ✓ (placeholder) | `montarCalcJsonV2` linhas 2696-2710 | `_status: 'nao_gerado'`, todos placeholders |

**Único campo de fato ausente:** `_modo`. Laudo-admin lê em `el('meta-modo').textContent = (calcJson._modo || '—').toUpperCase()` (linha 980). A skill não emite. Solução trivial: adicionar `_modo: modo` em `avaliarV2` antes de retornar (1 linha) — ou aceitar que vai sempre exibir `—` (como já está).

## 2.3 — Por que o laudo-admin "está quebrado em produção" então?

Removidas as falsas regressões, restam **três problemas reais**:

### Problema A — `upsides` é objeto, código espera array (linha 1581)

```js
const ups = calcJson.upsides || [];
ups.forEach(u => { ... });  // TypeError: ups.forEach is not a function
```

Schema novo: `upsides = { ativos: [...], paywalls: [...] }`. Código antigo trata
como array. **Esse é o erro fatal — derruba toda a seção UPSIDES.**

### Problema B — Categorias mudaram

Categorias antigas no laudo-admin: `obrigatorio`, `ganho_rapido`, `estrategico`,
`transformacional`, `bloqueado`. Categorias novas no calc_json: `ro`, `passivo`,
`multiplo`, `qualitativo`, `paywall`. Código antigo classifica errado mas não
quebra (categoria default `normal`). UX degradada, não crash.

### Problema C — Não tem rendering pra `potencial_12m` e `recomendacoes_pre_venda`

Campos novos. Não há função `renderPotencial12m` nem `renderRecomendacoesPreVenda`.
Os dados estão lá, só ninguém lê. Deve aparecer no JSON bruto da seção 14, mas
sem visualização dedicada.

### Problemas adicionais (UX, não crash)

- D — `renderAtratividadeAdmin` linha 1477 checa `'projecao_vendedor'`/`'sem_dados'`
  (strings antigas). Novas: `'historico_real'`/`'sem_resposta'`. Renderiza com
  cor errada, não quebra.
- E — `SUBMET_ORIGEM_MAP` (linhas 1297-1333) tem chaves stale: `margem_estavel`
  (sub-métrica removida na v2026.07), `sem_passivo_trabalhista`/`impostos_em_dia`
  (sub-métricas renomeadas pra `passivos_juridicos`/`impostos_atrasados_volume`).
  Mostra "..." (não respondido) onde deveria mostrar "✓".
- F — `valuation.fator_ise.faixa` agora vem como `"Consolidado (ISE: 84.1)"` (string
  composta). renderValuation lê `fator_ise.classe` e `fator_ise.valor` separadamente
  → não usa `.faixa` → não quebra.

## 2.4 — Mapa de mudanças CORRIGIDO

Versão revisada da tabela de §1.3 com a premissa correta:

| seção | mudança real | esforço corrigido |
|---|---|---|
| 01 METADATA | **ADAPT-zero** ou **+1 linha** (`_modo: modo`) | 1min |
| 02 IDENTIFICAÇÃO | **ADAPT-validate** (schema 1:1 — só conferir) | 5min |
| 03 INPUTS-ORIGEM | **ADAPT-validate** (origem codes `informado`/`fallback_zero` etc.) | 5min |
| 04 DRE | **ADAPT-validate** (schema 1:1) | 5min |
| 05 BALANÇO | **ADAPT-validate** (schema 1:1) | 5min |
| 06 ISE | **ADAPT-P** (atualizar `SUBMET_ORIGEM_MAP` removendo chaves stale) | 15min |
| 07 VALUATION | **ADAPT-validate** | 5min |
| 08 ATRATIVIDADE | **ADAPT-P** (strings de `fonte_crescimento`) | 10min |
| 09 ANÁLISE TRIBUTÁRIA | **ADAPT-validate** | 5min |
| 10 UPSIDES | **REVAMP-G** (array→objeto + categorias técnicas + paywalls separados) | 90min |
| (NOVO) POTENCIAL 12M | **NEW-G** (seção inteira) | 90min |
| (NOVO) RECOMENDAÇÕES PRÉ-VENDA | **NEW-P** (lista simples) | 20min |
| 11 OPERACIONAL | **ADAPT-validate** (schema 1:1) | 5min |
| 12 INDICADORES | **ADAPT-validate** (schema 1:1) | 5min |
| 13 TEXTOS IA | **ADAPT-validate** (placeholders ainda) | 5min |
| 14 JSON BRUTO | **sem mudança** | 0 |

**Esforço total revisado:** 4-4.5 horas (era 4-6h, agora menor porque
sumiram 7 "faltas inexistentes"). Concentração: **2x90min** em UPSIDES revamp e
POTENCIAL 12M new.

## 2.5 — Recomendações ajustadas (afetam algumas decisões pendentes)

### D-F **CORRIGIDA**: opção A (manter seções com fallback `—`) — invalidada

A premissa de D-F era: "as 7 seções leem campos que não existem". **Não é verdade.**
Os campos existem. **D-F deixa de ser uma decisão pendente** — laudo-admin já
funciona pra todas essas seções. Validar visualmente é só confirmação.

### D-G **CORRIGIDA**: meta-fields — também invalidada parcialmente

`_versao_calc_json`, `_versao_parametros`, `_data_avaliacao`, `_skill_versao`
**são emitidos pela skill** (em `montarCalcJsonV2`). Apenas `_modo` é o gap.
Decisão de produto: emitir ou não emitir `_modo` na skill? Adicionar é trivial
(`calcJson._modo = modo` linha ~2851). Recomendação: emitir (1 linha de diff).

### Outras decisões (D-A, D-B, D-C, D-D, D-E, D-H) seguem inalteradas

Decisões sobre apresentação visual de UPSIDES/POTENCIAL/RECOMENDAÇÕES e validação
de D28/D29/D27 não são afetadas pela correção.

## 2.6 — Verificação final em campo (banco real)

> "Hoje, no banco real (Forste 1N-RZHUYL), esses campos existem em calc_json?"

**Não consigo verificar diretamente** — precisaria query no Supabase. Mas a
análise do código garante: **se o registro foi salvo via skill v2 (`avaliarV2`
com `modo:'commit'`) ele tem todos os 20 keys.** Registros mais antigos podem ter
schema parcial (skill v1 ou commits anteriores), mas isso é evolução normal e
o laudo-admin já lida via fallback `|| {}` em cada seção.

Se quiser confirmar empiricamente: rodar uma query Supabase
`select calc_json from laudos_v2 where negocio_id = '<id-Forste>' and ativo
order by versao desc limit 1` e verificar `Object.keys(calc_json)`. Posso ajudar
a montar a query se for útil.

## 2.7 — Síntese da correção

| premissa antiga (§1.1-1.6) | premissa corrigida (§2) |
|---|---|
| 7 das 14 seções leem campos faltantes | **0 seções** leem campos faltantes (1 campo trivial: `_modo`) |
| Existe "outra camada" que monta calc_json | Não existe — skill é único produtor |
| Bug latente em UPSIDES | **Confirmado** (linha 1581, `forEach` em objeto) |
| Atratividade tem string check stale | **Confirmado** (linha 1477) |
| Falta seção POTENCIAL 12M | **Confirmado** |
| Falta seção RECOMENDAÇÕES PRÉ-VENDA | **Confirmado** |
| Esforço total 4-6h | Esforço total revisado **3.5-4.5h** |
| Decisão D-F (fora-do-escopo) | **Invalidada** — campos existem |
| Decisão D-G (meta-fields) | **Parcialmente invalidada** — só `_modo` é gap |

---

**Aguardando** análise das 8 decisões originais (D-A a D-H) considerando que
D-F é não-aplicável e D-G ficou simplificada.
