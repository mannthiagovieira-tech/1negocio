# Crons GitHub Actions · 1Negócio

⚠️ **POLÍTICA ATUAL · MANUAL ONLY** (decisão admin · controle de custo)

Apenas crons que **não custam dinheiro** ficam ativos automáticos.
Tudo que dispara API paga (Apify · Sonnet · Z-API) requer trigger manual.

## ATIVO AUTOMÁTICO (custo ZERO)

| BRT | UTC | yml | Função | Por que ativo |
|-----|-----|-----|--------|---------------|
| 05:00 | 08:00 | `cowork-cron.yml` | cowork-gerar-plano-diario | só lê dados existentes · sem API paga |
| a cada 5min | — | `disparador-cron.yml` | disparador-processar-campanha | poll · só dispara Z-API se admin tiver campanha 'rodando' |

## MANUAL ONLY (workflow_dispatch · admin roda via GitHub Actions tab)

| Função | yml | Custo estimado por execução |
|--------|-----|------------------------------|
| F1 OLX scraper | (sem yml local · roda via Apify cron próprio) | ~R$ 5-15 dependendo queries |
| F2 cowork-rodar-frente-corretores | `cowork-cron.yml` (schedule comentado) | ~R$ 1-2 (1 cidade) |
| F8 monitorar-post-likers | `f8-monitorar-likers.yml` | ~R$ 0,50/post |
| F9 monitorar-ads-concorrente | `f9-monitorar-ads.yml` | ~R$ 50/run (20 concorrentes) |

## COMO ATIVAR/DESATIVAR

Edita o `.yml` correspondente:
- Pra **ATIVAR cron automático** · descomenta a linha `cron:` desejada · commit · push
- Pra **DESATIVAR cron automático** · comenta a linha `cron:` (mantém `workflow_dispatch:` pra continuar podendo rodar manual)

## COMO RODAR MANUAL

1. GitHub repo → Actions tab
2. Selecionar workflow desejado na sidebar
3. Click "Run workflow" (botão verde)
4. Aguarda execução · ~1-10min dependendo função

## SECRETS NECESSÁRIOS

GitHub Actions secrets:
- `SUPABASE_SERVICE_ROLE_KEY`

Edge functions usam env vars do Supabase (configurado lá):
- `ANTHROPIC_API_KEY`
- `APIFY_TOKEN` · `APIFY_TOKEN_OLX`
- `GOOGLE_API_KEY`
- `ADMIN_WHATSAPP` · `ZAPI_INSTANCE` · `ZAPI_TOKEN` · `ZAPI_CLIENT_TOKEN`

## SEM SOBREPOSIÇÃO

Os 2 crons automáticos não conflitam:
- 05:00 plano diário · executa 30-60s · termina antes 05:01
- 5min cron · pico simultâneo a cada 60min · independente

Crons manuais são triggerados pela admin · zero risco de overlap.
