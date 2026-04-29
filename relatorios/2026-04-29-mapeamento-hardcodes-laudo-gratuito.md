# Mapeamento de hardcodes — laudo-gratuito.html

**Data:** 2026-04-29
**Branch:** backend-v2
**Tipo:** Investigação somente leitura — `laudo-gratuito.html` não foi alterado
**Schema de referência:** calc_json v2026.07 (spec rev3, decisões #1–#26)

> Este documento é input pra próxima sessão de refactor do `laudo-gratuito.html`.
> O arquivo foi recuperado em commit `2e5facf` (era versão antiga deletada por
> engano em `b62bb16`, vide `relatorios/2026-04-28-handoff-fim-de-sessao.md`).
> Conteúdo atual está em **schema antigo** (categorias produto-style, upsides
> como array, sem `potencial_12m`, sem `recomendacoes_pre_venda`).

---

## 1. Sumário

| Categoria | Quantidade | Severidade |
|---|---|---|
| Textos descritivos hardcoded (placeholder ou fixo) | 18 | Visual |
| Números fixos exibidos (placeholder R$, %, scores) | 19 | Visual |
| Tags placeholders no hero | 4 | Visual |
| Cálculos JS derivando valores que já existem no calc_json | 5 funções | **Lógica** |
| Campos consumidos do schema ANTIGO (não existem em v2026.07) | 8 padrões | **Lógica** |
| Pendências sem correspondência no calc_json | 5 | Decisão |
| Seções/funções INTOCÁVEIS (preservar fluxo) | 7 grupos | Constraint |

**Total:** 46+ pontos de mudança identificados. Esforço estimado de refactor: 4–6h.

---

## 2. Tabela completa de hardcodes

### 2.1 Hero / cabeçalho

| Linha | Conteúdo hardcoded | Campo calc_json (v2026.07) | Observação |
|---|---|---|---|
| 263, 265 | `--icd-pct:78%` / `78%` (ICD bar/value) | `icd.pct` | Já populado por `renderICD` (linha 1132+); placeholder do CSS sobra mas é sobrescrito |
| 280 | `Carregando...` | `identificacao.nome` | Placeholder OK — `renderHero` sobrescreve |
| 281 | `Avaliado em 02/04/2026` | `_data_avaliacao` (formatado `pt-BR`) | Placeholder sobrescrito por `renderHero` linha 1016 |
| 284 | `Alimentacao` | `identificacao.setor.label` | Placeholder sobrescrito por `renderHero` linha 1019 |
| 285 | `Florianopolis/SC` | `identificacao.localizacao.{cidade,estado}` | Placeholder sobrescrito por linha 1020 |
| 286 | `8 anos` | `identificacao.tempo_operacao_anos` | Placeholder sobrescrito por linha 1021 |
| 287 | `Simples Nacional` | `identificacao.regime_tributario_declarado.{label,anexo_simples}` | Placeholder sobrescrito por linhas 1023-1026 |
| 290-292 | `Restaurante consolidado com 8 anos de operacao no centro de Florianopolis. Equipe de 10 colaboradores com processos definidos.` | **Texto fixo!** Não tem fonte | Linha 1028 sobrescreve com placeholder genérico `"Avaliação técnica baseada em DRE..."`. Idealmente Edge Function de IA Fase 4 — `texto_contexto_negocio` |
| 296 | `R$ 1.245.000` (valor-principal) | `valuation.valor_venda` formatado | Placeholder sobrescrito por linha 1032 |
| 297 | `Porteira fechada — inclui estoque, equipamentos e ponto comercial` | **NÃO EXISTE** em calc_json | Tipo de venda: vive em `dossie_json` ou no diagnóstico. Pendência §4 |

### 2.2 Termômetro (comparativo)

| Linha | Conteúdo hardcoded | Campo calc_json | Observação |
|---|---|---|---|
| 304-306 | `left:25%`, `left:55%`, `left:78%` (markers) | calculado em `renderTermometro` | Posições derivadas — placeholder sobrescrito |
| 311 | `R$ 800k` (leg-exp) | `identificacao.expectativa_valor_dono` | Sobrescrito por linha 1069 |
| 315 | `R$ 1.245k` (leg-1n) | `valuation.valor_venda` | Sobrescrito por linha 1075 |
| 319 | `R$ 1.580k` (leg-pot) | **`potencial_12m.potencial_final.valor_projetado_brl`** | ⚠ Hoje vem de `valor_1n × 1.40` hardcoded (linha 1054). Schema v2026.07 expõe valor real |
| 325 | `Boa noticia: sua avaliacao ficou 55% acima da sua expectativa inicial.` | **Sem fonte direta** | Texto FIXO. `renderTermometro` (linhas 1078-1100) só sobrescreve em condições específicas; senão o fixo persiste. **Inconsistência.** |

### 2.3 Badges dos blocos colapsáveis

| Linha | Conteúdo hardcoded | Campo calc_json | Observação |
|---|---|---|---|
| 332 | `R$ 273.600/ano` (badge-ro) | `dre.ro_anual` | Hoje `renderHero` linha 1040 mostra `ro_mensal/mês` (não anual!) — divergência com placeholder |
| 343 | `R$ 185.000` (badge-pl) | `balanco.patrimonio_liquido` | Sobrescrito linha 1041 |
| 354 | `72/100` (badge-ise) | `ise.ise_total` + `ise.classe` | Sobrescrito linha 1042 (`72 · Consolidado`) |
| 365 | `Fator 4.02x` (badge-fator) | `valuation.fator_final` | Sobrescrito linha 1043 |
| 384 | `—` (badge-trib) | `analise_tributaria.regime_declarado` UPPER | Sobrescrito linha 1044 |

### 2.4 Caixa Consultoria ("1Sócio" → renomear "1N Consultoria")

| Linha | Conteúdo hardcoded | Campo calc_json | Observação |
|---|---|---|---|
| 391-394 | Header `1S` + `Potencial 1Socio` | — | **Renomear pra "1N Consultoria"** (briefing) |
| 397 | `Consultoria estrategica para abordar as oportunidades identificadas...` | **Texto fixo** | Manter ou Fase 4 IA |
| 402 | `+R$ 150k` (socio-anual) | derivado em `renderSocio` linha 1487 | ⚠ Cálculo via schema antigo (`upsides.filter(estrategico+transformacional, free)`) — em v2026.07 deve usar `potencial_12m.potencial_final.brl` |
| 403 | `+R$ 12.500/mes` (socio-mensal) | ganho_mensal_caixa derivado | idem |
| 407 | `+R$ 335k` (socio-valorizacao) | `potencial_12m.potencial_final.valor_projetado_brl - valuation.valor_venda` (delta) | hoje calcula como `valor_venda × ganho_total_pct/100` — schema antigo |
| 408 | `+27% no valor` (socio-pct) | `potencial_12m.potencial_final.pct × 100` | hoje `ganho_total_pct.toFixed(0) + '%'` — schema antigo |
| 420 | `A partir de R$ 1.621/mes` | **Hardcode comercial** | Não vem do calc_json. Texto de produto fixo |
| 421 | `+ 20% do ganho mensal adicional` | **Hardcode comercial** | Texto de produto fixo |

### 2.5 Caixa Performance 1N (estatística da plataforma)

| Linha | Conteúdo hardcoded | Fonte sugerida | Observação |
|---|---|---|---|
| 439 | `2.847` (Negócios avaliados) | **Fora do calc_json** — agregado da plataforma | Pendência §4 |
| 443 | `R$ 1.2B` (Volume total) | **Fora do calc_json** | Pendência §4 |
| 447 | `1.423` (Compradores ativos) | **Fora do calc_json** | Pendência §4 |

### 2.6 Atratividade (dentro de Performance 1N)

| Linha | Conteúdo hardcoded | Campo calc_json | Observação |
|---|---|---|---|
| 457 | `7.8` (atrativ-val) | `atratividade.total / 10` | `renderAtratividade` linha 1426: `set('atrativ-val', String(at.total \|\| 0))` mostra `total` cru (0-100), não `/10`. **Divergência: placeholder mostra 7.8/10 mas código mostra 77/10** |
| 459 | `Alta` (atrativ-label) | `atratividade.label` | OK |
| 1450-1454 | 4 frases fixas em `renderAtratividade` (`if (at.total >= 80) ...`) | **Texto fixo** prescritivo | Mesmo padrão deletado no laudo-pago em 29/04 (commit `172919f`). **Aplicar mesma deleção aqui.** Edge Function IA Fase 4 |

### 2.7 CTAs e popups (manter — ver §5)

| Linha | Conteúdo hardcoded | Status |
|---|---|---|
| 478 | `+ 10% taxa de sucesso` | Texto comercial fixo. **Manter** |
| 483 | `R$ 588 + 5% taxa de sucesso` | Texto comercial fixo. **Manter** |
| 517 | `R$ 99 — Gerar meu laudo` | Texto comercial fixo. **Manter** |
| 527 | `R$ 99 — Gerar meu laudo` (sticky footer) | **Manter** |
| 627 | `ISE com análise de todos os 10 pilares` | ⚠ **ERRO factual:** ISE tem 8 pilares (Decisão #13 da rev3). Corrigir pra "8 pilares" |
| 635, 690 | `R$ 99` / `R$ 588` | Preços fixos. **Manter** |
| 703 | `Em uma venda de R$500.000, economiza R$25.000` | Exemplo numérico fixo. **Manter** (parte do produto) |

---

## 3. Lógica de cálculo em JavaScript a remover/adaptar

### 3.1 `renderTermometro` (linha 1048) — 1 cálculo errado

**Linha 1054:** `const valor_pot = valor_1n * 1.40;`

Cálculo derivado: assume que potencial é sempre 40% acima do valor_venda. **Errado em v2026.07.**

**Substituir por:**
```js
const p12 = (calcJson.potencial_12m && calcJson.potencial_12m.potencial_final) || {};
const valor_pot = n(p12.valor_projetado_brl) || valor_1n;
```

(mesmo padrão do laudo-pago commit `e2e94a0`).

**Linhas 1078-1100:** condicionais if/else montando texto da nota termômetro com 5 frases fixas:
- `'Resultado operacional negativo — venda recomendada após reestruturação.'`
- `'Sua expectativa está acima do que o mercado pagaria neste momento.'`
- `'Sua expectativa está abaixo do valor técnico calculado.'`
- `'Há potencial de aumentar o valor com as melhorias sugeridas.'`

**Decisão:** manter por ora (sem Edge Function IA ainda). Confirmar em refactor que o texto fixo da linha 325 (`Boa noticia: sua avaliacao ficou 55% acima...`) é sobrescrito em todos os casos.

### 3.2 `renderSocio` (linha 1462) — schema antigo completo

Lê `calcJson.upsides.filter(u => (u.categoria === 'estrategico' || u.categoria === 'transformacional') && u.acesso === 'free')`. **3 problemas:**

1. `calcJson.upsides` agora é objeto `{ ativos[], paywalls[] }` — `.filter` em objeto joga TypeError (mesmo bug que estava no laudo-pago, corrigido em `3ccdf8b`)
2. Categorias `'estrategico'`, `'transformacional'` não existem mais (categorias técnicas: `ro/passivo/multiplo/qualitativo/paywall`)
3. Campo `u.acesso` ('free'/'pago') não existe mais (substituído por separação `ativos` vs `paywalls`)

E todo o cálculo `ganho_total_pct = sum(impacto_no_valuation.{min_pct,max_pct})/2` já é coberto por `potencial_12m.potencial_final.pct` (com 3 caps aplicados).

**Substituir por:**
```js
function renderSocio() {
  const p12 = (calcJson.potencial_12m && calcJson.potencial_12m.potencial_final) || {};
  const v = calcJson.valuation || {};
  const ganho_avaliacao = n(p12.brl);  // delta absoluto
  const valor_projetado = n(p12.valor_projetado_brl);
  const ganho_pct = n(p12.pct) * 100;
  // Ganho em CAIXA não vem direto — vem do tributário separado + futuramente Caminho A breakdown
  const trib = (calcJson.potencial_12m.agregacao || {}).tributario || {};
  const ganho_anual_caixa = n(trib.brl);  // só economia tributária por enquanto
  const ganho_mensal_caixa = ganho_anual_caixa / 12;
  // ...
}
```

⚠ **Caveat:** "ganho em caixa" no schema atual é só o tributário (sem ganhos operacionais detalhados). Pra exibir ganho mensal/anual completo, depende do **Caminho A** (`relatorios/2026-04-29-pendencia-breakdown-upsides.md`).

### 3.3 `renderTributario` (linha 1498) — frases prescritivas

Linhas 1517, 1521 renderizam:
- `eco.observacao` ("Negócio já está no regime ótimo")
- `at.fator_r_observacao` (Sua atividade Fator R...)

Mesmas frases deletadas no laudo-pago em 29/04 (commit `42bc9cc`/`feecd18`/`f9c3109`). **Aplicar mesma deleção aqui.**

Plus: linha 1510 mostra `"Regime ótimo identificado"` — Decisão de copy aplicada no laudo-pago: **"ótimo" → "ideal"** (commit `0a15c03`).

### 3.4 `renderOport` (linha 1527) — schema antigo total

Lê `calcJson.upsides` como array. `u.acesso === 'pago'` pra paywall. Categorias produto-style. Tudo schema antigo.

**Refactor completo igual ao do laudo-pago commit `3ccdf8b`** — adaptado pra contexto gratuito:
- Bloquear paywalls com texto `"Liberar com laudo R$99"` (Decisão #26 — laudo-gratuito mantém paywalls bloqueados, não revelados como no laudo-pago)
- Usar categorias técnicas e `CATEGORIA_LABEL` (mesmo do laudo-pago)
- Cards mostram R$ no destaque (Decisão #26 inviolável)
- Ordem por R$ desc nos monetários

### 3.5 `renderICD` (linha 1132) — `CAMPOS_ICD` stale

A constante `CAMPOS_ICD` (linhas 1133-1156) hardcoda 22 campos com labels — replicação do que `calcICDv2` já produz no calc_json (`icd.respondidos[]`, `icd.nao_respondidos[]`, `icd.benchmarks[]` com `{id, label, critico}`).

**Substituir por** consumo direto de `calcJson.icd.{respondidos, nao_respondidos, benchmarks, total, pct}` — mesmo padrão do laudo-admin §3.

Bonus: linha 1154 `reputacao_online` é label antigo. v2026.07 usa `reputacao` (Decisão #22 / SUBMET_ORIGEM_MAP). Não afeta render porque vem do calc_json novo, mas alinhar a constante.

---

## 4. Pendências — campos sem correspondência no calc_json atual

| # | Item | Onde aparece | Decisão pendente |
|---|---|---|---|
| 1 | Tipo de venda ("Porteira fechada / não inclui ponto comercial / etc") | linha 297 — sub do valor principal | Vive em `dossie_json` ou diagnóstico. **Decidir:** expor em `identificacao.tipo_venda` ou ler de fonte alternativa? |
| 2 | Estatística agregada da plataforma (2.847 negócios, R$ 1.2B, 1.423 compradores) | linhas 439-447 — caixa Performance 1N | **Decidir:** endpoint `/rest/v1/estatisticas` ou hardcode atualizado periodicamente? Não cabe no calc_json (não é dado do negócio) |
| 3 | Texto contextual do hero (`"Restaurante consolidado..."` linha 290) | linha 290-292 (placeholder) e 1028 (sobrescrita genérica) | **Decidir:** Edge Function IA `texto_contexto_negocio` (Fase 4)? Hoje é genérico |
| 4 | Comentário contextual da nota termômetro | linhas 1078-1100 (5 frases fixas) | **Decidir:** manter como está até Fase 4, ou deletar como fizemos no laudo-pago? |
| 5 | Cálculo de "ganho mensal/anual em caixa" detalhado por upside | linhas 1487-1488 da `renderSocio` | **Caminho A** documentado em `relatorios/2026-04-29-pendencia-breakdown-upsides.md` (4.5–5.5h, atacar pós-Fase 3) |

---

## 5. INTOCÁVEIS — preservar fluxo (do briefing REQ-2)

Itens que **NÃO devem ser tocados** em estrutura/lógica/texto durante o refactor — apenas adaptar consumo do calc_json onde necessário, mantendo a UX:

### 5.1 CTAs principais (linhas 474-485)

```html
<a class="cta-pub gratis" onclick="abrirPopup('gratis')">Publicar Gratuitamente</a>
<a class="cta-pub guiado" onclick="abrirPopup('guiado')">Publicação Guiada</a>
```

### 5.2 Caixa Consultoria (linhas 391-427)

Estrutura inteira preservada. **Único ajuste:** rename de marca "1Sócio" → "1N Consultoria" (briefing). Linhas afetadas: 393 (`socio-icon: "1S"`), 394 (`socio-title: "Potencial 1Socio"`), 583 (popup `"Potencial 1Sócio"`), 589 (popup-kpi-lbl `"Ganho anual estimado"`).

Cor roxa (`var(--pu)`) preservada.

### 5.3 Caixa Laudo R$99 (linhas 488-519)

Estrutura de cards, listas, CTAs `"Ver modelo"` e `"R$ 99 — Gerar meu laudo"` mantidos.

**Único ajuste de erro factual:** linha 627 `"ISE com análise de todos os 10 pilares"` → `"8 pilares"` (Decisão #13).

### 5.4 Sticky footer (linhas 523-529)

```html
<div class="sticky-footer">
  <button class="footer-btn modelo">Ver modelo</button>
  <button class="footer-btn comprar">R$ 99 — Gerar meu laudo</button>
</div>
```

### 5.5 Popups completos (linhas 578-740)

- **POPUP 1SÓCIO** (578-612) — só rename pra "1N Consultoria"
- **POPUP LAUDO R$99** (614-645) — preservar
- **POPUP PUBLICAR GRÁTIS** (647-678) — preservar form `pub-codigo` + `pub-valor`, atualização indicador, `irParaTermo()` que redireciona pra `/termo-adesao.html?id=X&plano=gratuito`
- **POPUP GUIADO R$588** (680-710) — preservar Stripe `gg-btn-contratar`
- **MODAL CONFIRMAÇÃO STRIPE** (716+) — preservar overlay e `window._stripeUrlPendente`

### 5.6 Funções JavaScript de fluxo

```
abrirPopup, fecharPopup, irParaTermo,
window._stripeUrlPendente, STRIPE_LAUDO,
renderPopupPublicacao  (linhas 1409-1417)
```

### 5.7 Patterns de redirect/link

- `/termo-adesao.html?id=X&valor=Y&plano=gratuito` — fluxo pós "publicar grátis"
- URLs de Stripe — checkout pago

---

## 6. REQ-1 — números esperados pra Forste demo (validação pós-refactor)

Após refactor, abrir `laudo-gratuito.html?demo=true` (com `DEMO_DATA` regenerado pelo fixture, padrão laudo-admin/laudo-pago) e validar visualmente:

| Campo no laudo | Valor esperado | Origem calc_json |
|---|---|---|
| Hero — valor de venda | **R$ 631.976** | `valuation.valor_venda` |
| Termômetro — Avaliação 1N | R$ 631k (`fs()`) | `valuation.valor_venda` |
| Termômetro — Potencial | **R$ 791k** (era R$ 631×1.40 hoje) | `potencial_12m.potencial_final.valor_projetado_brl` |
| Termômetro — Sua expectativa | R$ 600k | `identificacao.expectativa_valor_dono` (Forste) |
| Badge ISE | **84 · Consolidado** | `ise.ise_total` (84.1) + `ise.classe` |
| Badge Fator | **× 2.44** | `valuation.fator_final` (2.438) |
| Badge RO | R$ 21.510/mês | `dre.ro_mensal` |
| Badge PL | R$ 2.679 | `balanco.patrimonio_liquido` |
| ICD pct | 100% (Forste tem todos os campos) | `icd.pct` |
| Atratividade total | **77** (aparece como `77` raw, não `7.8/10`) | `atratividade.total` — placeholder visual da linha 457 está errado |
| Atratividade label | Atrativa | `atratividade.label` |
| Atratividade componentes | ISE 8.4 (50%) · Setor 9 (25%) · Crescimento 5 (25%) | `atratividade.componentes[]` |
| Caixa 1N Consultoria — Ganho anual | depende do Caminho A | hoje `renderSocio` calcula errado |
| Caixa 1N Consultoria — Valorização 12m | **R$ 159.466** (delta) | `potencial_12m.potencial_final.brl` |
| Caixa 1N Consultoria — % no valor | **+25%** | `potencial_12m.potencial_final.pct × 100` |
| Tributário — Regime ideal | Simples Nacional · Anexo III (já no ideal) | `analise_tributaria.regime_otimo_calculado` + observação |
| Identificação tags | servicos_empresas / Florianópolis-SC / 7 anos / Simples III | `identificacao.{setor, localizacao, tempo_operacao_anos, regime_tributario_declarado}` |

> **Nota sobre `setor.label`:** Forste atual tem `setor.label === "servicos_empresas"` (label cru, não humano).
> O briefing menciona "Serviços B2B" como esperado — esse é o label humano que poderia vir
> via `parametros_versoes.multiplos_setor[code].label` se a skill mapeasse. Hoje a skill emite `label = code`. Pendência menor.

---

## 7. Lógica de cálculo a remover/substituir (resumo)

| Função | Linha | O que faz hoje (errado) | O que deve fazer (v2026.07) |
|---|---|---|---|
| `renderTermometro` | 1054 | `valor_pot = valor_1n * 1.40` | ler `potencial_12m.potencial_final.valor_projetado_brl` |
| `renderSocio` | 1462-1495 | filtra `upsides` array antigo + soma `impacto_no_valuation.{min,max}` / 2 | ler `potencial_12m.potencial_final.{brl, pct, valor_projetado_brl}` |
| `renderOport` | 1527-1575 | filtra `upsides` array antigo, decide paywall por `u.acesso === 'pago'` | iterar `upsides.ativos[]` + `upsides.paywalls[]` separados, categorias técnicas, R$ no card (Decisão #26) |
| `renderTributario` | 1498-1525 | renderiza `eco.observacao` + `at.fator_r_observacao` | deletar essas duas frases (já feito no laudo-pago) + renomear "ótimo" → "ideal" |
| `renderAtratividade` | 1422-1457 | 4 frases prescritivas hardcoded em if/else | deletar (igual laudo-pago commit `172919f`) |
| `renderHero` | 1040 | mostra `ro_mensal` mas placeholder linha 332 diz `ro_anual` | decidir: mostrar mensal+sub `/ano` ou só anual (alinhar com decisão A1 do laudo-pago) |
| `renderICD` | 1132-1207 | hardcode `CAMPOS_ICD` com 22 entries | consumir `calcJson.icd.{respondidos, nao_respondidos, benchmarks}` direto |

---

## 8. Recomendação de ordem de execução pro refactor

**Sequência sugerida (modo cruzeiro, ~4-6h total):**

1. **(P) Recuperar consistência básica do hero** — `renderHero` linha 1040 alinhar com decisão A1 do laudo-pago (commit `3207fad`): tirar `/ano` ou padronizar.
2. **(P) Atualizar `renderTermometro`** — substituir `valor_1n * 1.40` por `potencial_12m.potencial_final.valor_projetado_brl` (mesmo fix do commit `e2e94a0`).
3. **(P) Atualizar `renderTributario`** — deletar as 2 frases prescritivas + "ótimo" → "ideal" (mesmos commits `feecd18` + `f9c3109` + `0a15c03`).
4. **(P) Deletar frases prescritivas em `renderAtratividade`** — bloco linhas 1450-1454 (mesmo commit `172919f`).
5. **(P) Corrigir erro factual** linha 627 `"10 pilares"` → `"8 pilares"`.
6. **(P) Renomear marca** `1Sócio` → `1N Consultoria` em 6+ ocorrências (HTML labels, popup, comentários).
7. **(M) Atualizar `renderICD`** — eliminar `CAMPOS_ICD` hardcoded, consumir `calcJson.icd` direto.
8. **(G) REVAMP `renderOport`** — schema novo `{ ativos, paywalls }`, categorias técnicas, R$ no card (Decisão #26), ordem por R$ desc, **paywalls bloqueados** com texto `"Liberar com laudo R$99"` (diferença em relação ao laudo-pago que revela paywalls).
9. **(G) REVAMP `renderSocio`** — substituir cálculo upsides antigo por `potencial_12m.potencial_final`. ⚠ Limitação: ganho mensal/anual em caixa fica parcial (só tributário) até o Caminho A ser implementado.
10. **(P) Regenerar `DEMO_DATA`** via `/tmp/gen-demo-data.js` (padrão laudo-admin/laudo-pago).
11. **(P) Atualizar 2 comentários internos** linhas 755, 760 que ainda mencionam `laudo-completo.html`.
12. **(validação)** Abrir `laudo-gratuito.html?demo=true` e conferir REQ-1 §6 — confirmar números do Forste sintético.

---

## 9. Próximo passo

**Aguardando direção do user pra iniciar refactor.**

Pendências bloqueantes pra decisão antes do refactor:
- Pendência §4 #1 (Tipo de venda — fonte alternativa?)
- Pendência §4 #2 (Estatística da plataforma — endpoint ou hardcode atualizável?)
- Pendência §4 #3 (Texto hero contextual — manter genérico até IA Fase 4?)
- Pendência §4 #4 (Nota termômetro contextual — manter ou deletar?)

Pendência arquitetural não-bloqueante:
- Pendência §4 #5 (Caminho A — `valor_atual_brl/economia_mensal_brl/etc` por categoria) — refactor da skill, atacar pós-Fase 3.
