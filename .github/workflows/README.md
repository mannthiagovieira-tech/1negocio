# Crons GitHub Actions · 1Negócio

Régua oficial de crons que disparam edge functions Supabase.
Sem sobreposição entre eles · janelas de 30 min entre execuções.

## DIÁRIO

| BRT | UTC | yml | Função | Status |
|-----|-----|-----|--------|--------|
| 04:00 | 07:00 | (não em repo · Apify cron) | F1 OLX scraper | ATIVO (admin gerencia) |
| 04:30 | 07:30 | `cowork-cron.yml` | F2 cowork-rodar-frente-corretores | ATIVO (descomentado) |
| 05:00 | 08:00 | `cowork-cron.yml` | cowork-gerar-plano-diario | ATIVO |
| 05:30 | 08:30 | `f8-monitorar-likers.yml` | F8 monitorar-post-likers | DESATIVADO (admin valida) |

## SEMANAL

| Quando | yml | Função | Status |
|--------|-----|--------|--------|
| domingo 03:30 BRT (06:30 UTC) | `f9-monitorar-ads.yml` | F9 monitorar-ads-concorrente | DESATIVADO (admin valida) |
| domingo 08:00 BRT (11:00 UTC) | parte do F9 cron | WhatsApp resumo concorrentes | depende ativação F9 |

## ATIVAÇÃO/DESATIVAÇÃO

Cada yml tem comentários claros. Pra ativar/desativar · descomenta/comenta a linha do `schedule:`.
Pra rodar manual · GitHub Actions tab → Run workflow.

## SECRETS NECESSÁRIOS

- `SUPABASE_SERVICE_ROLE_KEY` (todos)
- Edge functions usam env vars do Supabase: `ANTHROPIC_API_KEY`, `APIFY_TOKEN`, `APIFY_TOKEN_OLX`, `GOOGLE_API_KEY`, `ADMIN_WHATSAPP`, `ZAPI_INSTANCE`, `ZAPI_TOKEN`, `ZAPI_CLIENT_TOKEN`.

## SEM SOBREPOSIÇÃO · CONFIRMADO

- 04:00 → F1 OLX (Apify externo)
- 04:30 → F2 corretores (Google Places + Haiku)
- 05:00 → Plano diário (lê leads_google · classifica via Sonnet · WhatsApp resumo)
- 05:30 → F8 likers (Apify + Haiku · DESATIVADO)
- domingo 03:30 → F9 ads (Apify + Sonnet · DESATIVADO)

Cada cron usa job separado · sem deps entre eles. Janela 30 min é suficiente porque:
- F2 (1 cidade) leva ~20s
- Plano diário leva ~30-60s
- F8 (10 posts) levaria ~5min se ativo
