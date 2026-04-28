# Auditoria dos upsides existentes — pré-refactor

Data: 2026-04-28 · Branch: `backend-v2` · Base: commit `4e77e07`
Autor: relatório gerado por Claude Code (somente leitura)

## Inventário completo

A skill define **20 upsides hoje**, divididos em duas listas:

- **14 candidatos dinâmicos** (ativados por `gate`), distribuídos em `obrigatorio` (1), `ganho_rapido` (6), `estrategico` (5), `transformacional` (2)
- **6 bloqueados fixos** (paywall, sempre presentes em laudo-pago, sem gate)

O briefing fala em "14 entries". Os 6 bloqueados são placeholders fixos com `impacto(5, 20)` igual pra todos — **decisão pendente: entram no catálogo ou ficam fora?** (sugestão no fim do relatório).

Os 14 candidatos abaixo, todos de `skill-avaliadora-v2.js` (linhas indicadas):

## Tabela dos 14 upsides candidatos

| # | id | gate atual (linha) | usa projeção do vendedor? | min_pct | max_pct | categoria atual | categoria proposta |
|---|----|--------------------|---------------------------|---------|---------|-----------------|--------------------|
| 1 | `obrigatorio_tributario` | `analise_tributaria.gera_upside_obrigatorio === true` (2203) | NÃO | 5 | 15 | obrigatorio | **tributario** |
| 2 | `gr_regularizar_fornecedores` | `balanco.passivos.fornecedores_atrasados > dre.fat_mensal` (2229) | NÃO | 2 | 5 | ganho_rapido | **financeiro** |
| 3 | `gr_formalizar_contabilidade` | `D.contabilidade !== 'sim'` (2248) | NÃO | 3 | 7 | ganho_rapido | **operacional** |
| 4 | `gr_separar_pf_pj` | `D.dre_separacao_pf_pj !== 'sim'` (2267) | NÃO | 5 | 10 | ganho_rapido | **operacional** |
| 5 | `gr_documentar_processos` | `D.processos !== 'sim' && D.processos !== 'documentados'` (2286) | NÃO | 5 | 10 | ganho_rapido | **operacional** |
| 6 | `gr_registrar_marca` | `D.marca_inpi !== 'registrada' && D.marca_inpi !== 'sim'` (2305) | NÃO | 2 | 5 | ganho_rapido | **operacional** |
| 7 | `gr_treinar_gerente` | `D.tem_gestor !== 'sim' && D.opera_sem_dono !== 'sim'` (2324) | NÃO | 8 | 15 | ganho_rapido | **operacional** |
| 8 | `est_diversificar_clientes` | `D.concentracao_pct > 30` (2344) | NÃO | 5 | 15 | estrategico | **financeiro** |
| 9 | `est_aumentar_recorrencia` | `D.recorrencia_pct < benchInd.recorrencia_tipica × 0.5` (2364) | NÃO | 10 | 25 | estrategico | **financeiro** |
| 10 | `est_reestruturar_dividas` | `balanco.passivos.saldo_devedor > balanco.ativos.total × 0.5` (2385) | NÃO | 5 | 15 | estrategico | **financeiro** |
| 11 | `est_resolver_passivos_trabalhistas` | `D.passivo_trabalhista === 'sim'` (2404) | NÃO | 5 | 10 | estrategico | **operacional** |
| 12 | `est_otimizar_custos` | `dre.margem_operacional_pct < benchDre.margem_op - 10` (2425) | NÃO | 10 | 20 | estrategico | **financeiro** |
| 13 | `tr_programa_estruturacao` | `ise.ise_total < 60 && valuation.valor_venda > 200000` (2445) | NÃO | 20 | 50 | transformacional | **transformacional** |
| 14 | `tr_acelerar_crescimento` | `D.crescimento_pct < 5 && score_setor >= 7` (2465) | **NÃO** (mas vide ⚠ abaixo) | 25 | 60 | transformacional | **transformacional** |

## Conclusão sobre projeção do vendedor

**Nenhum dos 14 upsides candidatos tem gate que dependa diretamente de `D.crescimento_proj_pct`** (campo de projeção do vendedor declarado em mapDadosV2 linha 634). Bom.

`D.crescimento_proj_pct` só é consumido em **`calcAtratividadeV2`** (linha 1614) como fallback do componente "Momentum de crescimento" — esse é o ponto que entra no escopo do item 6.2 do briefing.

## Ressalvas dignas de atenção

### ⚠ Upside #14 — `tr_acelerar_crescimento`: gate falha aberto

O gate `D.crescimento_pct < 5` parece sólido, mas `D.crescimento_pct` cai em **`fallback_zero`** quando `fat_anterior` está vazio (mapDadosV2 linhas 627–628). Resultado: qualquer negócio que **não preencheu o faturamento do ano anterior** automaticamente passa o gate (`0 < 5`).

Forste DEMO tem exatamente esse perfil (`fat_anterior: 0`), por isso o upside ativou e dominou o agregado com midpoint 42.5%.

**Não é uso de projeção**, mas é o item 6.1 do briefing (fail-open). A correção é exatamente o que o briefing pede: `crescimento_pct = null` quando ausente, e gates devem testar `(crescimento_pct !== null && crescimento_pct < X)`.

**Sem essa correção**, mesmo com o catálogo migrado, esse upside continua disparando indevidamente.

### ⚠ Upside #14 — limite `score_setor >= 7` usa parâmetro de escopo errado

Linha 2184: `const score_setor = n((P.score_setor_atratividade || {})[setor_code]) || 5`.

`P.score_setor_atratividade` é o score que entra no componente Setor da **Atratividade** (peso 25%). Reusá-lo como gate de upside mistura responsabilidades de produto. Sugiro abrir `P.score_setor_para_gates_upside` separado — mas só se o Thiago achar relevante. Não é bug funcional, é mistura de domínio.

### ⚠ Dados auto-declarados (não-projeção, mas não-validados)

Vários gates usam dados realizados auto-declarados pelo vendedor, sem validação cruzada:

- `D.concentracao_pct` (#8) — declarado como % do faturamento do maior cliente
- `D.recorrencia_pct` (#9) — declarado como % do faturamento recorrente
- `D.passivo_trabalhista` (#11) — auto-declarado
- `D.margem_operacional_pct` (#12) — calculado, mas a partir de inputs auto-declarados (folha, aluguel, etc.)
- `D.contabilidade`, `D.dre_separacao_pf_pj`, `D.processos`, `D.marca_inpi`, `D.tem_gestor`, `D.opera_sem_dono` — todos auto-declarados via select

**Isso NÃO viola a Regra 2** do briefing (Regra 2 fala de **projeções futuras**, não de **declarações realizadas**). Mas vale registrar que toda a base de gates é declarativa — não há cross-check externo (CND, SISConv, INPI, etc.). Isso fica como observação para evolução futura, fora do escopo deste refactor.

### ⚠ `est_diversificar_clientes` usa umbral fixo `> 30%` ignorando benchmark setorial

Linha 2344: gate é `D.concentracao_pct > 30`. Mas `benchInd.concentracao_max` (do snapshot) tem o limite por setor (varejo=5, saúde=12, varejos_locais=12, serviços_empresas=18, etc.). Usar 30 como universal ignora o trabalho de calibração do snapshot.

Sugestão de correção (durante migração para o catálogo): mudar gate pra `D.concentracao_pct > P.benchmarks_indicadores[setor].concentracao_max`. Não é "inventar gate novo" — é alinhar com o critério setorial que já existe na tabela.

**Aguardo decisão do Thiago: aplicar essa correção durante a migração ou manter `> 30` literal?**

## Origem dos `min_pct` / `max_pct`

**Todos os 14 percentuais são literais inline na função `gerarUpsidesV2`.** Não há comentário documentando origem. Não vêm de tabela. Não vêm de parâmetro. Não há cálculo.

A migração para `P.upsides_catalogo[id].impacto` é correta — mas o briefing pede `fonte_de_calculo` em cada entry. Como **nenhum dos 14 tem fonte documentada**, sugiro preencher com `"a calibrar — número herdado do código original sem fonte explícita"` em cada entry como honesto, e abrir issue separada para calibração futura.

## Decisão pendente sobre os 6 bloqueados

```
bl_funil_vendas              · "Análise completa do funil de vendas"
bl_transicao_sucessor        · "Plano de transição para o sucessor"
bl_eficiencia_operacional    · "Diagnóstico de eficiência operacional"
bl_roadmap_profissionalizacao· "Roadmap de profissionalização"
bl_competitividade_mercado   · "Análise de competitividade no mercado"
bl_otimizacao_tributaria_avancada · "Otimização tributária avançada"
```

Todos com `impacto(5, 20)` igual, `acesso: 'pago'`, sem gate dinâmico — são placeholders de paywall para o laudo-pago R$99.

**Três opções:**

1. **Não entram no catálogo** — ficam como array hardcoded no fim de `gerarUpsidesV2` (status quo). Não somam no potencial. Apenas display.
2. **Entram no catálogo com `categoria: 'paywall'`** ou `'bloqueado'` — explicitamente fora da agregação, mas centralizados em `parametros_versoes`.
3. **Entram no catálogo com categoria normal** — somariam no potencial. Não recomendo: bloqueados são display-only, não recomendações ativas.

**Minha sugestão: opção 2.** Centralizar tudo em `parametros_versoes`, mas marcar com `categoria: 'paywall'` que `agregarPotencial12mV2` ignora explicitamente.

**Aguardo decisão do Thiago.**

## Resumo executivo

- 14 candidatos dinâmicos auditados, 6 bloqueados fixos identificados
- **Zero usa `D.crescimento_proj_pct` no gate** — Regra 2 não é violada nos upsides hoje
- **`tr_acelerar_crescimento` falha aberto** quando `fat_anterior` está vazio — depende do fix 6.1 para gate funcionar
- **Todos os percentuais são hardcoded sem fonte** — `fonte_de_calculo` será preenchida com "a calibrar" em cada entry
- 4 questões de design abertas (categoria proposta para dúvidas; bloqueados; gate de concentração ignorando benchmark; score_setor reutilizado)

**Pronto para migração para `P.upsides_catalogo` aguardando decisões do Thiago sobre os 4 pontos acima.**
