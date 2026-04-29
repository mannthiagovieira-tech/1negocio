# Mapa exaustivo — laudo-completo.html (v1)

**Objetivo:** identificar TODA fonte de informação do laudo gratuito v1 pra adaptação pra calc_json v2 (raiz v2 única).

**Princípio:** após adaptação, zero informação pode vir de fora da v2.

**Arquivo analisado:** `laudo-completo.html` (1516 linhas, 95 KB)

---

## ARQUITETURA DE DADOS DO LAUDO V1

**Fonte primária única:** `D` (objeto JS, linha 1409 `let D = {};`)

**Como `D` é populado** (linhas 1458-1512, função `init()`):

| Modo | Origem de `D` | Trigger |
|------|---------------|---------|
| Demo | constante `DEMO_DATA` (hardcoded linhas 1411-1456) | `?demo=true` ou `?id=demo` |
| Produção | `fetch /rest/v1/laudos_completos?slug=eq.<negocio_id>&select=calc_json` (linha 1494) | qualquer outro acesso |

**Resolução de `negocio_id`** (linhas 1473-1488):
1. `?id=<uuid>` → usa direto
2. `?c=<codigo>` → fetch `negocios?slug=eq.<c>` ; se não achar, fetch `negocios?codigo_diagnostico=eq.<c>`
3. Sem id → `showErro()` ("Laudo não encontrado")

**Comentário relevante** (linha 240): `<!-- skill-avaliadora removida — laudo-completo SÓ LÊ calc_json, não calcula -->` — confirmação textual no código de que a v1 lê calc_json pronto, não recalcula no front.

**Retry** (linhas 1492-1508): 3 tentativas com 1.5s de espera entre elas pra dar tempo da skill v1 persistir.

**A divergência R$ 192.113 (v1) vs R$ 3.993.207 (v2) NÃO está em `laudo-completo.html`.** Esse arquivo só lê `D.valor_venda`. A fórmula está em `skill-avaliadora.js` (v1, não auditada neste mapa). O laudo-completo é puro renderizador.

---

## CONSTANTES HARDCODED no topo do script (linhas 755-758)

| # | Constante | Valor | Linha | Risco |
|---|-----------|-------|-------|-------|
| C.1 | `SUPABASE_URL` | `https://dbijmgqlcrgjlcfrastg.supabase.co` | 755 | OK — config |
| C.2 | `SUPABASE_KEY` | anon key (eyJhb…) | 756 | OK — anon key |
| C.3 | `STRIPE_LAUDO` | `https://buy.stripe.com/9B6fZgfpsdJScKJegH5os04` | 757 | OK — link prod |
| C.4 | `WHATSAPP` | `5548999279320` | 758 | ⚠️ telefone hardcoded |
| C.5 | `stripeGuiado` (interna a renderLaudo) | `https://buy.stripe.com/7sYdR8elo21aeSRegH5os02` | 1070 | OK — link prod |
| C.6 | URL "Ver modelo" | `https://1negocio.com.br/modelo-laudo.html` | 1063 | OK — link interno |

---

## SEÇÃO 1 — ICD (Qualidade dos dados)

| # | Elemento | Linha | Origem | Tipo | Path em v2 |
|---|----------|-------|--------|------|------------|
| 1.1 | "Qualidade dos dados" (label) | 259 | hardcoded HTML | TXT | — |
| 1.2 | % ICD na barra | 906 | `D.icd_pct` | DB | `calc_json.icd.pct` (a confirmar) |
| 1.3 | % ICD numérico | 906 | `D.icd_pct` | DB | idem |
| 1.4 | Cor do dot (verde/amber/red) | 907-908 | derivado: `≥70 / ≥50 / <50` | CALC | derivar igual |
| 1.5 | Lista respondidos | 911-947 | `D.icd_respondidos` (array) | DB | `calc_json.icd.respondidos` (?) |
| 1.6 | Lista não respondidos | 912-952 | `D.icd_nao_respondidos` (array) | DB | `calc_json.icd.nao_respondidos` (?) |
| 1.7 | Fallback ICD detalhado | 916-941 | **HARDCODED 21 checks no front**, gera lista verificando flags em `D` | CALC+HARDCODE | mover lista pra parametros_versoes ou eliminar |

**⚠️ HARDCODE PROBLEMÁTICO:** linhas 916-938 contêm 21 nomes de campos ("Faturamento mensal", "Regime tributário", "CMV / Custo de produção", etc.) hardcoded no front. Se mudar o catálogo de campos, precisa editar o HTML.

---

## SEÇÃO 2 — HERO (Nome, data, tags, descrição)

| # | Elemento | Linha | Origem | Tipo | Path em v2 |
|---|----------|-------|--------|------|------------|
| 2.1 | Nome do negócio | 873 | `D.nome` | DB | `calc_json.identificacao.nome` |
| 2.2 | "Avaliado em DD/MM/YYYY" | 874 | `D.data_avaliacao` ou `new Date()` | DB+FALLBACK | `calc_json._data_avaliacao` (já existe em v2) |
| 2.3 | Tag setor | 894 | `D.setor_raw \|\| D.setor` | DB | `calc_json.identificacao.setor.label` |
| 2.4 | Tag local | 895 | `D.cidade + '/' + D.estado` | DB | `calc_json.identificacao.cidade + estado` |
| 2.5 | Tag tempo "X ANOS" | 897-899 | `D.anos` | DB | `calc_json.identificacao.tempo_operacao_anos` |
| 2.6 | Tag regime | 901 | `D.regime` ou fallback "Simples Nacional" | DB+FALLBACK | `calc_json.dre.regime_label` (?) |
| 2.7 | hero-desc (parágrafo descritivo) | 875-893 | **TEMPLATE STRING gigante calculada inline** com 14 vars de `D` | CALC | substituir por `calc_json.textos_ia.texto_contexto_negocio.conteudo` quando existir |

**⚠️ CÁLCULO COMPLEXO INLINE:** linhas 875-892. `descTexto` é uma template string que monta um parágrafo de 100+ palavras combinando: `D.nome`, `D.setor_raw`, `D.cidade`, `D.estado`, `D.anos`, `D.fat_mensal`, `D.ro_mensal`, `D.recorrencia`, `D.clientes`, `D.num_funcs`, `D.regime`, `D.ise_com`, `D.ise_fin`, `D.ise_total`. Substitui a lógica de geração de texto que hoje vive na Edge Function de IA na v2.

---

## SEÇÃO 3 — VALOR DE VENDA (card principal)

| # | Elemento | Linha | Origem | Tipo | Path em v2 |
|---|----------|-------|--------|------|------------|
| 3.1 | "Valor de venda" (label) | 295 | hardcoded HTML | TXT | — |
| 3.2 | Valor R$ X | 955 | `D.valor_venda` (formatado por `fc()`) | DB | `calc_json.valuation.valor_venda` |
| 3.3 | "Porteira fechada — inclui estoque, equipamentos e ponto comercial" | 297 | hardcoded HTML | TXT | — |

---

## SEÇÃO 4 — TERMÔMETRO COMPARATIVO

| # | Elemento | Linha | Origem | Tipo | Path em v2 |
|---|----------|-------|--------|------|------------|
| 4.1 | "Comparativo de valores" (label) | 301 | hardcoded HTML | TXT | — |
| 4.2 | Marker expectativa | 965 | `D.expectativa_val` (escondido se 0) | DB | `calc_json.identificacao.expectativa_valor_dono` (a confirmar — está sem flag origem na v2) |
| 4.3 | Marker 1N | 974 | `D.valor_venda` | DB | `calc_json.valuation.valor_venda` |
| 4.4 | Marker potencial 1Sócio | 975 | calculado: `valor_venda + (ganho_anual × fator)` | CALC | derivar do `calc_json.potencial_12m` (a confirmar) |
| 4.5 | Legenda expectativa | 966 | `D.expectativa_val` | DB | idem 4.2 |
| 4.6 | Legenda 1N | 976 | `D.valor_venda` | DB | idem 4.3 |
| 4.7 | Legenda potencial | 977 | `valorPot` (calc) | CALC | idem 4.4 |
| 4.8 | "Boa notícia/Atenção: X% acima/abaixo" | 984-986 | calc: `(valor_venda - expect) / expect * 100` | CALC | derivar igual |
| 4.9 | "Sua expectativa", "Avaliação 1N", "Potencial 1Sócio" (labels) | 310, 314, 318 | hardcoded HTML | TXT | — |

**Cálculo do potencial 1Sócio** (linhas 866-869):
```js
const totalOps  = n(D.total_ops);
const ganhoMens = totalOps > 0 ? totalOps : Math.round(ro * 0.20);  // fallback: 20% do RO
const ganhoAnual= ganhoMens * 12;
const valorPot  = valorVenda + (ganhoAnual * fator);
```
- Se `D.total_ops` (soma de ganhos dos upsides ativos) > 0: usa
- Senão: chuta `RO × 20%` como ganho mensal

---

## SEÇÃO 5 — BADGES dos blocos

| # | Elemento | Linha | Origem | Tipo |
|---|----------|-------|--------|------|
| 5.1 | Badge RO "R$ X/ano" | 995 | `D.ro_mensal × 12` | CALC |
| 5.2 | Badge PL "R$ X" | 996 | `D.pl` | DB |
| 5.3 | Badge ISE "X/100" | 997 | `D.ise_total` | DB |
| 5.4 | Badge Fator "X.XXx" | 998 | `D.fator` | DB |
| 5.5 | Badge tributário | 1331-1339 | derivado de `D.analise_regimes.economia_mensal` ou "Otimizado" | CALC |

---

## SEÇÃO 6 — DRE (tabela completa, linhas 1081-1122)

| # | Elemento | Linha | Origem | Tipo |
|---|----------|-------|--------|------|
| 6.1 | Faturamento Bruto | 1092 | `D.fat_mensal` | DB |
| 6.2 | Impostos s/ faturamento | 1093 | `D.impostos` | DB |
| 6.3 | Taxas de recebimento | 1094 | `D.taxas` | DB |
| 6.4 | Comissões | 1095 | `D.comissoes` | DB |
| 6.5 | Royalties | 1096 | `D.royalty` | DB |
| 6.6 | Fundo de propaganda | 1097 | `D.mkt_franq` | DB |
| 6.7 | Receita Líquida | 1098-1099 | `D.rec_liq` ou calc subtração | DB+CALC |
| 6.8 | CMV | 1100 | `D.cmv` (com flag `D.dre_estimados.cmv` pra rotular como "estimado") | DB |
| 6.9 | Lucro Bruto | 1101-1102 | `D.lb` ou calc | DB+CALC |
| 6.10 | Folha CLT bruta | 1103 | `D.clt_folha \|\| D.folha` | DB |
| 6.11 | Encargos CLT | 1104 | `D.clt_encargos` | DB |
| 6.12 | Provisões CLT | 1105 | `D.clt_provisoes` | DB |
| 6.13 | Equipe PJ / freela | 1106 | `D.pj_custo` | DB |
| 6.14 | Aluguel | 1107 | `D.aluguel` | DB |
| 6.15 | Facilities | 1108 | `D.facilities` | DB |
| 6.16 | Terceirizados | 1109 | `D.terceirizados` | DB |
| 6.17 | Sistemas | 1110 | `D.sistemas` | DB |
| 6.18 | Outros custos fixos | 1111 | `D.cf` | DB |
| 6.19 | Marketing pago | 1112 | `D.mkt` | DB |
| 6.20 | Resultado Operacional | 1113 | `D.ro_mensal` | DB |
| 6.21 | "Abaixo: informativo, não entra no valuation" (separador) | 1114 | hardcoded HTML | TXT |
| 6.22 | Pró-labore | 1115 | `D.prol` | DB |
| 6.23 | Antecipação de recebíveis | 1116 | `D.antecipacao` | DB |
| 6.24 | Parcelas de dívidas | 1117 | `D.parcelas` | DB |
| 6.25 | Investimentos recorrentes | 1118 | `D.investimentos` | DB |
| 6.26 | Potencial de caixa | 1119 | `D.potencial_caixa` | DB |
| 6.27 | Coluna "%" (vs faturamento) | 1086 | `valor / fat × 100` | CALC |
| 6.28 | Coluna "Anual" | 1089 | `valor × 12` | CALC |

---

## SEÇÃO 7 — BALANÇO PATRIMONIAL (tabela, linhas 1124-1142)

| # | Elemento | Linha | Origem | Tipo |
|---|----------|-------|--------|------|
| 7.1 | Caixa | 1128 | `D.caixa` | DB |
| 7.2 | Contas a receber | 1129 | `D.receber` | DB |
| 7.3 | Estoque | 1130 | `D.estoque` | DB |
| 7.4 | Equipamentos | 1131 | `D.equip` | DB |
| 7.5 | Imóvel (condicional) | 1132 | `D.imovel` (só se > 0) | DB |
| 7.6 | Taxa de franquia (condicional) | 1133 | `D.ativo_franquia` | DB |
| 7.7 | Total Ativos | 1134 | `D.totAtiv` | DB |
| 7.8 | Fornecedores | 1136 | `D.forn` | DB |
| 7.9 | Dívidas/Saldo devedor (condicional) | 1137 | `D.emprest` | DB |
| 7.10 | Total Passivos | 1138 | `D.totPass` | DB |
| 7.11 | Patrimônio Líquido | 1139 | `D.pl` | DB |

---

## SEÇÃO 8 — ISE (Score + 10 pilares, linhas 1144-1174)

| # | Elemento | Linha | Origem | Tipo |
|---|----------|-------|--------|------|
| 8.1 | Score 0-100 | 1155 | `D.ise_total` | DB |
| 8.2 | Cor (verde/amber/red) | 1153 | derivado: `≥70 / ≥50 / <50` | CALC |
| 8.3 | Classe ("Estruturado", "Consolidado", etc.) | 1156 | `D.ise_class` | DB |
| 8.4 | Descrição da classe | 1146-1152, 1154 | **mapa hardcoded inline** com 5 classes e descrições | HARDCODE |
| 8.5 | Pilar Comercial | 1160 | `D.ise_com` | DB |
| 8.6 | Pilar Financeiro | 1160 | `D.ise_fin` | DB |
| 8.7 | Pilar Gestão | 1161 | `D.ise_ges` | DB |
| 8.8 | Pilar Independência | 1161 | `D.ise_dep` | DB |
| 8.9 | Pilar Concentração | 1162 | `D.ise_conc` | DB |
| 8.10 | Pilar Escalabilidade | 1162 | `D.ise_esc` | DB |
| 8.11 | Pilar Balanço | 1163 | `D.ise_bal` | DB |
| 8.12 | Pilar Marca | 1163 | `D.ise_mar` | DB |
| 8.13 | Pilar Dívida | 1164 | `D.ise_div` | DB |
| 8.14 | Pilar Risco | 1165 | `D.ise_ris` | DB |
| 8.15 | Cor de cada pilar (verde ≥7, amber ≥4, red <4) | 1167 | derivado | CALC |

**⚠️ HARDCODE:** mapa de classes em `clsMap` (linhas 1146-1152). Texto descritivo de cada classe vive no front.

**Note:** ISE v1 tem **10 pilares** (com nomes diferentes da v2 que tem 6: P1-P6). Mapeamento v1↔v2 não é 1:1.

---

## SEÇÃO 9 — FATOR (equação visual, linhas 1177-1200)

| # | Elemento | Linha | Origem | Tipo |
|---|----------|-------|--------|------|
| 9.1 | RO Anual | 1190 | `D.ro_mensal × 12` | CALC |
| 9.2 | Fator 1N (×) | 1192 | `D.fator` | DB |
| 9.3 | Patrimônio | 1194 | `D.pl` | DB |
| 9.4 | Valor de Venda | 1196 | `D.valor_venda` | DB |
| 9.5 | Múltiplo base | 1198 | `D.mul_base` ou `D.fator` | DB |
| 9.6 | Modificador setorial | 1198 | `D.mul_mod` | DB |
| 9.7 | Fator ISE | 1198 | `D.mul_ise` | DB |
| 9.8 | Aviso RO negativo | 1180-1187 | hardcoded HTML | TXT |
| 9.9 | Texto explicativo do Fator 1N | 1198 | template inline com 3 vars | CALC |

---

## SEÇÃO 10 — INDICADORES CHAVE (cards, linhas 1202-1278)

Indicadores **sempre exibidos** (ou condicionais):

| # | Indicador | Linha | Origem | Lógica de status |
|---|-----------|-------|--------|------------------|
| 10.1 | Margem Operacional | 1217-1220 | `ro/fat × 100` (calc) | green ≥ `bench.margem_op \|\| 15` ; amber ≥ 8 ; red < 8 |
| 10.2 | Recorrência de receita | 1221-1224 | `D.recorrencia` | green ≥ 50 ; amber ≥ 25 ; red < 25 |
| 10.3 | Concentração de clientes | 1225-1228 | `D.concentracao` | green ≤ 15 ; amber ≤ 30 ; red > 30 |
| 10.4 | Endividamento total | 1229-1232 | `D.emprest` ; calc % de RO anual | green = 0 ; amber se ≤100% RO; red caso contrário |
| 10.5 | Resultado por colaborador (cond.) | 1236-1244 | `D.ro_mensal / D.num_funcs` | green ≥ 1200 ; amber ≥ 600 ; red < 600 |
| 10.6 | Ticket médio mensal (cond.) | 1247-1254 | `D.ticket` (com clientes > 0) | sempre verde |
| 10.7 | CMV sobre faturamento (cond.) | 1257-1265 | `D.cmv / D.fat × 100` | green ≤ `bench.cmv \|\| 40` ; amber até bench×1.15; red |

**⚠️ HARDCODES PROBLEMÁTICOS:**
- Linha 1219: `bench.margem_op || 15` (15% como fallback hardcoded)
- Linha 1241: `1200` e `600` como thresholds de RPC hardcoded
- Linha 1258: `bench.cmv || 40` (40% como fallback)

`D.bench_ind` deveria vir do calc_json mas o front tem fallbacks vazados. Em v2 esses limites devem vir 100% de `parametros_versoes` (já estão lá em `parametros.benchmarks_indicadores` e `benchmarks_dre`).

---

## SEÇÃO 11 — ANÁLISE TRIBUTÁRIA (tabela + nota, linhas 1322-1394)

| # | Elemento | Linha | Origem | Tipo |
|---|----------|-------|--------|------|
| 11.1 | Header da tabela | 1342-1347 | hardcoded HTML | TXT |
| 11.2 | Linhas de regimes (MEI, Simples, Lucro Presumido, Lucro Real) | 1349-1368 | iterar `D.analise_regimes.regimes[]` | DB |
| 11.3 | Rótulo "atual" | 1360 | derivado: regime do row === `D.analise_regimes.regime_atual` | CALC |
| 11.4 | Rótulo "★ ótimo" | 1361 | derivado: regime === `D.analise_regimes.regime_otimo` | CALC |
| 11.5 | Imposto/mês de cada regime | 1364 | `r.imposto_mensal` ; "Inelegível" se `!r.elegivel` | DB |
| 11.6 | % fat | 1365 | `r.pct` | DB |
| 11.7 | Economia/ano | 1357-1366 | calc: `(imposto_atual - imposto_regime) × 12` | CALC |
| 11.8 | Alerta regime atual inelegível | 1376-1383 | condicional + texto template | CALC |
| 11.9 | Nota economia potencial | 1383-1388 | condicional + template | CALC |
| 11.10 | Nota "regime atual é o mais eficiente" | 1390 | hardcoded HTML | TXT |
| 11.11 | "Esta análise é indicativa…" | 1381, 1387 | hardcoded HTML | TXT |

`D.analise_regimes` (objeto inteiro) → mapear pra `calc_json.analise_tributaria` em v2.

---

## SEÇÃO 12 — POTENCIAL 1SÓCIO (KPIs + 3 oportunidades, linhas 391-426)

| # | Elemento | Linha | Origem | Tipo |
|---|----------|-------|--------|------|
| 12.1 | Título "Potencial 1Sócio" | 394 | hardcoded HTML | TXT |
| 12.2 | Subtítulo "Consultoria estratégica…" | 396-398 | hardcoded HTML | TXT |
| 12.3 | "Ganho anual" KPI | 1001 | `'+' + fs(ganhoAnual)` (calc) | CALC |
| 12.4 | "Ganho mensal" sub | 1002 | `'+' + fc(ganhoMens) + '/mês'` | CALC |
| 12.5 | "Valorização 12m" KPI | 1003 | `valorPot - valorVenda` | CALC |
| 12.6 | "% no valor" sub | 1004 | `(valorPot - valorVenda) / valorVenda × 100` | CALC |
| 12.7 | "Investimento A partir de R$ 1.621/mês" | 420 | hardcoded HTML | ⚠️ HARDCODE |
| 12.8 | "+ 20% do ganho mensal adicional" | 421 | hardcoded HTML | TXT |
| 12.9 | Lista 3 oportunidades | 1281-1320 | `D.ops` (array) ou fallback gerado | DB+FALLBACK |
| 12.10 | "+ X ações identificadas" | 1314 | calc: `total - 3` | CALC |
| 12.11 | "+R$ X ganho/ano" | 1315 | calc: `(soma de ganhos dos restantes) × 12` | CALC |

**⚠️ HARDCODE PROBLEMÁTICO:** "R$ 1.621/mês" (linha 420) é valor de investimento estático, não derivado de nada. Deveria vir de `parametros.precos_planos` ou similar.

**⚠️ FALLBACK COM HARDCODE:** linhas 1286-1300. Se `D.ops` vem vazio, o front gera 5 ações hardcoded com cálculos como `Math.round(fat * 0.10)`, `Math.round(ro * 0.20)`, `Math.round(fat * 0.07)`, `Math.round(fat * 0.05)`. Essas heurísticas vivem no código JS, não em `parametros_versoes`. **Em v2 isso deve ser eliminado** — calc_json v2 já tem `upsides.ativos` calculado pela skill.

---

## SEÇÃO 13 — 1N PERFORMANCE / ATRATIVIDADE (linhas 429-486)

| # | Elemento | Linha | Origem | Tipo |
|---|----------|-------|--------|------|
| 13.1 | Título "1N Performance" | 432 | hardcoded HTML | TXT |
| 13.2 | "Plataforma de compra e venda de empresas" | 434-436 | hardcoded HTML | TXT |
| 13.3 | **"2.847 Negócios avaliados"** | 439 | hardcoded HTML | ⚠️ HARDCODE |
| 13.4 | **"R$ 1.2B Volume total"** | 443 | hardcoded HTML | ⚠️ HARDCODE |
| 13.5 | **"1.423 Compradores ativos"** | 447 | hardcoded HTML | ⚠️ HARDCODE |
| 13.6 | "Índice de Atratividade · {nome}" | 455 | nome de `D.nome` (linha 1032) | DB |
| 13.7 | Score atratividade /10 | 1030 | `D.atr_score` | DB |
| 13.8 | Label (Alta/Boa/Moderada/Baixa) | 1029, 1031 | derivado: `≥8 / ≥6.5 / ≥5 / <5` | CALC |
| 13.9 | Barra geral | 1033 | `D.atr_score × 10`% | CALC |
| 13.10 | Pilar ISE — Solidez (17%) | 1036, 1043-1049 | `D.atr_sol` | DB |
| 13.11 | Pilar Setor (17%) | 1037 | `D.atr_set` | DB |
| 13.12 | Pilar Recorrência (17%) | 1038 | `D.atr_rec` | DB |
| 13.13 | Pilar Independência (17%) | 1039 | `D.atr_ind \|\| D.atr_ges` | DB |
| 13.14 | Pilar Crescimento (17%) | 1040 | `D.atr_cre` | DB |
| 13.15 | Pilar Margem vs Benchmark (15%) | 1041 | `D.atr_mar` | DB |
| 13.16 | Comentário inline | 1051 | template com `atrLbl`, `atr`, `ise.total` | CALC |

**⚠️ STATS DA PLATAFORMA HARDCODED** (linhas 439, 443, 447): "2.847 Negócios avaliados", "R$ 1.2B Volume total", "1.423 Compradores ativos". Já catalogado no handoff como pendência ("aba Estatísticas no admin-parametros").

**Pesos dos pilares** (linhas 1036-1041): `17% / 17% / 17% / 17% / 17% / 15%` hardcoded como strings. Deveriam vir de parametros.

---

## SEÇÃO 14 — CTAs PUBLICAR (gratis + guiado, linhas 474-485)

| # | Elemento | Linha | Origem | Tipo |
|---|----------|-------|--------|------|
| 14.1 | "Publicar Gratuitamente" / "R$ 0,00" / "+ 10% taxa de sucesso" | 475-479 | hardcoded HTML | ⚠️ HARDCODE preço/comissão |
| 14.2 | "Publicação Guiada" / "Acompanhamento dedicado" / "R$ 588 + 5% taxa de sucesso" | 480-484 | hardcoded HTML | ⚠️ HARDCODE preço/comissão |

**⚠️ Preços e comissões hardcoded.** Idealmente em parametros: `preco_plano_guiado`, `comissao_gratuito`, `comissao_guiado`.

---

## SEÇÃO 15 — LAUDO PDF BOX (linhas 488-519)

| # | Elemento | Linha | Origem | Tipo |
|---|----------|-------|--------|------|
| 15.1 | Badge "Recomendado" | 489 | hardcoded HTML | TXT |
| 15.2 | Título "Laudo 1Negócio em PDF" | 492 | hardcoded HTML | TXT |
| 15.3 | Descrição | 494-496 | hardcoded HTML | TXT |
| 15.4 | Lista "Laudo principal" (5 itens) | 499-505 | hardcoded HTML | TXT |
| 15.5 | Lista "Anexos exclusivos" (4 itens) | 507-513 | hardcoded HTML | TXT |
| 15.6 | "R$ 99 — Gerar meu laudo" | 517 | hardcoded HTML | ⚠️ HARDCODE preço |
| 15.7 | "Ver modelo" | 516 | hardcoded HTML | TXT |

---

## SEÇÃO 16 — STICKY FOOTER (linhas 523-529)

| # | Elemento | Linha | Origem | Tipo |
|---|----------|-------|--------|------|
| 16.1 | "Laudo Completo em PDF" | 525 | hardcoded HTML | TXT |
| 16.2 | "Ver modelo" | 526 | hardcoded HTML | TXT |
| 16.3 | "R$ 99 — Gerar meu laudo" | 527 | hardcoded HTML | ⚠️ HARDCODE preço |

---

## SEÇÃO 17 — POPUPS

### 17.1 — Popup 1Sócio (linhas 579-612)

| # | Elemento | Linha | Origem | Tipo |
|---|----------|-------|--------|------|
| 17.1.1 | Título "Potencial 1Sócio" | 583 | hardcoded HTML | TXT |
| 17.1.2 | Descrição "Advisory estratégico contínuo…" | 587 | hardcoded HTML | TXT |
| 17.1.3 | "Ganho anual estimado" | 589 | populado por JS: `+fs(ganhoAnual)` | CALC |
| 17.1.4 | "Valorização em 12m" | 590 | populado: `+fs(valorPot - valorVenda)` | CALC |
| 17.1.5 | 5 bullets do plano (Diagnóstico mensal…, Sessão estratégica…, etc.) | 593-597 | hardcoded HTML | TXT |
| 17.1.6 | "Comissão de 5% na venda (vs 10% no plano gratuito)" | 597 | hardcoded HTML | ⚠️ HARDCODE comissões |
| 17.1.7 | "1% da receita" + "20% do ganho mensal adicional" | 602-603 | hardcoded HTML | ⚠️ HARDCODE precificação |
| 17.1.8 | Link WhatsApp | 1057-1058 | `https://wa.me/${WHATSAPP}?text=${msgSocio}` | CALC |
| 17.1.9 | Mensagem WhatsApp pré-preenchida | 1056 | hardcoded inline | TXT |

### 17.2 — Popup Laudo R$99 (linhas 615-645)

| # | Elemento | Linha | Origem | Tipo |
|---|----------|-------|--------|------|
| 17.2.1 | Título "Laudo 1Negócio em PDF" | 619 | hardcoded HTML | TXT |
| 17.2.2 | Descrição "Documento profissional de M&A com 18 páginas…" | 623 | hardcoded HTML | ⚠️ menciona "18 páginas" como número fixo |
| 17.2.3 | 6 bullets | 625-630 | hardcoded HTML | TXT |
| 17.2.4 | "R$ 99" | 635 | hardcoded HTML | ⚠️ HARDCODE preço |
| 17.2.5 | "pagamento único · entregue em segundos" | 636 | hardcoded HTML | TXT |
| 17.2.6 | Botão "Gerar meu laudo — R$ 99" → Stripe | 641 | onclick chama `abrirModalLaudo(stripeUrl)` (linha 1062) | DB+CALC |

### 17.3 — Popup Publicar Grátis (linhas 648-678)

| # | Elemento | Linha | Origem | Tipo |
|---|----------|-------|--------|------|
| 17.3.1 | Descrição | 656 | hardcoded HTML | TXT |
| 17.3.2 | Campo "Código da avaliação" (readonly) | 661 | populado: `negId \|\| D.codigo` (linha 1066) | DB |
| 17.3.3 | Campo "Valor de publicação" | 667 | populado: `Math.round(D.valor_venda)` (linha 1067) | DB |
| 17.3.4 | Indicador dinâmico (✓/◎/⚠/✕) | 668 + 800-834 | calc: `valorPub / D.valor_venda` (4 ranges) | CALC |
| 17.3.5 | "Comissão de 10%" | 671 | hardcoded HTML | ⚠️ HARDCODE comissão |
| 17.3.6 | Botão "Prosseguir para o termo" → `/termo-adesao.html?id=...&valor=...&plano=gratuito` | 674, 836-845 | `irParaTermo()` constrói URL | CALC |

### 17.4 — Popup Guiado R$588 (linhas 681-710)

| # | Elemento | Linha | Origem | Tipo |
|---|----------|-------|--------|------|
| 17.4.1 | "Investimento R$ 588" | 690 | hardcoded HTML | ⚠️ HARDCODE preço |
| 17.4.2 | "Comissão na venda 5%" | 691 | hardcoded HTML | ⚠️ HARDCODE comissão |
| 17.4.3 | "O que acontece a seguir" + texto | 693-696 | hardcoded HTML | TXT |
| 17.4.4 | 4 bullets do plano | 698-701 | hardcoded HTML | TXT |
| 17.4.5 | "Em uma venda de R$500.000, economiza R$25.000" | 703 | hardcoded HTML | ⚠️ EXEMPLO HARDCODE |
| 17.4.6 | "O R$588 se paga 42 vezes" | 703 | hardcoded HTML | ⚠️ derivação hardcoded (25000/588=42.5) |
| 17.4.7 | Botão Stripe Guiado | 706, 1070-1074 | `stripeGuiado + ?client_reference_id=` | CALC |

---

## SEÇÃO 18 — MODAL CONFIRMAÇÃO LAUDO (linhas 716-751)

Modal que abre antes do redirect pro Stripe.

| # | Elemento | Linha | Origem | Tipo |
|---|----------|-------|--------|------|
| 18.1 | Título "Seu laudo está pronto…" | 720 | hardcoded HTML | TXT |
| 18.2 | "Finalize o pagamento via Stripe" | 726 | hardcoded HTML | TXT |
| 18.3 | "R$ 99,00 · pagamento 100% seguro" | 727 | hardcoded HTML | ⚠️ HARDCODE preço |
| 18.4 | "Receba seu laudo completo no WhatsApp" | 733 | hardcoded HTML | TXT |
| 18.5 | "Em até 5 minutos após…" | 734 | hardcoded HTML | TXT |

---

## SEÇÃO 19 — ESTADOS DE ERRO

| # | Elemento | Linha | Origem | Tipo |
|---|----------|-------|--------|------|
| 19.1 | "Laudo não encontrado · Código: X" | 1397-1401 | hardcoded HTML + `c \|\| id` | TXT+CALC |
| 19.2 | "Laudo sendo preparado · Aguarde alguns instantes" | 1402-1406 | hardcoded HTML | TXT |
| 19.3 | "Dados financeiros disponíveis no laudo completo" (DRE vazia) | 1083 | hardcoded HTML | TXT |

---

## SEÇÃO 20 — LOADING SCREEN

| # | Elemento | Linha | Origem | Tipo |
|---|----------|-------|--------|------|
| 20.1 | Logo "1NEGÓCIO" | 246 | hardcoded HTML | TXT |
| 20.2 | "avaliado e vendido." (tagline) | 249 | hardcoded HTML | TXT |
| 20.3 | Mensagens rotativas: "Analisando sua DRE…", "Calculando valuation…", "Verificando ISE…", "Preparando laudo…" | 770 | array hardcoded inline | TXT |

---

## DEMO_DATA HARDCODED INLINE (linhas 1411-1456)

**~46 linhas de dados fictícios completos** ("Restaurante Bella Cucina", Curitiba, R$ 120.000/mês, 8 anos…). Inclui:
- Identificação completa (nome, setor, cidade, etc.)
- DRE inteiro (faturamento, impostos, taxas, CMV, folha, etc.)
- Balanço (ativo, passivo, PL)
- ISE com 10 pilares + classe
- Fator + valuation
- Atratividade com 6 pilares
- 5 oportunidades hardcoded
- Análise tributária inteira (4 regimes)
- Bench DRE + bench indicadores
- Expectativa de valor

**Acionado por:** `?demo=true` ou `?id=demo`

**Pendência catalogada no handoff:** mover DEMO_DATA pra arquivo separado.

---

## ANÁLISE DE DIVERGÊNCIAS CRÍTICAS

### Discrepância de valor v1 vs v2

**Caso real:** Stuido Fit
- v1 calculou: R$ 192.113
- v2 calculou: R$ 3.993.207
- Diferença: ~21×

**laudo-completo.html linha 955:**
```js
set('valor-principal', fc(valorVenda));
// onde valorVenda = n(D.valor_venda) (linha 856)
// e D = laudos_completos.calc_json (linha 1497)
```

**Conclusão:** o laudo v1 só LÊ `D.valor_venda` do calc_json v1 que vive em `laudos_completos`. A fórmula que produz R$ 192.113 NÃO está neste arquivo — está em `skill-avaliadora.js` (skill v1, fora deste mapa). Pra entender a divergência, próximo passo é mapear a skill v1 (não solicitado neste briefing).

---

## INFORMAÇÕES QUE O LAUDO V1 MOSTRA E PODEM NÃO ESTAR NA V2 (gap a discutir)

Comparando com `relatorios/2026-04-29-mapa-calc-json-v2.md` (resumo de memória):

| Campo v1 | Provável path em v2 | Observação |
|----------|--------------------:|------------|
| `D.expectativa_val` | `calc_json.identificacao.expectativa_valor_dono` | Sem flag origem na v2 (handoff) |
| `D.icd_respondidos` (lista) | `calc_json.icd.respondidos` | A confirmar — v2 tem `icd.pct` mas não sei se preserva listas |
| `D.icd_nao_respondidos` (lista) | `calc_json.icd.nao_respondidos` | A confirmar |
| `D.dre_estimados.{cmv,folha,aluguel,outros_cf}` (flags estimado) | `calc_json.dre.estimados.*` (?) | Esses booleanos rotulam linhas como "estimado" no DRE |
| `D.bench_ind.{margem_op,cmv,folha_pct,aluguel_pct,conc_max}` | `calc_json.benchmarks_indicadores` | Pode/deve vir resolvido na skill em vez de propagado pelo calc_json |
| `D.analise_regimes.regimes[]` (4 regimes) | `calc_json.analise_tributaria.regimes` | A confirmar formato exato |
| `D.ops` (10 oportunidades com `ganho`, `ganho_label`, `tipo`) | `calc_json.upsides.ativos` | **Schema diferente** — v2 tem `label`/`descricao` mas não `ganho` em BRL nem `complexidade` (visto na 4.6) |
| `D.total_ops` (soma de ganhos) | derivar de `upsides.ativos[].contribuicao_brl` | **Não existe em v2 hoje** — upsides v2 não têm valor monetário |
| `D.atr_score` + 6 pilares | `calc_json.atratividade.score_geral` + `componentes[]` | Componentes da atratividade v2 organizados diferente (visto no mapa v2) |
| `D.ise_*` (10 pilares) | `calc_json.ise.pilares.{P1..P6}` | **Schema diferente** — v2 tem 6 pilares; v1 tem 10. Mapeamento não-trivial |

**Gap mais crítico para a adaptação:**
- ISE: 10 pilares v1 vs 6 pilares v2
- Upsides: v2 não tem ganho monetário hoje, então o "Potencial 1Sócio" (ganhoAnual, valorPot, KPIs do popup, tudo) precisa de um caminho alternativo

---

## RESUMO ESTATÍSTICO

| Categoria | Contagem aproximada |
|-----------|---------------------|
| Total de elementos mapeados | ~140 |
| Vindos de Supabase (D = laudos_completos.calc_json) | ~75 |
| Calculados no front a partir de D | ~25 |
| Hardcoded HTML (textos, labels, descrições) | ~30 |
| Hardcoded numéricos problemáticos (preços, comissões, stats) | ~12 |
| DEMO_DATA hardcoded inline | 1 bloco com ~50 campos |

---

## ACHADOS CRÍTICOS

### a) Cálculo do valor de venda v1

**Não está em laudo-completo.html.** Esse arquivo só renderiza `D.valor_venda`. A divergência R$ 192k vs R$ 3.99M tem que ser caçada na skill v1 (`skill-avaliadora.js`) — fora do escopo deste mapa.

### b) Hardcodes problemáticos

**Stats da plataforma (linhas 439, 443, 447):**
- "2.847 Negócios avaliados"
- "R$ 1.2B Volume total"
- "1.423 Compradores ativos"

Já catalogado no handoff. Move pra parametros editáveis.

**Preços e comissões espalhados:**
- R$ 99 (laudo PDF) — 5 ocorrências (linhas 517, 527, 635, 641, 727)
- R$ 588 (plano guiado) — 3 ocorrências (linhas 483, 690, 706)
- 10% comissão grátis — 3 ocorrências (linhas 478, 597, 671)
- 5% comissão guiado — 3 ocorrências (linhas 483, 597, 691)
- "1% da receita" (1Sócio) — linha 602
- "20% do ganho mensal adicional" — linhas 421, 603
- "R$ 1.621/mês" investimento 1Sócio — linha 420 (totalmente desconectado)

**Telefone WhatsApp hardcoded** (linha 758): `5548999279320`. Já catalogado no handoff (em 3 telas).

**Exemplo numérico hardcoded** (linha 703): "Em uma venda de R$500.000, economiza R$25.000" — derivação 5%×500k. Se mudar comissão, frase fica errada.

**Heurísticas dos upsides fallback** (linhas 1286-1300): se `D.ops` vazio, gera oportunidades inventando "ganho = fat × 10%", "fat × 7%", "fat × 5%", "ro × 20%". Em v2 isso deve sumir — calc_json v2 já tem `upsides.ativos`.

**Mapa de classes ISE inline** (linhas 1146-1152): textos descritivos das 5 classes ("Estruturado", "Consolidado", etc.) hardcoded no front.

**21 nomes de campos ICD inline** (linhas 916-938): catálogo de campos hardcoded no fallback do ICD detalhado.

### c) Dependências externas

`laudo-completo.html` é **autocontido**. Não importa nenhum `.js` externo. Toda a lógica vive dentro do `<script>` final.

**Fetches externos:**
1. `${SUPABASE_URL}/rest/v1/negocios?slug=eq.<c>&select=id` — resolver código → uuid (linha 1477)
2. `${SUPABASE_URL}/rest/v1/negocios?codigo_diagnostico=eq.<c>&select=id` — fallback (linha 1483)
3. `${SUPABASE_URL}/rest/v1/laudos_completos?slug=eq.<negocio_id>&select=calc_json` — fonte primária (linha 1494)

**Redirects externos:**
1. `https://buy.stripe.com/9B6fZgfpsdJScKJegH5os04` (laudo R$99)
2. `https://buy.stripe.com/7sYdR8elo21aeSRegH5os02` (plano guiado R$588)
3. `https://wa.me/5548999279320?text=...` (1Sócio)
4. `https://1negocio.com.br/modelo-laudo.html` (ver modelo)
5. `/portal-usuario.html?negocio=<id>` (após publicar)
6. `/termo-adesao.html?id=<codigo>&valor=<valor>&plano=gratuito` (após preencher popup grátis)

### d) Gaps em relação a v2

Resumo dos campos do calc_json v1 que ainda não têm equivalente óbvio na v2:

1. **`D.ops[].ganho` em BRL** — upsides v2 hoje não têm `contribuicao_brl`. Sem isso, todos os KPIs do "Potencial 1Sócio" quebram (ganho anual, valorização, %, oportunidades top 3, "+ X ações totalizam +R$ Y").
2. **`D.ise_*` 10 pilares** — v2 tem 6 (P1-P6). Tela v1 mostra 10. Decidir: (a) mapear 10→6 perdendo granularidade, (b) reduzir tela v1 pra mostrar só 6, ou (c) skill v2 expor 10 pilares também.
3. **`D.bench_ind` exposto no calc_json** — em v2 os benchmarks ficam em `parametros_versoes`. Decidir se a tela busca de lá ou se a skill v2 propaga (preferível: skill propaga já resolvido, igual v1 fazia).
4. **`D.expectativa_val`** — v2 ainda não tem flag origem (handoff registrou).
5. **`D.icd_respondidos` / `D.icd_nao_respondidos`** — confirmar se v2 preserva as listas detalhadas.
6. **`D.dre_estimados`** — booleanos por linha do DRE rotulando "estimado". Confirmar shape em v2.

---

*Mapeamento gerado em 29/04/2026. Apenas leitura, zero modificações no laudo-completo.html.*
