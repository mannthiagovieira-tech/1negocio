# Auditoria laudo-pago — calc_json v2 como fonte de verdade

**Data:** 29/04/2026
**Caso:** Padaria do Teste 01 (`0cfdac2d-4708-4bdf-9d9b-9cc1c10b5c6a`)

---

## ✅ TEXTOS IA — todos lidos do calc_json

Nenhum texto longo é montado inline no laudo. Cada chave consumida via `calcJson.textos_ia.<chave>.conteudo`:

| Texto IA | Onde é consumido |
|----------|------------------|
| `texto_contexto_negocio` | `renderTextoIA` em renderTudo (seção 04) |
| `texto_parecer_tecnico` | `renderAvaliacao` (seção 08) |
| `texto_diferenciais` | `renderPontosFortesAtencao` (anexo A2) |
| `texto_riscos_atencao` | `renderPontosFortesAtencao` (anexo A2) |
| `texto_resumo_executivo_completo` | NÃO consumido (seção removida) |
| `texto_publico_alvo_comprador` | NÃO consumido (seção removida) |
| `sugestoes_titulo_anuncio` | NÃO consumido (laudo-pago não exibe título) |
| `texto_consideracoes_valor` | NÃO consumido |
| `descricoes_polidas_upsides` | NÃO consumido (laudo usa `upsides.ativos[].descricao` direto) |

Renderização: `markdownSimples()` aplicado em todos os pontos de inserção (commit desta sessão). Antes: `escapeHtml + replace \n\n` deixava `#`, `**`, `##` crus. Depois: `<h3>`, `<strong>`, `<ul>` renderizados.

---

## ✅ CÁLCULOS DE NEGÓCIO — feitos pela skill v2

Auditoria do laudo:

```
$ grep -E "Math\.(round|max|min|abs)\([^)]*(fat|ro|cmv|valor_venda|valor_op|fator|pl|patrimon)"
```

Único hit: linha 866 — `Math.max(0, (s.valor / fat) * 100)` em `renderDRE`, calculando `%` de uma sub-métrica vs faturamento. **É formatação de exibição, não cálculo de negócio.** Aceitável (igual a `valor.toLocaleString('pt-BR')`).

Cálculos críticos (valor_venda, fator_final, ISE, indicadores) ficam 100% na skill v2 e chegam prontos no calc_json.

---

## ✅ PARÂMETROS — lidos do calc_json + parametros_versoes

Versões exibidas pelo laudo:
- `_versao_calc_json` (path top do calc_json) → "2.0"
- `_versao_skill` (path top do calc_json) → null no Stuido Fit (fallback "2.0" hardcoded como degradação)
- `_versao_parametros` (path top do calc_json) → "v2026.08"

Benchmarks: cada `indicadores_vs_benchmark.<id>.benchmark` vem da skill, que copiou de `parametros_versoes.snapshot.benchmarks_*`. Laudo só exibe.

---

## ⚠️ PENDÊNCIAS REGISTRADAS

### 1. Atratividade no texto_parecer_tecnico (Edge Function)

O parecer técnico ainda menciona "atratividade setorial classificada em 0/10".

**Origem:** prompt da Edge Function `gerar_textos_laudo` em `parametros_versoes.snapshot.prompts_textos_ia.laudo.texto_parecer_tecnico`.

**Não é problema do laudo** — laudo só renderiza o que vem da Edge. Fix correto: revisar prompt na próxima sessão.

**Adicionado ao backlog do handoff** (sessão anterior já registrou "Revisão completa dos prompts" como P1).

### 2. Texto IA `texto_resumo_executivo_completo` agora não é consumido

Continua sendo gerado pela Edge Function (custo ~US$ 0,002 por laudo). Decisão: manter geração (talvez seja útil no futuro) OU pular esse prompt no fire-and-forget pra economizar custo. Sem ação imediata.

### 3. `recomendacoes_pre_venda` no calc_json é redundante

Skill v2 gera `recomendacoes_pre_venda` a partir dos qualitativos do catálogo (skill linha ~2530). É a MESMA coisa que `upsides.ativos` filtrado por `categoria='qualitativo'`. Causou bug de duplicação no laudo (corrigido nesta sessão descartando `recs`).

Limpeza opcional na skill v2: remover `recomendacoes_pre_venda` do output (consumidores que precisam podem filtrar `upsides.ativos`). Não-bloqueante.

---

## STATUS FINAL

✅ Laudo-pago lê 100% do calc_json v2.
✅ Cálculos de negócio na skill v2.
✅ Parâmetros em `parametros_versoes`.
✅ Textos IA na Edge Function `gerar_textos_laudo`.
⚠️ Prompt do parecer ainda menciona atratividade (corrigir em próxima rodada).

---

*Auditoria gerada em 29/04/2026 ao final da sessão de correções pós-revisão.*
