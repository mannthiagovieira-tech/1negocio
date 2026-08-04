# Classificação das 107 edge functions Supabase · task #81

Data: 2026-08-04 · projeto dbijmgqlcrgjlcfrastg
Objetivo: identificar dormentes pra liberar espaço no limite de functions do plano. **Nada foi deletado** — lista pra aprovação em lote do operador.

## Totais por bucket (107 edges)
- **MORTA-ÓBVIA: 3** — `debug-env-peek-twilio`, `hermes-webhook-teste`, `rafa-sandbox-ops`
- **PROVÁVEL-MORTA: 21** — F3/F8 pausados + originação legada + sócios v1 + extras
- **VIVA: 78** — cron ativo, webhooks externos, fluxo onboarding/diagnóstico/laudo, painel-v3
- **INCERTA: 5** — carecem inspeção manual

Potencial de liberação em 2 ondas: **24 edges** (~22% do limite atual).

---

## MORTA-ÓBVIA (3)

1. **debug-env-peek-twilio** (v10) — nome auto-declara debug
2. **hermes-webhook-teste** (v11) — o vivo é `hermes-webhook` (chamado pelo `api/zapi-router.js`)
3. **rafa-sandbox-ops** (v8) — nome sandbox

## PROVÁVEL-MORTA (21)

### F3/F8 pausados (8) — ver memória `f3_deprecado_f8_pivot.md`
- `cowork-rodar-frente-instagram`
- `monitorar-post-likers`
- `monitorar-ads-concorrente`
- `classificar-likers`
- `classificar-perfil-instagram`
- `apify-instagram-followers`
- `classificar-lead-olx`
- `buscar-telefone-olx`

### Originação legada (5) — fluxo migrou pra `gerar-briefing-tese`
- `originacao-buscar-associacoes`
- `originacao-buscar-claude-web`
- `originacao-buscar-social`
- `gerar-originacao`
- `originacao-buscar-cnae`

### Sócios v1 (4)
- `socio-buscar-codigo`
- `socio-iniciar-cadastro-terceiro`
- `socio-pedir-vinculo`
- `socio-validar-phone`

### Extras (4)
- `aprovar-peca` · `arquivar-peca` (só painel-v3)
- `buscar-pool-interno`
- `gerar_textos_anuncio` (substituído pelo pipeline `gerar-peca`)

## VIVA (78)
- Cron ativo (5+)
- Webhooks externos: Stripe, Z-API, Hermes fan-out (`hermes-webhook` chamado pelo `api/zapi-router.js:13` em paralelo com o webhook MANDATO)
- Fluxo onboarding/diagnóstico/laudo
- ~55 chamadas no `painel-v3.html`
- `hermes-cron` disparado por 3 cron jobs (`hermes-apify-poll`, `hermes-followup`, `hermes-relatorio-diario`) com Authorization Bearer explícito
- `apify-facebook-search` e `apify-olx-scraper` VIVOS (cron diário 04:10 e 04:00 UTC)
- `sentinela-portal-resumo` viva via 3 crons/dia (`1n-atualizacoes-06h/12h/18h`) mesmo sem callers no repo

## INCERTA (5)
- `originacao-buscar-gmaps`
- `originacao-buscar-cnae` (listado 2× · dedupe manual)
- `vencimento-editar`
- `notificar-boss-portal`
- `rafa-sandbox-ops`

---

## Top 5 candidatas pra deletar PRIMEIRO
1. `debug-env-peek-twilio` — nome auto-declara debug
2. `hermes-webhook-teste` — vivo é `hermes-webhook`
3. `gerar_textos_anuncio` — só em docs .md; substituído por `gerar-peca`
4. `monitorar-post-likers` + `classificar-likers` + `classificar-perfil-instagram` — F8 pausado
5. `originacao-buscar-associacoes` / `-claude-web` / `-social` — legado, sem cron, fluxo migrou

## Surpresas / bugs colaterais
- **`disparador-processar-campanha`** aparece em `painel-v3.html` mas **NÃO está deployada** — chamada quebrada, front tenta invocar edge inexistente. Bug ativo a reportar.
- **`salvar-lead`** ainda tem 1 caller (`_internal/cockpit.html`) — viva por pouco.

## Recomendação de execução (2 ondas · regra do operador)
1. **Onda 1 (deletar imediatamente)**: os 3 MORTA-ÓBVIA + 3 top provável-morta seguras (`gerar_textos_anuncio`, `originacao-buscar-associacoes`, `originacao-buscar-claude-web`) = **6 slots liberados**
2. **48h de observação**
3. **Onda 2 (após aprovação)**: restantes 18 provável-morta = **18 slots**

Total liberável sem tocar em VIVAs ou INCERTAs: **24 edges** = ~22% do limite atual.
