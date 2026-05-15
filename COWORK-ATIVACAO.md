# Cowork · Guia de Ativação

**Data inicial:** 2026-05-04
**Status global:** Etapa A funcional · Etapa H funcional · Etapas B-G como esqueletos
**Branch:** main · 4 commits referenciados abaixo

---

## TL;DR · O que tá funcionando hoje

| Etapa | O que faz | Status |
|---|---|---|
| **A** | Plano diário gerado todo dia 5h BRT por IA · bloco no Cockpit + tela própria | ✅ ATIVO |
| **H** | Tela admin com CRUDs (cidades-alvo · perfis-âncora IG · concorrentes ads) | ✅ ATIVO |
| **B** | Classificador de leads OLX via Haiku | 🚧 Esqueleto |
| **C** | Frentes corretores + Instagram followers | 🚧 Esqueleto |
| **D** | Disparador WhatsApp manual | 🚧 Esqueleto |
| **E** | Geração automática de peças + roteiros | 🚧 Esqueleto |
| **F** | Monitoramento Instagram (posts + perfis + engajamento) | 🚧 Esqueleto |
| **G** | Monitoramento ads de concorrentes (Meta Ad Library) | 🚧 Esqueleto |

---

## Pra começar a usar AGORA (Etapa A)

### 1. Configurar GitHub Secrets · 1 vez só
No repo GitHub → Settings → Secrets and variables → Actions → New repository secret:

- `SUPABASE_SERVICE_ROLE_KEY` · valor do painel Supabase → Settings → API → service_role secret

Sem esse secret, o cron de 5h falha (401).

### 2. (Opcional) Configurar WhatsApp do admin
Supabase → Edge Functions → cowork-gerar-plano-diario → Secrets:
- `ADMIN_WHATSAPP` · ex: `5548999999999` (DDD + número · só dígitos)

Sem isso, o plano só fica no banco · não dispara WhatsApp.

### 3. Disparar 1ª execução manualmente
- Opção A · GitHub UI · Actions → "Cowork · cron diário" → Run workflow
- Opção B · Painel → Cockpit → bloco "Plano de hoje" → botão `↻ Regenerar`

A partir de amanhã, roda automaticamente todo dia 8h UTC (5h BRT).

---

## Estrutura de tabelas (já criadas via MCP)

11 tabelas + 2 ALTERs (todas com RLS · admin only):

```
cowork_planos_diarios          1 plano/dia · UNIQUE data
cowork_tarefas                 FK plano_id · ordem · feita
cowork_cidades_alvo            18 cidades Sul cadastradas (RS+SC+PR)
ig_perfis_ancora               vazia · admin cadastra na tela Cowork
ads_concorrentes_monitorados   vazia · admin cadastra
cowork_roteiros_stories        vazia · 1 roteiro/dia (Etapa E)
cowork_roteiros_youtube        vazia · seg+qui (Etapa E)
ig_posts_monitorados           vazia · URL UNIQUE
ig_posts_snapshots             FK post_id ON DELETE CASCADE
ig_perfis_monitorados          vazia · username UNIQUE
instagram_engajamento          UNIQUE (post, username, tipo)
ads_snapshots                  FK concorrente_id ON DELETE CASCADE

ALTER leads_google         + classificacao_ia · classificado_em
ALTER ig_seguidores_raw    + classificacao_ia · distribuido_em
```

---

## Edge Functions

### Deployadas (1)
- `cowork-gerar-plano-diario` · ATIVO em produção · cron 5h BRT

### Stubs (12 · não-deployadas)
Cada uma retorna **501 stub** · admin substitui pelo código real quando for ativar:

| Slug | Etapa | O que vai fazer |
|---|---|---|
| `classificar-lead-olx` | B | Categoriza leads OLX via Haiku |
| `cowork-rodar-frente-corretores` | C | Google Places · cidade rotativa do dia |
| `cowork-rodar-frente-instagram` | C | Apify · followers de perfis-âncora |
| `cowork-distribuir-instagram-diario` | C | Marca 200 perfis "empreendedor" como distribuídos hoje |
| `cowork-disparador-whatsapp` | D | Disparo MANUAL (admin opera · sem cron) |
| `cowork-gerar-pecas-feed` | E | 3 peças/dia via gerar-conteudo-post |
| `cowork-gerar-roteiro-stories` | E | 1 roteiro/dia · 45-60s |
| `cowork-gerar-roteiro-youtube` | E | seg+qui · 5-8min |
| `monitorar-post-instagram` | F | Apify · likers/commenters · 1x/dia |
| `monitorar-perfil-instagram` | F | Detecta posts novos · auto-cadastra |
| `analisar-engajamento-ig` | F | Classifica engajamento via Haiku |
| `monitorar-ads-concorrente` | G | Apify · facebook-ads-library-scraper · domingo |

---

## Apify Actors escolhidos (autorizado · admin pode trocar)

| Actor | Uso | Custo estimado |
|---|---|---|
| `apify/instagram-followers-scraper` | Frente 3 (já em uso) | ~$5-15 por perfil-âncora · 1x/semana |
| `apify/instagram-post-scraper` | Frente F (likers/commenters) | ~$0.05 por post · 1x/dia |
| `apify/facebook-ads-library-scraper` | Frente G | ~$1 por concorrente · 1x/semana |

**Como trocar:** abrir o stub correspondente em `supabase/functions/<nome>/index.ts` e mudar o
endpoint POST do Apify. Documentar no commit qual actor foi usado.

---

## Custos estimados (Apify · com frequências reduzidas conforme decidido)

| Frente | Frequência | Volume | Custo/mês |
|---|---|---|---|
| OLX D-1 (Etapa B) | diário | 17 kw × 15 cidades reduzido | $30-60 |
| Frente 3 IG followers | 1x/sem | 1-3 perfis-âncora × 10k followers | $20-50 |
| Frente F posts IG | 1x/dia (era 6h · reduzido) | 5-30 posts ativos | $10-50 |
| Frente G ads concorrentes | 1x/sem | 1-10 concorrentes | $5-15 |
| **TOTAL** | — | — | **$65-175/mês** |

Anthropic (plano diário · classificadores · roteiros): ~$0.30-2/dia = **~$10-60/mês**

---

## Crons (GitHub Actions · Supabase Free não tem pg_cron)

Hoje só 1 ativo:
- `0 8 * * *` · cowork-gerar-plano-diario · 5h BRT diário

Pra ativar os outros · adicionar no `.github/workflows/cowork-cron.yml` (já estruturado · só descomentar quando edge function correspondente sair de stub).

Schedule recomendado (após ativação completa):
```
0 7 * * *      cowork-rodar-frente-corretores      (4h BRT)
0 8 * * *      cowork-gerar-plano-diario           (5h BRT) · JÁ ATIVO
0 8 * * *      cowork-distribuir-instagram-diario  (5h BRT)
30 8 * * *     cowork-gerar-pecas-feed             (5h30 BRT)
45 8 * * 2-7   cowork-gerar-roteiro-stories        (5h45 BRT · ter-dom)
45 8 * * 1,4   cowork-gerar-roteiro-youtube        (5h45 BRT · seg+qui)
0 6 * * 1      cowork-rodar-frente-instagram       (3h BRT segunda)
0 9 * * *      monitorar-post-instagram            (6h BRT diário)
0 9 * * *      monitorar-perfil-instagram          (6h BRT diário)
0 7 * * 0      monitorar-ads-concorrente           (4h BRT domingo)
```

Disparador WhatsApp · **NÃO entra no cron** · sempre manual (admin opera).

---

## Cadastros iniciais sugeridos (admin faz quando ativar cada etapa)

### Pra Etapa C ativar
**Tela Sistema → Cowork (admin) → Perfis-âncora IG**

Sugestões iniciais (adapte ao seu mercado):
- @sebraebrasil · empreendedor
- @endeavorbrasil · empreendedor
- @rdstation · empreendedor

### Pra Etapa F ativar
**Tela Marketing → Monitoramento de Conteúdo (UI placeholder · ativa quando Etapa F sair de stub)**

Sugestões pra começar:
- 3-5 posts virais relevantes do nicho
- 2-3 perfis de concorrentes fortes
- Marca "capturar likers" e "capturar commenters"

### Pra Etapa G ativar
**Tela Sistema → Cowork (admin) → Concorrentes ads**

Sugestões iniciais:
- BuyCo · BR
- Sunoo · BR
- (qualquer player M&A nacional rodando ads no Meta)

---

## Distinção crítica · prompts/lógica

Mantida em todos os system prompts e classificadores:
- **SÓCIO** · plano trienal R$ 5.346 · auto-serviço portal
- **PARCEIRO** · pontual · vinculação manual via WhatsApp · sem plano
- **Glossário vetado** · sem M&A · valuation · benchmark · ROI · earnout · cashflow · deal · churn

Frente 2 (corretores) precisa do classificador IA detectar:
- `gmaps_corretores` → potencial parceiro
- `gmaps_concorrentes` → potencial comprador (concorrente direto de negócio anunciado)

---

## Commits desta sessão

1. `a8f0e2c` · feat(cowork): infra base + plano diário automático (Etapa A)
2. `edd644e` · feat(cowork): tela admin · status edge functions + CRUDs (Etapa H)
3. `6f4a5a1` · feat(cowork): esqueletos B-G · 7 tabelas + 12 edge function stubs
4. _este commit_ · docs(cowork): guia de ativação + custos + actors

---

## Próximos passos práticos

1. **Hoje** · adicionar `SUPABASE_SERVICE_ROLE_KEY` nos GitHub Secrets do repo
2. **Hoje** · rodar `Run workflow` no GitHub Actions pra gerar 1º plano
3. **Hoje** · abrir https://1negocio.com.br/painel-v3.html#cockpit · ver bloco "Plano de hoje"
4. **Esta semana** · validar 3-5 dias de plano gerado · me dar feedback (ajusto prompt)
5. **Quando quiser** · escolher 1 frente B/C/E/F/G pra ativar · refatorar o stub correspondente

Frente recomendada pra ativar primeiro: **Etapa B · classificar-lead-olx**
- 1 edge function pequena
- Roda só após scrap OLX manual
- Não tem cron novo
- Já agrega valor (segmenta os 558 leads OLX que existem hoje no banco)
