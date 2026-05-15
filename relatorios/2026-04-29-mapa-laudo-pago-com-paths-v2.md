# Mapa exaustivo — laudo-pago.html (atual) com paths v2 alvo

**Data:** 29/04/2026
**Origem:** investigação pré-adaptação do laudo-pago, com comparação à versão "ideal" da branch `backend-v2`.

---

## 🎯 ACHADO DECISIVO — VERSÃO IDEAL EXISTE NA BRANCH backend-v2

Branch local `backend-v2` contém uma **reescrita completa** do `laudo-pago.html` que Thiago fez antes da decisão arquitetural de paralelo na main. Essa versão JÁ está adaptada pra v2.

| Métrica | main atual | backend-v2 (ideal) |
|---------|------------|---------------------|
| Linhas | 1.161 | 2.838 (+144%) |
| Tamanho | 95 KB | 128 KB |
| Importa skill v1? | **Sim** (2× linhas 232+234) | **Não** |
| Importa Chart.js? | Não | **Sim** (linha 8) |
| Lê de | `laudos_completos.calc_json` | `laudos_v2.calc_json` (linha 1801) |
| Schema | calc_json v1 | calc_json v2 (`_versao: "2.0"`, `v2026.07`) |
| ISE | 10 pilares hardcoded | 8 pilares iterando `ise.pilares[]` |
| Atratividade | 6 pilares | 3 componentes |
| Textos IA | template inline gigante | 6× `renderTextoIA(chave)` integrado |
| Charts | nenhum | 3 charts (radar ISE, funil DRE, progressão) |

**A backend-v2 NÃO é commit órfão**: ela tem todo o trabalho que Thiago descreveu como "exatamente como eu queria".

### Estrutura da versão ideal (renderTudo, linha 1847)

```
renderCapa()                                              ← Capa
renderFolhaRosto()                                        ← Folha de rosto
renderIndice()                                            ← Índice
renderHeroResumo()                                        ← 1. Resumo executivo
renderTextoIA('2', ..., 'texto_contexto_negocio')         ← 2. Contexto IA
renderDRE()                                               ← 3. DRE
renderBalanco()                                           ← 4. Balanço
renderISE()                                               ← 5. ISE (radar Chart.js)
renderIndicadores()                                       ← 6. Indicadores
renderTributaria()                                        ← 7. Tributária
renderTextoIA('8', ..., 'texto_parecer_tecnico')          ← 8. Parecer IA
renderTextoIA('9', ..., 'texto_riscos_atencao')           ← 9. Riscos IA
renderTextoIA('10', ..., 'texto_diferenciais')            ← 10. Diferenciais IA
renderAtratividade()                                      ← 11. Atratividade
renderTextoIA('12', ..., 'texto_publico_alvo_comprador')  ← 12. Público IA
renderUpsides()                                           ← 13. Upsides
renderOperacional()                                       ← 14. Operacional
renderFechamento()                                        ← 15. Fechamento
```

**18 blocos**. Quase 4 desses (IAs) ESTÃO PRONTOS pra consumir os textos da Edge Function `gerar_textos_laudo` (Sub-passo 4.6).

### Decisões da versão ideal (commits visíveis no `git log backend-v2`)

- `f14293b` — deletar bloco redundante DETALHE POR PILAR
- `172919f` — deletar frase explicativa da Atratividade
- `f9c3109` — deletar frase Fator R Simples
- `feecd18` — deletar "Negócio já está no regime ótimo"
- `0a15c03` — "Regime Ótimo" → "Regime Ideal"
- `07637e5` — refactor regras de status PMP/PMR/Ciclo financeiro
- `6574307` — renomear cabeçalhos da tabela de indicadores
- `92c451a` — toggle dark/light via CSS variables
- `78eb37f` — fallback `_versao_parametros` → '—'
- `e2e94a0` — hero usa `potencial_12m.potencial_final.valor_projetado_brl`
- `3ccdf8b` — `renderUpsides` pra schema v2026.07 `{ativos, paywalls}`
- `3dd762e` — DEMO_DATA pra schema v2026.07

---

## RECOMENDAÇÃO ARQUITETURAL

**Não adaptar a main por incrementos.** Substituir o `laudo-pago.html` da main pela versão da backend-v2, depois ajustar o que mudou desde então:

1. Catálogo é v2026.08 agora (sem `pa_reestruturar_dividas`)
2. Skill v2 ganhou `efeito_explicacao`, `ganho_anual_caixa_brl`, `ganho_mensal_caixa_brl`, `impacto_valuation_brl` por upside
3. Rebranding "1Sócio" → "1N Consultoria" (provavelmente não está na ideal)
4. WhatsApp 5511952136406 (não 5548999279320)
5. Toggle tributário 3-way (inelegível → Crítico)
6. Patrimônio com sinal (sem max(0,pl))
7. Texto Fator 1N conceitual fixo

Esse é um briefing separado — este documento mapeia só o estado atual.

---

## MAPA POR SEÇÃO — laudo-pago.html ATUAL DA MAIN

Numeração visual da main: Capa não-explícita + 13 seções `.sec page-break`.

### SEÇÃO 01 — Metodologia de Avaliação (linha 686)

| Elemento | Origem hoje (main) | Path v2 alvo |
|----------|---------------------|--------------|
| Cabeçalho "01 / Laudo Principal" | hardcode HTML | manter |
| Texto "A avaliação da 1Negócio combina três abordagens..." | hardcode HTML | manter (texto institucional fixo) |
| 5 met-step (Resultado Op, Múltiplo Setorial, Fator ISE, Fator 1N = Mult × ISE, Valor de Venda = Op + PL) | hardcode HTML | manter (texto fixo) |

### SEÇÃO 02 — Contexto do Negócio (linha 699)

| Elemento | Origem hoje (main) | Path v2 alvo |
|----------|---------------------|--------------|
| `${ctxParas}` (template inline 17 vars) | template inline (linhas ~640+) | `textos_ia.texto_contexto_negocio.conteudo` |

### SEÇÃO 03 — DRE Estruturada (linha 704)

| Elemento | Origem hoje (main) | Path v2 alvo |
|----------|---------------------|--------------|
| Faturamento bruto | `CJ.fat_mensal` (skill v1) | `dre.fat_mensal` |
| Impostos | `CJ.impostos` ou `fat*0.10` (calc inline) | `dre.deducoes_receita.impostos.mensal` |
| Taxas de recebimento | `CJ.taxas` | `dre.deducoes_receita.taxas_recebimento` |
| Comissões | `CJ.comissoes` | `dre.deducoes_receita.comissoes` |
| (sem antecipação no atual) | — | `dre.deducoes_receita.antecipacao_recebiveis` (S2.2 — adicionar) |
| Receita Líquida | `CJ.rec_liq` ou calc | `dre.rec_liquida` |
| CMV | `CJ.cmv` ou `fat*0.X` (calc) | `dre.cmv` |
| Lucro Bruto | `CJ.lb` ou calc | `dre.lucro_bruto` |
| Folha CLT | `CJ.clt_folha` | `dre.pessoal.clt_folha_bruta` |
| Encargos CLT | `CJ.clt_encargos` | `dre.pessoal.clt_encargos` |
| **Provisões CLT** (no DRE) | `CJ.clt_provisoes` | **REMOVER do DRE** (decisão Thiago: só no BP) |
| PJ / freela | `CJ.pj_custo` | `dre.pessoal.pj_custo` |
| Aluguel | `CJ.aluguel` | `dre.ocupacao.aluguel` |
| Facilities | `CJ.facilities` | `dre.ocupacao.facilities` |
| Sistemas | `CJ.sistemas` | `dre.operacional_outros.sistemas` |
| Outros CF | `CJ.cf` | `dre.operacional_outros.outros_cf` |
| Marketing | `CJ.mkt` | `dre.operacional_outros.mkt_pago` |
| Resultado Operacional | `CJ.ro_mensal` | `dre.ro_mensal` |
| Pró-labore (informativo) | `CJ.prol` | `operacional.prolabore_mensal_total` ou `dre.bloco_5_caixa.prolabore` |
| Parcelas dívidas | `CJ.parcelas` | `dre.bloco_5_caixa.parcelas_dividas` |
| Antecipação (informativo) | `CJ.antecipacao` | (já movido pra bloco_1 em S2.2) |
| Investimentos | `CJ.investimentos` | (Thiago: NÃO captura, remover) |
| Potencial de caixa | `CJ.potencial_caixa` | `dre.bloco_5_caixa.potencial_caixa_mensal` |

### SEÇÃO 04 — Balanço Patrimonial (linha 735)

| Elemento | Origem hoje (main) | Path v2 alvo |
|----------|---------------------|--------------|
| Caixa | `CJ.caixa` | `balanco.ativos.caixa` |
| Contas a receber | `CJ.receber` | `balanco.ativos.contas_receber` |
| Estoque | `CJ.estoque` | `balanco.ativos.estoque` |
| Equipamentos | `CJ.equip` | `balanco.ativos.equipamentos` |
| Imóvel (cond.) | `CJ.imovel` | `balanco.ativos.imovel` |
| Taxa de franquia | `CJ.ativo_franquia` | `balanco.ativos.ativo_franquia` |
| Total Ativos | `CJ.totAtiv` | `balanco.ativos.total` |
| Fornecedores | `CJ.forn` | `balanco.passivos.fornecedores_a_vencer` (+ atrasados) |
| Saldo devedor | `CJ.emprest` | `balanco.passivos.saldo_devedor_emprestimos` |
| Total Passivos | `CJ.totPass` | `balanco.passivos.total` |
| **Provisões trabalhistas** | (não está no DRE da main) | **NOVO**: `balanco.passivos.provisao_clt_calculada.valor` (decisão Thiago L.7) |
| Patrimônio Líquido | `CJ.pl` | `balanco.patrimonio_liquido` |

### SEÇÃO 05 — ISE · Índice de Solidez Empresarial (linha 758)

| Elemento | Origem hoje (main) | Path v2 alvo |
|----------|---------------------|--------------|
| Score 0-100 | `CJ.ise.total` | `ise.ise_total` |
| Classe | `CJ.ise_class` | `ise.classe` |
| Pilar Comercial (24%) | `CJ.ise.com` | `ise.pilares[id=p3_comercial]` |
| Pilar Financeiro (20%) | `CJ.ise.fin` | `ise.pilares[id=p1_financeiro]` |
| Pilar Gestão (20%) | `CJ.ise.ges` | `ise.pilares[id=p4_gestao]` |
| Pilar Independência (18%) | `CJ.ise.dep` | `ise.pilares[id=p5_socio_dependencia]` |
| Pilar Concentração (10%) | `CJ.ise.conc` | (sub-métrica de `p3_comercial` em v2 — não renderizar como pilar) |
| Pilar Escalabilidade (10%) | `CJ.ise.esc` | (não existe em v2 — não renderizar) |
| Pilar Dívida (5%) | `CJ.ise.div` | (sub-métrica em v2) |
| Pilar Risco Jurídico (5%) | `CJ.ise.ris` | `ise.pilares[id=p6_risco_legal]` |
| (faltando na main) | — | `ise.pilares[id=p2_resultado]` (NOVO em v2) |
| (faltando na main) | — | `ise.pilares[id=p7_balanco]` |
| (faltando na main) | — | `ise.pilares[id=p8_marca]` |

**Mapeamento 10→8**: 6 renames diretos, 1 novo (`p2_resultado`), 1 sumiu (`escalabilidade`), 2 viraram sub-métricas (`conc`, `div`).

### SEÇÃO 06 — Indicadores Chave (linha 776)

| Indicador | Origem hoje | Path v2 alvo |
|-----------|-------------|--------------|
| Resultado por colaborador | calc inline `ro/numFuncs` | `indicadores_vs_benchmark.ro_por_funcionario_mensal` |
| Margem operacional | calc inline `pct(ro,fat)` | `indicadores_vs_benchmark.margem_operacional` |
| Recorrência | `CJ.recorrencia` | `indicadores_vs_benchmark.recorrencia` |
| Concentração | `CJ.concentracao` | `indicadores_vs_benchmark.concentracao` |
| Ticket médio | `CJ.ticket` | `indicadores_vs_benchmark.ticket_medio` |
| (faltando na main) | — | `indicadores_vs_benchmark.endividamento_vs_ro` (NOVO via S2.4) |

### SEÇÃO 07 — Comparativo vs Mercado (linha 790)

| Elemento | Origem hoje | Path v2 alvo |
|----------|-------------|--------------|
| Margem op vs benchmark | `b.ro` hardcoded por setor | `indicadores_vs_benchmark.margem_operacional.{valor, benchmark, status, delta_pp}` |
| Recorrência vs ref 40% | hardcoded `40%` | `indicadores_vs_benchmark.recorrencia.benchmark` |
| Impostos vs `b.imp` | hardcoded por setor | `indicadores_vs_benchmark.deducoes_pct.benchmark` |
| Fator 1N vs `b.mulRange` | hardcoded por setor | `valuation.multiplo_setor.valor` (e label) |
| Resultado/func vs R$ 2.000 | hardcoded `2000` | derivar (ou skill expor benchmark futuramente) |

### SEÇÃO T — Comparativo de Regimes Tributários (linha 803)

| Elemento | Origem hoje | Path v2 alvo |
|----------|-------------|--------------|
| Linhas (MEI, Simples, Presumido, Real) | DataLoader linha 803, ID condicional | `analise_tributaria.comparativo_regimes[]` |
| Imposto/mês por regime | `r.imposto_mensal` | `r.imposto_anual / 12` (v2 dá anual) |
| % alíquota | `r.pct` | `r.aliquota_efetiva_pct` |
| Elegível flag | `r.elegivel` | `r.elegivel` |
| Motivo inelegibilidade | `r.motivo` | `r.motivo_inelegibilidade` |
| Economia | `(imp_atual - imp_regime) × 12` | derivar igual |
| Alerta inelegível | derivado | `analise_tributaria.alerta_inelegibilidade` |

### SEÇÃO 08 — Valuation · Fator 1N (linha 810)

| Elemento | Origem hoje | Path v2 alvo |
|----------|-------------|--------------|
| RO Anual | `CJ.ro_mensal × 12` | `valuation.ro_anual` |
| Fator 1N | `CJ.fator` | `valuation.fator_final` |
| Múltiplo base | `CJ.mul_base` | `valuation.multiplo_base` |
| Modificador setorial | `CJ.mul_mod` | `valuation.multiplo_setor.valor` |
| Fator ISE | `CJ.mul_ise` | `valuation.fator_ise.valor` |
| Patrimônio | `Math.max(0, pl)` ❌ | `valuation.patrimonio_liquido` (com sinal — corrigir como em laudo-completo BUG 4a) |
| Valor de Venda | `CJ.valor_venda` | `valuation.valor_venda` |

### SEÇÃO A1 — Parecer 1Negócio (linha 837)

| Elemento | Origem hoje | Path v2 alvo |
|----------|-------------|--------------|
| `parecerParas` (template gigante) | template inline (linhas ~640) | `textos_ia.texto_parecer_tecnico.conteudo` |

### SEÇÃO A2 — Índice de Atratividade (linha 846)

| Elemento | Origem hoje | Path v2 alvo |
|----------|-------------|--------------|
| Score | `CJ.atratividade.score` ou `atr.score` | `atratividade.total` (normalizar 0-10) |
| Label (Alta/Boa/Moderada/Baixa) | derivado | `atratividade.label` |
| 6 pilares (Solidez, Setor, Recorrência, Independência, Crescimento, Margem) | hardcode | **3 componentes**: `atratividade.componentes[]` (ise, setor, crescimento) |

### SEÇÃO A3 — Top 10 Oportunidades (linha 862)

| Elemento | Origem hoje | Path v2 alvo |
|----------|-------------|--------------|
| `ops[]` | skill v1 calcula | `potencial_12m.upsides_ativos[]` |
| `op.titulo` | flat | `u.label` |
| `op.descricao` | flat | `u.descricao` (S2.1 propaga) |
| `op.ganho_label` | flat | derivar de `u.contribuicao_brl` ou usar `efeito_explicacao` |
| (NOVO em v2) | — | `u.ganho_mensal_caixa_brl`, `u.impacto_valuation_brl`, `u.efeito_explicacao` |

### SEÇÃO A4 — Resumo do Diagnóstico (linha 871)

Lista completa de inputs declarados — 50+ campos puxados de `raw.dados_json` ou `D` direto. Em v2 todos vêm de `calc_json.identificacao` + `calc_json.operacional` + atalhos topo do `dre`.

---

## DEPENDÊNCIAS EXTERNAS

| Dep | Linha | Status |
|-----|-------|--------|
| `<script src="/skill-avaliadora.js">` | 232 | **REMOVER** (skill v1) |
| `<script src="/skill-avaliadora.js">` | 234 | **REMOVER** (DUPLICADA) |

Versão ideal **não importa skill v1** — só `Chart.js` (CDN).

---

## HARDCODES PROBLEMÁTICOS

1. ISE 10 pilares com pesos hardcoded (24%/20%/20%/18%/10%/10%/5%/5%) — linha 762-771
2. Benchmarks setoriais inline (`b.ro`, `b.imp`, `b.mulBase`) — derivados de mapa hardcoded
3. Resultado/func threshold `2000` hardcoded — linha 781
4. Setor labels (`alimentacao`, `varejo`, etc.) — vários
5. DEMO_DATA inline (linha 1146, ~25 campos) — schema v1
6. Texto da metodologia (5 met-steps) — fixo OK
7. Cláusula de "due diligence" e similares — texto institucional OK
8. `parecerParas` template gigante — substituir por IA
9. `ctxParas` template gigante — substituir por IA

---

## DEMO_DATA

| | Localização | Tamanho |
|---|---|---|
| main atual | linha 1146 | inline ~25 campos |
| Versão ideal | sim (commit `3dd762e`) | reformulado pra schema v2026.07 |

---

## RESUMO ESTATÍSTICO

| Categoria | Quantidade |
|-----------|------------|
| Total de elementos visuais distintos mapeados | ~120 |
| Vindos de skill v1 / `CJ.*` | ~75 |
| Calculados inline | ~15 |
| Hardcoded HTML (textos institucionais, meta) | ~25 |
| DEMO_DATA inline | 1 bloco |
| Cálculos `Math.max(0, ...)` ou heurísticas | ~5 |

---

## DIFERENÇAS VS LAUDO-COMPLETO (já adaptado na main)

**Laudo-pago tem que laudo-completo NÃO tem:**
- Capa formal
- Folha de rosto
- Índice
- Seções A1, A2, A3, A4 (anexos)
- Comparativo vs Mercado dedicado
- Charts (radar ISE, funil DRE, progressão) — só na versão ideal
- Toggle dark/light — só na versão ideal
- Texto institucional de metodologia
- 6 textos IA integrados (na versão ideal: contexto, parecer, riscos, diferenciais, público, consideracoes_valor)

**Laudo-completo tem que laudo-pago NÃO tem:**
- Termômetro comparativo (3 markers: expectativa, 1N, potencial)
- Bloco "1N Consultoria" com KPIs Ganho Anual + Valorização 12M
- 4 popups (Sócio, Laudo R$99, Gratis, Guiado)
- CTAs "Publicar Gratuitamente" / "Publicação Guiada"
- Sticky footer de compra
- Modal de confirmação Stripe

São produtos com escopos diferentes — pago é PDF profissional para apresentar a comprador/investidor; gratuito é HTML interativo de upsell.

---

## ITENS AMBÍGUOS — exigem decisão Thiago antes de adaptar

1. **Substituir main pela backend-v2 ou adaptar incrementalmente?**
   Recomendação: substituir + ajustar (decisões pós-fork: catálogo v2026.08, S2.4, branding 1N Consultoria, BUG 4a/4b/3, WhatsApp).

2. **Pilares ISE removidos**: na main aparecem 10 (com Concentração, Escalabilidade, Dívida). Na versão ideal? (verificar). Decisão de produto: laudo-pago mostra os 8 pilares v2 ou mantém apresentação detalhada com sub-métricas?

3. **Comparativo vs Mercado seção 07**: a v2 já tem `indicadores_vs_benchmark.<ind>.benchmark` embutido em cada indicador, mas a main usa um mapa setorial separado (`b.ro`, `b.imp`, etc.). Versão ideal usa qual?

4. **Resultado/func threshold 2000**: na v2 o indicador `ro_por_funcionario_mensal` não tem benchmark hardcoded. Decisão: skill v2 expõe benchmark ou laudo abandona o status semaforizado?

5. **Demo data**: deletar como no laudo-completo, ou manter atualizado?

---

*Mapeamento gerado em 29/04/2026. Apenas leitura, zero modificações em código.*
