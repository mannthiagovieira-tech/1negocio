# Mapeamento — laudo-pago.html × schema novo (v2026.07)

Data: 2026-04-28 · Branch: `backend-v2`
Arquivos analisados: `laudo-pago.html` (1.613 linhas) e `laudo-completo.html` (1.602 linhas)
Schema de referência: calc_json produzido pela skill atual via `montarCalcJsonV2`
(20 top-level keys — vide §2 do mapeamento do laudo-admin)

> **Etapa 1 — somente leitura.** Nenhum código alterado. Documento serve de input
> pra decisão visual e priorização da Etapa 2 (implementação).

---

## 1. Identificação do arquivo ativo

Dois arquivos relevantes em `~/1negocio/`:

| arquivo | tamanho | última modificação | observação |
|---|---|---|---|
| **laudo-pago.html** | 107 KB · 1.613 linhas | 2026-04-28 08:57 | **Ativo** — modificado hoje, foco no comprador |
| `laudo-completo.html` | 87 KB · 1.602 linhas | 2026-04-27 20:47 | Antigo — vai virar `laudo-pago.html` (Decisão #11 do handoff) |

Decisão #11 (renomear) **já foi aplicada na prática**: `laudo-pago.html` existe e é o arquivo trabalhado. `laudo-completo.html` permanece como artefato pré-rename. **Tratar `laudo-pago.html` como o arquivo soberano.**

> **Recomendação operacional**: deletar `laudo-completo.html` em commit dedicado quando
> `laudo-pago.html` estiver consolidado, evitando confusão. Não nesta etapa.

## 2. Estrutura atual do laudo-pago.html

### 2.1 — Seções e ordem de render

Função `renderTudo()` (linha 669) compõe o documento na ordem:

| ordem | função | linha | seção |
|---|---|---|---|
| 1 | `renderCapa()` | 702 | Capa do laudo |
| 2 | `renderFolhaRosto()` | 727 | Folha de rosto + metodologia |
| 3 | `renderIndice()` | 754 | Índice navegável |
| 4 | `renderHeroResumo()` | 792 | **Sec 1** — Resumo executivo (2 KPIs + chart progressão + texto IA) |
| 5 | `renderTextoIA('2', 'Contexto', ..., 'texto_contexto_negocio')` | 877 | **Sec 2** — Contexto do negócio |
| 6 | `renderDRE()` | 1055 | **Sec 3** — DRE em blocos |
| 7 | `renderBalanco()` | 1165 | **Sec 4** — Balanço Patrimonial |
| 8 | `renderISE()` | 1238 | **Sec 5** — ISE (8 pilares) |
| 9 | `renderIndicadores()` | 1301 | **Sec 6** — Indicadores vs Benchmark |
| 10 | `renderTributaria()` | 1363 | **Sec 7** — Análise tributária |
| 11 | `renderTextoIA('8', 'Parecer técnico', ...)` | — | **Sec 8** — Parecer técnico (IA) |
| 12 | `renderTextoIA('9', 'Riscos', ...)` | — | **Sec 9** — Riscos e atenções (IA) |
| 13 | `renderTextoIA('10', 'Diferenciais', ...)` | — | **Sec 10** — Diferenciais (IA) |
| 14 | `renderAtratividade()` | 1438 | **Sec 11** — Atratividade |
| 15 | `renderTextoIA('12', 'Público-alvo', ...)` | — | **Sec 12** — Público-alvo comprador (IA) |
| 16 | `renderUpsides()` | 1485 | **Sec 13** — Oportunidades de melhoria |
| 17 | `renderOperacional()` | 1564 | **Sec 14** — Operacional |
| 18 | `renderFechamento()` | 1597 | Sec 15 — Fechamento |

**Total: 15 seções renderizadas + capa + folha + índice + fechamento.**

Notavelmente **AUSENTES** (comparação com laudo-admin):
- ❌ Seção dedicada de Valuation (valor de venda + múltiplos): valuation está **inline em renderHeroResumo** — só 2 KPIs (`avaliacao` + `potencial 12m`).
- ❌ Seção POTENCIAL 12M agregada (Valor Hoje / Potencial / Projetado) — inexistente.
- ❌ Seção INPUTS-ORIGEM, ICD, JSON BRUTO, METADATA — corretamente excluídas (admin-only).
- ❌ Seção TEXTOS IA (admin-only com debug) — substituída por chamadas de `renderTextoIA` integradas.

### 2.2 — Campos do calc_json consumidos (cruzamento com schema atual)

Recuperado via grep `calcJson.X.Y`:

| campo | usado em | presente no schema atual? |
|---|---|---|
| `_versao_calc_json` | renderFolhaRosto, renderFechamento | ✓ |
| `_versao_parametros` | renderFolhaRosto (fallback `'v2026.04'`) | ✓ |
| `_skill_versao` | renderFolhaRosto (fallback `'2.0'`) | ✓ |
| `identificacao.{nome, setor, ...}` | renderCapa, renderFolhaRosto, renderHeroResumo | ✓ |
| `valuation.valor_venda` | renderHeroResumo | ✓ |
| **`valuation.valor_potencial_12m`** | renderHeroResumo (linha 797) | **✗ — schema antigo. Hoje vem em `potencial_12m.potencial_final.valor_projetado_brl`** |
| `textos_ia.texto_resumo_executivo_completo` | renderHeroResumo | ✓ (placeholder) |
| `textos_ia.texto_contexto_negocio` | renderTextoIA('2') | ✓ (placeholder) |
| `textos_ia.texto_parecer_tecnico` | renderTextoIA('8') | ✓ (placeholder) |
| `textos_ia.texto_riscos_atencao` | renderTextoIA('9') | ✓ (placeholder) |
| `textos_ia.texto_diferenciais` | renderTextoIA('10') | ✓ (placeholder) |
| `textos_ia.texto_publico_alvo_comprador` | renderTextoIA('12') | ✓ (placeholder) |
| `textos_ia.descricoes_polidas_upsides[]` | renderUpsides | **✗ — schema antigo. Não vem mais (textos polidos viriam de Edge Function ainda não implementada — Fase 4)** |
| `dre.{...}` | renderDRE | ✓ |
| `balanco.{...}` | renderBalanco | ✓ |
| `ise.{ise_total, classe, fator_classe, pilares}` | renderISE | ✓ |
| `indicadores_vs_benchmark` | renderIndicadores, renderDRE | ✓ |
| `analise_tributaria.{...}` | renderTributaria | ✓ |
| `atratividade.{total, label, componentes}` | renderAtratividade | ✓ |
| **`upsides`** (assume array) | renderUpsides linha 1486 | **✗ — schema mudou pra `{ ativos, paywalls }`. Filter quebra com TypeError.** |
| `operacional.{...}` | renderOperacional | ✓ |

### 2.3 — Bugs latentes (mesmo problemas do laudo-admin antigo)

| linha | bug | severidade |
|---|---|---|
| 1486 | `(calcJson.upsides \|\| []).filter(...)` — `forEach`/`filter` num objeto `{ ativos, paywalls }` joga TypeError. **Crash da seção.** | **Crítico** |
| 1497-1498 | Contador por categorias antigas (`obrigatorio`/`ganho_rapido`/`estrategico`/`transformacional`) — não existem mais; sumário fica zerado. | **Médio** (UX, não crash) |
| 1509-1521 | Cards consomem campos antigos: `u.titulo`, `u.subtitulo`, `u.descricao_curta`, `u.impacto_no_valuation`, `u.ordem_no_laudo`, `u.complexidade`, `u.tempo_estimado`, `u.exige_apoio`, `u.cta_consultoria`, `u.label_visivel`, `u.tipo`. | **Crítico** (cards renderizam vazio/quebrado) |
| 797 | `valuation.valor_potencial_12m` — campo morto. Renderização do "Potencial em 12 meses" cai em fallback `avaliacao` → barra de progressão fica chapada. | **Médio** (UX degradada) |
| 1492 | `textos_ia.descricoes_polidas_upsides` — sempre `[]` no schema atual; descrições polidas IA não chegam. Cards usam fallback de descrição. | **Baixo** (esperado até Fase 4) |

---

## 3. Comparação com laudo-admin (refatorado)

| seção | laudo-admin (após refactor) | laudo-pago hoje | decisão |
|---|---|---|---|
| Capa + folha + índice | — (admin não tem) | ✓ presente | **Manter** (UX comprador) |
| Hero / Resumo executivo | METADATA + IDENTIFICAÇÃO técnica | renderHeroResumo (2 KPIs + chart + texto IA) | **Recortar do admin** (reaproveita `valor_venda`; adiciona `potencial_12m.potencial_final.valor_projetado_brl`) |
| Inputs-Origem / ICD | ✓ | ❌ | **Não trazer** (admin-only) |
| DRE | ✓ completo + observações + JSON debug | ✓ completo, sem JSON debug | **Reaproveitar dados, recortar JSON debug** |
| Balanço | ✓ completo | ✓ completo | **Reaproveitar; só corrigir alinhamento (T3 do laudo-admin)** |
| ISE | ✓ completo + indicador de origem por sub-métrica | ✓ completo, sem indicador origem | **Reaproveitar; remover SUBMET_ORIGEM_MAP UI no laudo-pago** |
| Valuation | seção dedicada | inline em hero | **Manter inline** (UX limpa) |
| Atratividade | ✓ com fonte_crescimento + metadata | ✓ provavelmente schema antigo (validar) | **ADAPT** (mesmas strings 'historico_real'/'sem_resposta') |
| Análise tributária | ✓ completo (4 regimes) | ✓ presente | **Reaproveitar** (schema 1:1 com skill) |
| Upsides | REVAMP completo `{ ativos, paywalls }` + categorias técnicas + R$ por card | array + categorias antigas + impacto_no_valuation | **REVAMP CRÍTICO** — o mesmo já feito no laudo-admin, com adaptação UX comprador |
| **POTENCIAL 12M** | seção dedicada (3 cards humanos + colapsável) | ❌ inexistente | **Não criar como seção separada** — info já no hero. Cards individuais de upside cobrem o detalhamento (ver requisito inviolável §4) |
| **Recomendações pré-venda** | sub-bloco em UPSIDES | ❌ inexistente | **CRIAR** — sub-bloco "Qualitativos / Pré-venda" ou seção própria |
| Operacional | ✓ | ✓ | **Reaproveitar** |
| Indicadores vs benchmark | ✓ + barras + fundo + implicações | ✓ presente | **Reaproveitar UX completo** (T2.1-2.4 do laudo-admin) |
| Textos IA integrados | placeholder visível | placeholder visível com `[Texto pendente]` | **Reaproveitar** (sem mudança até Fase 4) |
| Tag de status do negócio | ✓ pill no header | ❌ | **Não trazer** (admin-only — laudo-pago é snapshot do laudo, não estado vivo) |
| JSON bruto | ✓ debug | ❌ | **Não trazer** (admin-only) |
| Toggle dark/light | ✓ | ❌ | **Decisão de produto** — laudo-pago é PDF-friendly em geral, mas pode herdar toggle (decisão pendente) |

---

## 4. REQUISITO INVIOLÁVEL — Cards de upside SEMPRE mostram R$

> **Inviolável.** Cards de upside no laudo-pago **DEVEM** mostrar valor R$ em destaque
> em cada card individual.

### 4.1 — Estrutura obrigatória do card

Cada card de upside renderiza:

1. **Pill da categoria** com label human-readable:
   - `ro` → "Resultado Operacional"
   - `passivo` → "Redução de Passivos"
   - `multiplo` → "Aumento de Múltiplo"
   - `qualitativo` → "Qualitativo"
   - `paywall` → "Bloqueado (R$99)" *(não aparece no laudo-pago — paywalls aqui são revelados)*
2. **Título humano** (`u.label`)
3. **Descrição curta** (`u.descricao`)
4. **VALOR R$ EM DESTAQUE** (lookup em `potencial_12m.upsides_ativos[id]`)
5. **Notinha** *"↑ ganho estimado no valor de venda do negócio se a ação for executada"*

### 4.2 — Variantes por tipo

| categoria | comportamento no laudo-pago |
|---|---|
| `ro` / `passivo` / `multiplo` (com gate ativo) | Valor R$ verde + % bruto + notinha |
| `qualitativo` | "Ação necessária — sem valor monetário direto" (não inventar número) |
| `paywall` | **Revelar valor R$ normalmente** (cliente já pagou) |
| Categoria monetária com gate negativo | "sem contribuição calculada" (não esconder, indicar honestamente) |

### 4.3 — Razão arquitetural

O laudo-pago **NÃO terá** a seção POTENCIAL 12M agregada (Valor Hoje / Potencial / Projetado) — essa seção é exclusiva do laudo-admin pra auditoria. Sem o R$ no card individual, o comprador (a) não vê quanto cada ação contribui, (b) não consegue priorizar, (c) percebe o laudo como vago.

A info agregada (`potencial_12m.potencial_final.valor_projetado_brl`) **vai no hero do laudo-pago** (renderHeroResumo), via correção do bug `valuation.valor_potencial_12m` → `potencial_12m.potencial_final.valor_projetado_brl`. O detalhe vem nos cards individuais.

---

## 5. Mapa de mudanças por seção (3 colunas)

| seção do laudo-pago | aproveita do admin direto | recortar/simplificar do admin | criar novo |
|---|---|---|---|
| Capa | — | — | ✓ já existe (não mexer) |
| Folha de rosto | — | — | ✓ já existe (atualizar fallback `_versao_parametros` v2026.04 → v2026.07) |
| Índice | — | — | ✓ já existe (revisar entradas após refactor) |
| Hero/Resumo (Sec 1) | KPIs `valor_venda` + `valor_projetado_brl` | — | corrigir lookup `valor_potencial_12m` → `potencial_12m.potencial_final.valor_projetado_brl` |
| Sec 2 — Contexto IA | — | — | manter placeholder até Fase 4 |
| Sec 3 — DRE | render do admin (data-driven) | retirar `<details>` JSON debug | — |
| Sec 4 — Balanço | render do admin + fix alinhamento (T3) | retirar JSON debug | — |
| Sec 5 — ISE | render do admin (forEach pilares) | **remover** indicador de origem por sub-métrica (SUBMET_ORIGEM_MAP UI) | — |
| Sec 6 — Indicadores | render completo do admin (reordenação T2.1, barras T2.2, fundos T2.3, implicações T2.4) | retirar JSON debug | — |
| Sec 7 — Tributária | render do admin (4 regimes + economia + observações) | retirar JSON debug | — |
| Sec 8/9/10 — Textos IA | — | — | manter placeholder Fase 4 |
| Sec 11 — Atratividade | render do admin (componentes + fonte_crescimento atualizado) | retirar JSON debug | — |
| Sec 12 — Público-alvo IA | — | — | manter placeholder Fase 4 |
| **Sec 13 — Upsides + Recomendações** | base do `renderUpsidesAdmin` (refactor v2026.07) com listas separadas Ativos/Paywalls + categorias técnicas + valor R$ + notinha + sub-bloco Qualitativos/Pré-venda | retirar `<details>` "Detalhes técnicos" (admin-only) | adaptar copy do paywall pra comprador (já pagou) — **revelar R$** em vez de "[R$99 pra revelar...]" |
| Sec 14 — Operacional | render do admin | — | — |
| Sec 15 — Fechamento | — | — | já existe |

### Resumo numérico

- **9 seções** reaproveitam código do admin com pequena adaptação (ADAPT):
  Hero, DRE, Balanço, ISE, Indicadores, Tributária, Atratividade, Upsides, Operacional.
- **6 seções** seguem como estão hoje (Capa, Folha, Índice, 4 textos IA, Fechamento).
- **0 seções novas** precisam ser criadas do zero (todas já existem em forma básica ou no admin).
- **5 bugs críticos** a corrigir (ver §2.3).

### Esforço estimado

- **Bug crítico Upsides** (revamp tipo do laudo-admin): 90 min
- **Bug Hero** (`valor_potencial_12m`): 10 min
- **Adaptações ADAPT** (8 seções, schema + retirar JSON debug): 60 min
- **Sub-bloco Recomendações pré-venda**: 20 min
- **Polimentos visuais cross-tema**: 30 min
- **Total: 3.5–4 horas** (vs. estimativa do handoff de 2-3h — handoff subestimou bug do Upsides)

---

## 6. Decisões pendentes

### D-1 — Toggle dark/light no laudo-pago?

Opção (a): herdar do laudo-admin (toggle no header).
Opção (b): só dark (default).
Opção (c): só light (PDF-friendly).

**Recomendação**: (a) — toggle, default light pra laudo-pago (impressão amigável), opcional dark via toggle.

### D-2 — Layout do paywall na Sec 13 do laudo-pago

Cliente pagou os R$99. **Não faz sentido** mostrar "[Bloqueado (R$99)]" como pill. Opções:

(a) Renomear pill pra "Análise complementar" (paywall vira valor agregado pago).
(b) Esconder paywalls da seção principal e adicionar bloco "Análises adicionais" separado.
(c) Manter pill "Bloqueado" mas adicionar selo "Liberado" — confuso.

**Recomendação**: (a) — pill "Análise complementar" cor `purple` ou `green`, valor R$ revelado, copy explicando que é parte do pago.

### D-3 — Ordem dos cards Upside

(a) Por contribuição R$ decrescente (maior valor primeiro) — UX comprador foca-se no maior ganho.
(b) Por categoria (ro → passivo → multiplo → qualitativo → paywall).
(c) Por `ordenacao_exibicao[]` se o array existir no `potencial_12m`.

**Recomendação**: (a) — comprador beneficia de ver primeiro o que mais agrega valor.

### D-4 — laudo-completo.html — deletar agora ou depois?

Arquivo legado, 87KB. Não está mais sendo trabalhado. Remover em commit dedicado pós-refactor do laudo-pago.

**Recomendação**: deixar pra commit final do bloco, depois que laudo-pago estiver consolidado.

### D-5 — Fallback de versão `_versao_parametros: 'v2026.04'` no código

Hardcoded em vários lugares (linha 733, 746, 1607). Como o `_versao_parametros` agora vem populado pela skill, esse fallback só aparece no DEMO_DATA antigo do próprio arquivo. Atualizar fallback default pra `'v2026.07'`.

**Recomendação**: atualizar fallback junto com o restante do refactor.

### D-6 — DEMO_DATA do laudo-pago.html

Provavelmente também está congelado em schema antigo (não verifiquei detalhe mas o fallback `v2026.04` na linha 362 indica). Após refactor, regerar via fixture (mesma estratégia do laudo-admin — `/tmp/gen-demo-data.js`).

**Recomendação**: regerar como último commit do bloco, evita validação visual com dados velhos.

---

## 7. Próximo passo

**Aguardando análise + decisões D-1 a D-6** antes de codificar.

Quando aprovado, sequência sugerida (modo cruzeiro):

1. (P) Atualizar fallbacks `_versao_parametros` v2026.04 → v2026.07
2. (P) Corrigir bug `valor_potencial_12m` no Hero → `potencial_12m.potencial_final.valor_projetado_brl`
3. (P) Atualizar strings `fonte_crescimento` em renderAtratividade
4. (P) Retirar JSON debug das seções data-driven (DRE, Balanço, ISE, Indicadores, Tributária, Atratividade)
5. (P) Remover indicador de origem por sub-métrica em renderISE (`SUBMET_ORIGEM_MAP` UI)
6. (G) **REVAMP renderUpsides** — schema novo `{ ativos, paywalls }` + categorias técnicas + valor R$ obrigatório + notinha + sub-bloco Qualitativos/Pré-venda + paywall revelado (D-2 aplicada)
7. (P) Aplicar fix de alinhamento Balanço (T3)
8. (P) Aplicar barras + fundos + implicações em INDICADORES (T2.1-2.4)
9. (P) Toggle dark/light (D-1 aplicada)
10. (P) Regenerar DEMO_DATA do laudo-pago via fixture
11. **Validação visual contra Forste DEMO em ambos os temas**
