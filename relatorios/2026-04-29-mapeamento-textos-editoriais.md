# Mapeamento de textos editoriais do produto

**Data:** 29/04/2026 · **Branch:** main · **Tipo:** investigação somente leitura
**Objetivo:** mapear cada texto editorial gerado por IA ou hardcoded, pra alimentar Fase 4

---

## SUMÁRIO POR CATEGORIA

- **Laudo gratuito**: 6 textos editoriais identificados
- **Laudo pago**: 7 textos consumidos via `calcJson.textos_ia.*`
- **Anúncio (index + negocio)**: 7 textos identificados (+ campos `dossie_json` do vendedor)
- **Admin (sugestões de título)**: 1 texto pendente
- **Total único catalogado**: 14 textos distintos (alguns aparecem em múltiplas superfícies)

---

## TABELA UNIFICADA

> Leitura: `Spec §11` → presente na tabela rev3 §11.1. `Status atual` → como aparece hoje no produto. Modelo segue spec (Haiku rápido/criativo, Sonnet analítico).

| # | Nome do texto | Arquivo onde aparece | Seção visual | Pra quem | Tamanho | Modelo | Quando gerar | Spec §11? | Status atual |
|---|---|---|---|---|---|---|---|---|---|
| 1a | **Resumo executivo (completo)** | laudo-pago.html (main+v2), laudo-completo.html (main), laudo-fonte/admin, negocio.html após NDA | hero topo do laudo | Vendedor + comprador pós-NDA | 200-300 palavras | Haiku | Commit do laudo | ✅ #1a | laudo-pago consome `tIA.texto_resumo_executivo_completo`. laudo-completo main usa **template JS runtime** (linha 877-895 — ~200 palavras condicionais a partir de D.nome/setor/ise/recorrência/etc) |
| 1b | **Resumo executivo (anônimo)** | laudo-fonte/admin, card do index, negocio.html antes NDA | hero da listagem | Comprador público | 100-150 palavras | Haiku | Criação do anúncio | ✅ #1b | **NÃO existe ainda** — index.html linha 2017 usa `d.descricao` (campo do banco, hardcoded por admin) |
| 2 | **Contexto do negócio** | laudo-pago, laudo-fonte/admin, negocio.html após NDA | seção 2 do laudo | Vendedor + comprador pós-NDA | 250-400 palavras | Haiku | Commit do laudo | ✅ #2 | laudo-pago consome via `renderTextoIA('2', 'Contexto', ..., 'texto_contexto_negocio')`. Schema do calc_json espera vazio até Fase 4 |
| 3 | **Parecer técnico** | laudo-pago, laudo-fonte, negocio.html após NDA | seção 8 do laudo | Vendedor + comprador pós-NDA | 400-600 palavras | Sonnet | Commit do laudo | ✅ #3 | laudo-pago consome via `renderTextoIA('8', 'Parecer técnico', ..., 'texto_parecer_tecnico')`. Vazio. |
| 4 | **Riscos e atenção** | laudo-pago, laudo-fonte, negocio.html após NDA | seção 9 do laudo | Vendedor + comprador pós-NDA | 250-400 palavras | Sonnet | Commit do laudo | ✅ #4 | laudo-pago consome via `renderTextoIA('9', ..., 'texto_riscos_atencao')`. Vazio. |
| 5 | **Diferenciais** | laudo-pago, laudo-fonte, negocio.html antes/após NDA | seção 10 do laudo + teaser do anúncio | Comprador público + pós-NDA | 200-300 palavras | Haiku | Commit do laudo | ✅ #5 | laudo-pago consome via `renderTextoIA('10', ..., 'texto_diferenciais')`. Vazio. |
| 6 | **Público-alvo comprador** | laudo-pago, laudo-fonte, negocio.html após NDA | seção 12 do laudo | Vendedor + comprador pós-NDA | 200-300 palavras | Sonnet | Commit do laudo | ✅ #6 | laudo-pago consome via `renderTextoIA('12', ..., 'texto_publico_alvo_comprador')`. Vazio. |
| 7 | **Descrições polidas dos upsides** | laudo-gratuito (4 free), laudo-pago (10), laudo-fonte, negocio.html resumo após NDA | cada card de upside | Todos | 60-120 palavras × 6-10 itens | Haiku | Commit do laudo | ✅ #7 | Schema `calc_json.textos_ia.descricoes_polidas_upsides[]` esperado. **Vazio**. laudo-gratuito (laudo-completo main, linha 1281-1295) gera descrições via **template JS runtime** com placeholders |
| 8 | **Sugestões de título do anúncio (3)** | painel-admin (criação anúncio) | dropdown ao publicar | Admin (Thiago) | 60-80 caracteres × 3 | Haiku | Criação do anúncio | ✅ #8 | **NÃO existe**. Hoje admin digita título manual em `admin-anuncios.html:612` (`f-titulo` input com `slice(0,TMAX)`). Campo `titulo_anuncio` no banco já existe |
| 9 | **Considerações sobre valor** | laudo-gratuito (se delta>15%), laudo-pago, laudo-fonte, negocio.html após NDA | bloco abaixo do valor de venda | Todos | 150-250 palavras | Sonnet | Criação do anúncio | ✅ #9 | **NÃO existe**. Hoje laudo-completo main usa **template JS runtime** (`atrativ-comentario` linha 1051: "Índice de atratividade X (Y/10). Combina solidez...") — bem mais curto que spec sugere |

### Textos editoriais NÃO previstos pela spec rev3 §11

| # | Nome do texto | Arquivo | Seção | Status |
|---|---|---|---|---|
| H1 | **Frase de tipo de venda** | laudo-completo.html main + laudo-gratuito v2 | sub do valor de venda | "Porteira fechada — inclui estoque, equipamentos e ponto comercial" — texto fixo, mesmo pra todos. Decidido em `2026-04-29-decisoes-pendentes-laudo-gratuito.md` (Decisão 1) |
| H2 | **Nota termômetro contextual** | laudo-completo.html main + laudo-gratuito v2 | abaixo do termômetro | "Boa notícia: 55% acima da expectativa" — template JS runtime ou hardcoded conforme caso. Decisão 4 do laudo-gratuito mantém por ora |
| H3 | **Mensagem de loading** | negocio.html linha 491 | tela quando laudo ainda processando | "Estamos finalizando a análise técnica..." — fixo, OK manter |
| H4 | **Mensagem NDA pública** | negocio.html linha 1171 | bloco "como solicitar info" | "Compradores qualificados podem solicitar acesso..." — fixo, OK manter |

### Campos `dossie_json` (preenchidos pelo VENDEDOR no diagnóstico, não IA)

Estes **não são textos IA** — são campos editoriais do diagnóstico que aparecem no `negocio.html` após NDA. **Listados pra evitar confusão com Fase 4**:

- `mat.motivo_venda` (linha 1343)
- `mat.ponto_loc` (linha 1320)
- `mat.crescimento_motivos`, `mat.crescimento_perspectiva` (1364-1365)
- `mat.diferenciais` (1378)
- `mat.concorrentes`, `mat.posicionamento_preco`, `mat.ameacas_competitivas` (1379-1381)

Esses 8 campos vivem no `dossie_json` e são preenchidos pelo vendedor — **fora do escopo da Fase 4**. Estão na spec rev3 §3.5 como parte do schema do `negocios.dossie_json`.

### Campos `negocios.*` específicos do anúncio (alguns IA, alguns admin)

| campo | onde aparece | tipo | status |
|---|---|---|---|
| `descricao_geral` | portal-dark, _arquivo | rica | hoje preenchido manual (admin); pode virar IA via texto #5 (Diferenciais) ou texto novo |
| `teaser_contexto_ia` | portal-dark, _arquivo | curto | nome sugere IA — **não está na spec rev3** mas existe no banco. Pode mapear pro texto #1b (Resumo anônimo) |
| `abertura_negociacao` | portal-dark | texto | não-IA, vendedor preenche |
| `tags_calculadas` | portal-dark | array | derivado |

---

## CRUZAMENTO COM SPEC §11.1

### ✅ Textos da spec presentes (estrutura) no produto

9 dos 9 textos da spec rev3 §11.1 têm slot reservado:
- 7 textos analíticos (1a, 2, 3, 4, 5, 6, 7) — estrutura em `calcJson.textos_ia.*` populada pela skill v2 com placeholders `null`
- 2 textos de anúncio (1b, 8, 9) — estrutura em `calcJson.textos_anuncio.*` idem

### ⏸️ Textos da spec ainda não gerados em produção

**Todos os 9 textos da spec ainda estão vazios (`conteudo: null`)** porque a Edge Function `gerar_textos_laudo` não existe (Fase 4 não iniciada).

Substitutos atuais (gambiarras temporárias):
- Texto #1a → laudo-completo main usa **template JS runtime** (linha 877-895)
- Texto #5 → ? (laudo-pago só renderiza placeholder "[Texto pendente — em geração pela IA]")
- Texto #7 → laudo-completo main gera **template JS runtime** com placeholders (linha 1281+)
- Texto #9 → laudo-completo main usa **template JS curto** em `atrativ-comentario`

### ❓ Textos no produto que NÃO estão na spec

- **H1, H2, H3, H4**: textos fixos (não IA) — decidir se vale gerar via IA na Fase 4 ou manter fixos
- **`teaser_contexto_ia`** no banco: nome sugere IA mas não está documentado na spec rev3. Talvez seja texto #1b "Resumo executivo anônimo" sob nome diferente (pré-rev3)
- **`atrativ-comentario` runtime** em laudo-completo: 1 frase template JS — bate com texto #9 mas é mais curto

---

## RECOMENDAÇÕES PRA FASE 4 — Edge Function `gerar_textos_laudo`

### Escopo mínimo (commit do laudo): 7 textos (Haiku × 4 + Sonnet × 3)

| # | Texto | Modelo | Custo estimado/laudo |
|---|---|---|---|
| 1a | Resumo executivo completo | Haiku | ~R$ 0,03 |
| 2 | Contexto do negócio | Haiku | ~R$ 0,04 |
| 3 | Parecer técnico | Sonnet | ~R$ 0,06 |
| 4 | Riscos e atenção | Sonnet | ~R$ 0,04 |
| 5 | Diferenciais | Haiku | ~R$ 0,03 |
| 6 | Público-alvo comprador | Sonnet | ~R$ 0,04 |
| 7 | Descrições polidas dos upsides | Haiku | ~R$ 0,03 (4-10 itens) |
| | **Total estimado** | | **~R$ 0,27/laudo** |

### Escopo Fase 4-bis (criação do anúncio): 3 textos adicionais

- 1b Resumo anônimo (Haiku)
- 8 Sugestões de título (Haiku)
- 9 Considerações sobre valor (Sonnet)

Cabe em Edge Function separada `gerar_textos_anuncio` (spec §12.2). **Não bloqueia Fase 4 inicial**.

### Pontos de atenção pro prompt engineering

1. **Texto #1a tem template JS de referência** em laudo-completo main linha 877-895. Bom modelo da estrutura esperada (200 palavras com placeholders condicionais ISE/recorrência/clientes).
2. **Texto #9 (Considerações sobre valor)** condicional `delta>15%` — só dispara se a expectativa do dono ficou >15% acima/abaixo do valor 1N. Critério da spec.
3. **Texto #7 (Descrições polidas)** roda **uma vez por upside** — laudo-pago tem até 10, laudo-gratuito até 4. Lote de 4-10 calls Haiku por laudo.
4. **Frases prescritivas deletadas** (Atratividade veredicto, Fator R, "regime ótimo") — spec §11 nota explícita: "Geração via IA é o caminho oficial". Texto #9 substitui esses.

### Pendências antes de codar

- Configurar `ANTHROPIC_API_KEY` como secret no Supabase produção
- Criar tabela `logs_edge_functions` (spec §12.6)
- Decidir se prompts ficam em `parametros_versoes.prompts_textos_ia` (spec §4.17) ou hardcoded na função
- Decidir trigger: front chama após `INSERT laudos_v2`? Webhook DB? Cron pegando `status=pendente_geracao`?

---

## REFERÊNCIAS

- Spec rev3 §11 (textos IA): `relatorios/spec-v2-final-rev3.md` linhas 1561-1635
- Spec rev3 §12 (Edge Functions): linhas 1635-1710
- Investigação Fase 4 (estado pré-implementação): conversa anterior
- Decisões pendentes laudo-gratuito: `relatorios/2026-04-29-decisoes-pendentes-laudo-gratuito.md` (Decisões 1, 3, 4 sobre textos editoriais hardcoded)
