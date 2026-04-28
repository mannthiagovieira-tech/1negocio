# Varredura completa — campos `D.*` consumidos pela skill

Data: 2026-04-28 · Branch: `backend-v2` · Base: commit `5b0c4b1`
Autor: Claude Code (somente leitura)

Cross-check sistemático de cada campo `D.<...>` lido pela skill contra `diagnostico.html`. **Sem mudanças de código** — só identificação.

**Cobertura:** 81 campos únicos `D.*` extraídos de `skill-avaliadora-v2.js` (todas as funções: mapDadosV2, calcDREv2, calcBalancoV2, calcPilar1-8, calcISEv2, calcValuationV2, calcAtratividadeV2, calcAnaliseTributariaV2, calcIndicadoresV2, calcICDv2, gerarUpsidesV2, montarCalcJsonV2).

**Legenda do status:**
- ✓ OK — campo existe no diag, nome bate, domínio bate
- ✓ derivado — diag salva com nome diferente, mapDadosV2 normaliza corretamente
- ✓ corrigido — bug tratado em commit anterior (`5b0c4b1`, `08d3871`, `312e3f2`)
- ✓ interno — campo gerado pela própria skill (não vem do diag)
- ⚠ mismatch_nome — skill busca X, diag salva Y com nomes diferentes (sem alias em mapDadosV2)
- ⚠ mismatch_dominio — nome bate, mas valores possíveis diferem
- ⚠ regra_2 — campo existe e bate mas é projeção do vendedor (Coisa A — não pode entrar em score)
- ⚠ fallback_oco — skill consulta o campo mas mapDadosV2 nunca seta; passa por fallback redundante
- ❌ campo_fantasma — skill consome, diag nunca salva, sem alias

---

## Tabela completa

### Identificação / contexto

| campo na skill | tipo esperado | existe no diag? | nome no diag | domínio diag | status |
|---|---|---|---|---|---|
| `D.id` | string | — (interno) | — | — | ✓ interno |
| `D.codigo` | string | derivado | `D.codigo_diagnostico` | string | ✓ derivado |
| `D.codigo_diagnostico` | string | sim | `D.codigo_diagnostico` | string | ✓ OK |
| `D.slug` | string | — (interno) | — | — | ✓ interno |
| `D.nome` | string | derivado | `D.nome_negocio` | string | ✓ derivado (mapDadosV2:794) |
| `D.nome_responsavel` | string | **não** | (diag salva `D.nome_contato`) | string | ⚠ mismatch_nome — mapDadosV2 lê `dados.nome_responsavel` mas diag salva como `D.nome_contato`. Em produção fica vazio. |
| `D.tipo_negocio_breve` | string | **não** (diag tem `D.tipo_negocio`) | `D.tipo_negocio` (textarea livre) | string livre | ⚠ mismatch_nome — skill espera `_breve`, diag não diferencia. |
| `D.cidade` / `D.estado` | string | sim | igual | string | ✓ OK |
| `D.anos` | number | derivado | `D.anos_existencia` ou `D.cnpj_anos` | number | ✓ derivado (mapDadosV2:798) |
| `D.tempo_operacao_anos` | number | **não** | — (diag só tem `D.anos_existencia`) | number | ⚠ fallback_oco — montarCalcJsonV2:2316 faz `D.tempo_operacao_anos \|\| D.anos`. Sempre cai no fallback porque mapDadosV2 só seta `D.anos`. Funciona, mas o ramo principal é morto. |
| `D.regime` / `D.anexo` | string | derivado | `D.regime_tributario` / `D.anexo_simples` | string | ✓ derivado (mapDadosV2:638-651) |
| `D.modelo_atuacao_multi` | array | sim | igual | array | ✓ OK |
| `D.modelo_multi` / `D.modelo_atuacao_principal` / `D.modelo_code` | string/array | — | (derivados em mapDadosV2:655-656) | — | ✓ derivado |
| `D.setor_code` / `D.setor_label` / `D.setor_raw` | string | — | (derivados em mapDadosV2 a partir de `d.setor`) | — | ✓ derivado |
| `D.franquia` | string | sim | igual | `'sim'/'nao'` | ✓ OK |
| `D.expectativa_val` | number | sim | igual | number | ✓ OK |
| `D.expectativa_valor_dono` | number | **não** | — | number | ⚠ fallback_oco — montarCalcJsonV2:2317 faz `D.expectativa_valor_dono \|\| D.expectativa_val`. Mesmo padrão do `tempo_operacao_anos`. |

### DRE (calcDREv2 + insumos)

| campo na skill | tipo | existe no diag? | nome no diag | domínio | status |
|---|---|---|---|---|---|
| `D.fat_mensal` / `D.fat_anual` | number | sim | igual | R$ | ✓ OK |
| `D.cmv_mensal` | number | sim | igual | R$ | ✓ OK |
| `D.pct_produto` | number | sim | igual | 0-100 | ✓ OK |
| `D.taxas_recebimento` | number | derivado | `d.custo_recebimento_total / d.custo_cartoes / d.custo_taxas_recebimento / d.custo_recebimento` | R$ | ✓ derivado (mapDadosV2:675-676) |
| `D.comissoes` | number | derivado | `d.custo_comissoes` | R$ | ✓ derivado (mapDadosV2:677) |
| `D.royalty_pct` / `D.royalty_fixo` | number | sim/derivado | `d.royalty_pct` / `d.royalty_valor` | R$ ou % | ✓ OK / derivado |
| `D.mkt_franquia_pct` / `D.mkt_franquia_fixo` | number | sim/derivado | igual / `d.mkt_franquia_valor` | R$ ou % | ✓ OK / derivado |
| `D.clt_folha` / `D.clt_qtd` | number | sim | igual | R$ / qty | ✓ OK |
| `D.pj_custo` / `D.pj_qtd` | number | sim | igual | R$ / qty | ✓ OK |
| `D.aluguel` | number | sim | igual | R$ | ✓ OK |
| `D.custo_utilities` / `D.custo_terceiros` / `D.custo_sistemas` / `D.custo_outros` / `D.mkt_valor` | number | sim | igual | R$ | ✓ OK |
| `D.prolabore` / `D.parcelas` | number | sim/derivado | igual / `d.parcelas_mensais` | R$ | ✓ OK / derivado |
| `D.investimentos` | number | **não** | — (diag não tem `investimentos_mensais` nem `D.investimentos`) | R$ | ❌ campo_fantasma — sempre 0. Consumido em calcDREv2 bloco 5 (potencial_caixa). |
| `D.impostos_precalc` / `D.aliquota_precalc` | number | derivado | `d.impostos_mensal/d.imposto_calculado/d.aliquota_imposto` | R$ / % | ✓ derivado |

### Balanço (calcBalancoV2)

| campo na skill | tipo | existe no diag? | nome no diag | domínio | status |
|---|---|---|---|---|---|
| `D.caixa` | number | derivado | `d.at_caixa` | R$ | ✓ derivado |
| `D.contas_receber` | number | derivado | `d.at_cr` | R$ | ✓ derivado |
| `D.estoque` | number | derivado | `d.at_estoque` ou `d.estoque_valor` | R$ | ✓ derivado |
| `D.equipamentos` | number | derivado | `d.at_equip` | R$ | ✓ derivado |
| `D.imovel` | number | derivado | `d.at_imovel` | R$ | ✓ derivado |
| `D.ativo_franquia` | number | sim | igual | R$ | ✓ OK |
| `D.outros_ativos` | number | **não** | (diag tem `D.at_outros` e `D.at_veiculos`, mapDadosV2 só lê `d.outros_ativos`) | R$ | ⚠ mismatch_nome — sempre 0 em produção. mapDadosV2:723 não chama de `at_outros`. |
| `D.fornec_a_vencer` / `D.fornec_atrasadas` | number | sim | igual | R$ | ✓ OK |
| `D.impostos_atrasados` | number | sim (referenciado em diag:6768) | igual | R$ | ✓ OK |
| `D.saldo_devedor` | number | sim | igual | R$ | ✓ OK |
| `D.outros_passivos` | number | **não** | (diag tem `D.outro_passivo_val`, mapDadosV2 lê `d.outros_passivos`) | R$ | ⚠ mismatch_nome — sempre 0 em produção. |
| `D.pmr` | number | sim (diag:5334 seta) | igual | dias | ✓ OK |
| `D.pmp` | number | **não** (zero ocorrências em diag) | — | dias | ❌ campo_fantasma — sempre 0. Consumido em calcBalancoV2:1085 (ciclo_financeiro) e calcIndicadoresV2:2031. |

### ISE — pilares 1-8 (sub-métricas qualitativas)

| campo na skill | pilar | tipo esperado | existe no diag? | nome no diag | domínio diag | status |
|---|---|---|---|---|---|---|
| `D.dre_separacao_pf_pj` | P1 | `'sim'/'parcial'` | **não** (zero ocorrências em diag) | — | — | ❌ campo_fantasma — P1.dre_separacao sempre score 0 em produção. |
| `D.contabilidade` | P1 | `'sim'/'parcial'/'nao'` | **não** (diag salva `D.contabilidade_formal` valores `'sim'/'interno'/'nao'`) | `D.contabilidade_formal` | `'sim'/'interno'/'nao'` | ⚠ mismatch_nome+dominio — P1.contabilidade_formal sempre score 0 em produção. Gate `rec_formalizar_contabilidade` (`D.contabilidade !== 'sim'`) sempre dispara. |
| `D.margem_estavel` | P2 | `'sim'/'crescente'/'decrescente'` | **não** (diag tem `D.margem_bruta` numérico, conceito diferente) | — | — | ❌ campo_fantasma — P2.margem_estavel sempre score `else 6` (linha 1216). |
| `D.recorrencia_pct` | P3 + indicadores | number | sim | igual | 0-100 | ✓ OK |
| `D.concentracao_pct` | P3 + indicadores | number | sim | igual | 0-100 | ✓ OK |
| `D.clientes` | P3 + indicadores | number | derivado | `d.cli_1m / d.clientes_ativos` | number | ✓ derivado (mapDadosV2:790). Diag também tem `D.cli_total` que NÃO é lido — possível campo extra ignorado. |
| `D.base_clientes` | P3 | `'sim'/'nao'` | sim | igual | string | ✓ OK |
| `D.processos` | P4 + recomendações | `'documentados'/'parcial'/'nao'` | sim | igual | igual | ✓ OK |
| `D.tem_gestor` | P4 + multiplo | `'sim'/'nao'` | (CORRIGIDO em `5b0c4b1`) | derivado de `D.gestor_autonomo` | `'sim'/'nao'` | ✓ corrigido |
| `D.custo_sistemas` | P4 + recomendação | number | sim | igual | R$ | ✓ OK |
| `D.opera_sem_dono` | P5 | `'sim'/'nao'` | (CORRIGIDO em `5b0c4b1`) | derivado de `D.gestor_autonomo` | `'sim'/'nao'` | ✓ corrigido |
| `D.equipe_permanece` | P5 | `'sim'/'parcial'/'nao'` | (CORRIGIDO em `5b0c4b1`) | igual | igual | ✓ corrigido |
| `D.prolabore` | P5 | number | sim | igual | R$ | ✓ OK |
| `D.passivo_trabalhista` | P6 + passivo | `'sim'/'nao'` | **não** (diag tem `D.passivo_juridico` que é monetário, e `D.processos_juridicos` que cobre judicial em geral) | — | — | ❌ campo_fantasma — P6.sem_passivo_trabalhista sempre score `else 5` (linha 1327). Gate `pa_resolver_passivos_trabalhistas` (`=== 'sim'`) nunca dispara. |
| `D.processos_juridicos` | P6 | `'sim'/'nao'` | sim | igual | igual | ✓ OK |
| `D.impostos_dia` | P6 | `'sim'/'parcelamento'/outro` | **não** (diag tem `D.sabe_impostos` que é se vendedor SABE quanto paga, e `D.impostos_pagos_mes` numérico — semanticamente diferente) | — | — | ❌ campo_fantasma — P6.impostos_em_dia sempre score 0 (linha 1333). |
| `D.impostos_atrasados` | P6 | number | sim | igual | R$ | ✓ OK |
| `D.marca_inpi` | P8 + recomendação | `'registrada'/'em_processo'/'sem_registro'` | sim | igual | `'registrada'/'processo'/'sem_registro'` | ⚠ mismatch_dominio menor — skill aceita `'registrada' \|\| 'sim'` e `'em_processo' \|\| 'processo'` (linha 1391-1392), tem fallback bilateral. Funciona, mas valor `'sem_registro'` cai no else 0. |
| `D.reputacao_online` | P8 | `'positiva'/'neutra'/'negativa'` | **não** (diag salva `D.reputacao` com `'excelente'/'boa'/'neutra'/'problemas'`) | `D.reputacao` | `'excelente'/'boa'/'neutra'/'problemas'` | ❌ mismatch_nome+dominio — P8.reputacao_online sempre score 5 (else 5, linha 1396). Gate de upside não dispara. **Briefing v2026.05 já tratou na padronização para `D.reputacao`** mas mapeamento em mapDadosV2 ainda lê `d.reputacao_online` (linha 762) — fix incompleto. |
| `D.presenca_digital` | P8 | `'forte'/'media'/'fraca'` | **não** (zero ocorrências) | — | — | ❌ campo_fantasma — P8.presenca_digital sempre score 0. **Já tratado no snapshot v2026.05 (sub-métrica REMOVIDA do P8 nos `pesos_sub_metricas_ise`)**, mas a skill ainda calcula `s3` em calcPilar8 (linha 1399). Resíduo a ser limpo no commit que migra os pesos. |

### Atratividade (calcAtratividadeV2)

| campo na skill | tipo | existe no diag? | nome no diag | domínio | status |
|---|---|---|---|---|---|
| `D.crescimento_pct` | number | sim | igual | 0-100 | ✓ OK |
| `D.crescimento_proj_pct` | number | sim | igual | 0-100 | ⚠ regra_2 — campo existe mas é **projeção do vendedor**. Briefing pede remoção do consumo em calcAtratividadeV2 (Frente 7). Continua como dado contextual em `dados_brutos` mas não pode entrar em score. |

### Outros (numerados em mapDadosV2)

| campo na skill | tipo | existe no diag? | status |
|---|---|---|---|
| `D.num_socios` | number | **não** (diag referencia `D.num_socios > 0` mas nunca atribui — usa `D.socios` categórico em `t10`, default `'nao'`) | ❌ campo_fantasma — montarCalcJsonV2:2469 faz `n(D.num_socios) \|\| 1` (sempre cai em 1). |
| `D._origem_campos` | object | — (interno mapDadosV2) | ✓ interno |

---

## Resumo executivo

### Status agregado

| status | quantidade | campos |
|--------|------------|--------|
| ✓ OK / derivado / interno / corrigido | 56 | (maioria; ver tabela) |
| ⚠ mismatch_nome | 5 | `nome_responsavel`, `tipo_negocio_breve`, `outros_ativos`, `outros_passivos`, `marca_inpi` (parcial) |
| ⚠ fallback_oco | 2 | `tempo_operacao_anos`, `expectativa_valor_dono` |
| ⚠ regra_2 | 1 | `crescimento_proj_pct` (já no escopo do refactor — Frente 7) |
| ❌ campo_fantasma | 9 | `investimentos`, `pmp`, `dre_separacao_pf_pj`, `margem_estavel`, `passivo_trabalhista`, `impostos_dia`, `presenca_digital`, `num_socios`, `reputacao_online` (efetivamente fantasma por mismatch dominio+nome) |

### Bugs críticos identificados (impacto em produção)

**FANTASMAS QUE BLOQUEIAM SUB-MÉTRICAS DO ISE:**

1. **P1.dre_separacao** (`D.dre_separacao_pf_pj`) — sempre 0
2. **P1.contabilidade_formal** (`D.contabilidade`) — sempre 0 (mismatch com `D.contabilidade_formal` do diag)
3. **P2.margem_estavel** (`D.margem_estavel`) — sempre cai em score 6 (else)
4. **P6.sem_passivo_trabalhista** (`D.passivo_trabalhista`) — sempre cai em score 5 (else)
5. **P6.impostos_em_dia** (`D.impostos_dia`) — sempre 0
6. **P8.reputacao_online** (`D.reputacao_online`) — sempre cai em score 5 (else)
7. **P8.presenca_digital** (`D.presenca_digital`) — sempre 0 (já flagado, snapshot v2026.05 remove)

**Total ISE comprometido em produção:** 7 sub-métricas zeradas/mortas distribuídas em 4 dos 8 pilares. **Estimativa de impacto no ISE total:**
- P1 (peso 20%): 2 das 4 sub-métricas mortas → -10 pontos (50% × 20)
- P2 (peso 15%): 1 das 3 sub-métricas com score fixo 6 → -1 ponto (assumindo correto seria 8)
- P6 (peso 10%): 2 das 4 sub-métricas mortas → -5 pontos (50% × 10)
- P8 (peso 7%): 2 das 3 sub-métricas mortas → -4.6 pontos (66% × 7)

**Total: ISE em produção é ~20 pontos abaixo do que deveria ser** se essas sub-métricas funcionassem. Negócios cuja saúde real seria "Consolidado" (70-84) caem em "Operacional" (50-69) ou "Dependente" (35-49). Fator de classe aplicado ao valuation cai junto: 1.15 vs 1.00 ou 0.85 — diferença de 15-30% no múltiplo final.

**Gates de upsides afetados (catálogo v2026.05):**
- `rec_formalizar_contabilidade` (`D.contabilidade !== 'sim'`) — **dispara para 100% dos negócios**
- `pa_resolver_passivos_trabalhistas` (`D.passivo_trabalhista === 'sim'`) — **nunca dispara**

### Bugs não-críticos (mismatch sem impacto silencioso)

- `nome_responsavel` — em produção fica vazio na folha de rosto (mas não trava nada)
- `tipo_negocio_breve` — sempre vazio, mas é só texto opcional
- `outros_ativos`/`outros_passivos` — sempre 0 no balanço, mas a maioria dos vendedores não preenche isso de qualquer forma
- `tempo_operacao_anos`/`expectativa_valor_dono` — fallback transparente
- `num_socios` — sempre 1 (default), provavelmente OK pra maioria PME

### Padrões observados

1. **Convenção de nomes do diag NÃO foi seguida** — diag usa nomes como `D.at_*` (ativos), `D.outro_passivo_val` (singular), `D.contabilidade_formal`, `D.passivo_juridico`, `D.sabe_impostos`. Skill tem nomes diferentes (`D.outros_ativos`, `D.outros_passivos`, `D.contabilidade`, `D.passivo_trabalhista`, `D.impostos_dia`).
2. **mapDadosV2 cobre só parte dos casos** — alguns aliases foram criados (caixa ← at_caixa, contas_receber ← at_cr), outros não (outros_ativos, contabilidade).
3. **mismatch de domínio é tão comum quanto mismatch de nome** — `reputacao` foi recategorizado, `marca_inpi` tem sufixos diferentes, `equipe_permanece` (corrigido).
4. **Campos qualitativos do ISE são os mais frágeis** — 7 dos 9 fantasmas são sub-métricas qualitativas.

### Ordem de magnitude pra correções

| nível | quantidade | esforço estimado |
|-------|------------|------------------|
| **Crítico** (corrige P1, P2, P6, P8 do ISE) | 6 fantasmas + 1 mismatch | 2-3 horas, mexe em mapDadosV2 + calcPilar1/2/6/8 |
| **Médio** (campos com nome diferente) | 4 mismatches | 1 hora, só mapDadosV2 |
| **Baixo** (já endereçado parcialmente) | `presenca_digital`, `reputacao_online` | já em v2026.05, falta limpar resíduo no calcPilar8 |
| **Fora do escopo do refactor** | `crescimento_proj_pct` (Frente 7) | já planejado |

### Decisões pedidas pra Thiago antes do commit 3 (`agregarPotencial12mV2`)

1. **`rec_formalizar_contabilidade` dispara para 100%** — os números do potencial_12m vão refletir isso. Aceitar e calibrar a `economia_estimada_pct` do upside, ou corrigir o gate primeiro? (Sugestão: corrigir o nome do campo em mapDadosV2 — ler `d.contabilidade_formal` — antes do commit 3 porque afeta validação Forste.)

2. **`pa_resolver_passivos_trabalhistas` nunca dispara** — Forste DEMO tem `passivo_trabalhista='nao'` no fixture, mas em produção ninguém preenche `passivo_trabalhista`. Se quisermos que esse upside ative, precisa de pergunta no diag ou usar `D.passivo_juridico > 0` como proxy.

3. **Fantasmas do ISE (P1.dre_separacao, P2.margem_estavel, P6.impostos_dia, P8.reputacao_online, P8.presenca_digital)** — corrigir antes do commit 3, junto, ou deixar pra commit dedicado pós-refactor de upsides? Eu recomendo **commit dedicado** porque mexe em pilares do ISE (escopo diferente) e o agregarPotencial12mV2 não depende dessas correções pra funcionar.

4. **`outros_ativos` e `outros_passivos` — adicionar alias em mapDadosV2 (`D.outros_ativos = d.outros_ativos || d.at_outros`)?** Pequeno fix.

5. **`crescimento_proj_pct`** — já planejado no commit 8 do refactor, mas o relatório original (de pesos ISE) também sinalizou. Confirmar: remover de calcAtratividadeV2 OU o briefing já cobre suficientemente?

**Aguardando seu OK para iniciar commit 3.**
