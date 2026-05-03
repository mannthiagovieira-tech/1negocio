# Brief 1Negócio — Contexto pra continuidade

> Cole isto como **primeira mensagem** de uma conversa nova no claude.ai (ou
> use como "Custom instructions" se criar um Project). Atualizado em 2026-05-01.

---

## Quem está conversando contigo

**Thiago Mann** — fundador e operador do 1Negócio. Trabalha sozinho na
codebase, é mais visual que textual, prefere discutir arquitetura/decisão
no browser e executar código no terminal. Aprendendo a colaborar com
Claude aos poucos.

---

## O produto

**1Negócio** — marketplace de M&A pra pequenos negócios brasileiros.

**Funil resumido:**
1. Vendedor entra → faz **diagnóstico** (formulário ~40 perguntas)
2. Plataforma gera **laudo grátis** (visão geral) e oferece **laudo pago R$99** (completo)
3. Admin (Thiago) revisa, ajusta título/preço/comissão e **publica anúncio**
4. Comprador interessado clica → solicita info → assina **NDA** → recebe material confidencial
5. Negociação acontece com 1Negócio intermediando

**Operadora jurídica:** Forste Soluções em Gestão Ltda · CNPJ 09.447.248/0001-70.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | HTML/JS vanilla (sem framework) — `/Users/premium/1negocio/*.html` |
| Backend | Supabase (Postgres + Auth + Storage + Edge Functions) |
| Deploy | Vercel (auto-deploy via push pra `main` no GitHub) |
| WhatsApp | Edge Function `zapi-relay` |
| IA (textos do laudo) | OpenAI via edge function async (polling 5s/60s no client) |

Repo GitHub: `mannthiagovieira-tech/1negocio` · branch `main` é produção.

---

## Arquitetura "single source of truth"

```
        ┌────────────────────────────────────────────┐
        │ DIAGNÓSTICO (T43b preview + T44 commit)   │
        │  └─ AVALIADORA_V2.avaliar(D, mode) ─┐     │
        │                                      ▼     │
        │  ┌──────────────────────────────────────┐ │
        │  │ skill-avaliadora-v2.js               │ │
        │  │ FONTE ÚNICA da contabilidade         │ │
        │  │ exporta calc_json canônico           │ │
        │  └──────────┬───────────────────────────┘ │
        │             │ persiste                     │
        │             ▼                              │
        │  ┌──────────────────────────────────────┐ │
        │  │ Banco — laudos_v2.calc_json + textos │ │
        │  └──────────┬───────────────────────────┘ │
        │             │ leitura                      │
        │     ┌───────┴────┬──────────┬───────┐    │
        │     ▼            ▼          ▼       ▼    │
        │ laudo-pago  negocio.html  index   T43b   │
        └────────────────────────────────────────────┘
```

**Regra:** mudou fórmula → mexe **só** em `skill-avaliadora-v2.js`. Os 4
consumidores leem do mesmo `calc_json` e refletem automaticamente.

---

## Arquivos-chave

| Arquivo | Função |
|---|---|
| `skill-avaliadora-v2.js` | Skill v2 — fonte única do cálculo (DRE, BP, ISE, valuation, atratividade) |
| `diagnostico.html` | Formulário ~40 perguntas + T43b/T44 (chama skill em modo preview/commit) |
| `laudo-pago.html` | Laudo completo do comprador (consome calc_json + textos IA via polling) |
| `admin-anuncios.html` | Painel admin pra publicar anúncio (resumo Avaliação 1N inline) |
| `portal-usuario.html` | Área logada (vendedor + comprador, abas: anúncios/diagnósticos/termos/teses) |
| `negocio.html` | Página pública do anúncio (4 abas: público/financeiro/operacional/privado) |
| `termo-sigilo.html` | Página de assinatura do NDA |
| `termo-adesao.html` | Página de assinatura do termo de adesão (vendedor) |
| `visualizar-termo.html` | Página readonly que mostra termo já assinado + auditoria |

---

## Personas de teste

| Nome | Papel | Cenário |
|---|---|---|
| **Mariah** | vendedora | abriu negócio, recebeu laudo, admin publicou |
| **Thiago Mann** | comprador | clicou anúncio, assinou NDA, espera material |
| **Padaria (perfil teste)** | exemplo validado | RO R$ 291.860, PL -R$ 584.228 — diag bate com laudo |

---

## Convenções de código (importantes)

- Sem framework: HTML + `<script>` inline ou arquivos JS soltos.
- Indentação: 2 espaços. Strings: aspas simples no JS.
- Sem comentários óbvios. Comentário só pra "porquê" não-óbvio.
- Sem helpers prematuros — 3 linhas similares é melhor que abstração antes da hora.
- Schema do banco evolui via Supabase migrations (`/supabase/migrations/`).
- Tabelas relevantes: `negocios`, `laudos_v2`, `anuncios_v2`, `nda_solicitacoes`,
  `nda_assinaturas`, `solicitacoes_info`, `usuarios`, `eventos_usuario`.
- `dados_json` (jsonb) é onde mora o estado bruto do diagnóstico.
- `calc_json` (jsonb em `laudos_v2`) é o resultado processado pela skill.

---

## Como prefiro que tu trabalhe comigo

- **Resposta curta.** Sem resumo no fim. Sem "vou fazer X" antes de fazer.
- **Dúvida estrutural? Pergunta.** Senão executa em sequência e reporta no final.
- **Não commita** sem eu pedir. Só edita os arquivos.
- **Não cria docs / READMEs** sem eu pedir.
- **Honesto sobre limitação:** se não pode validar visualmente, fala explícito.
- **No browser (claude.ai)**, tu não roda código nem commita — modo consultoria.
  Eu sou o braço. Tu me dá código pronto, eu colo/rodo/reporto.

---

## Estado em 2026-05-01

**Bugs resolvidos recente:**
- BUG A — `ativo_franquia=0` propagava sem recalcular (skill v2 defensivo)
- BUG C — antecipação double-count (taxas com hierarquia + fallback)
- BUG D — diag impostos Real flat 34% (resolvido pelo refactor T43b)
- BUG E — texto IA pendente preso (polling 5s / timeout 60s no laudo-pago)
- 7 fixes do funil Mariah/Thiago (FIX 1–7) — termo aceita UUID/código,
  pós-NDA continuidade, link 404 do termo, admin visão completa, status
  sincronizado vendedor/comprador, termo cita Negócio Alvo

**Pendente conhecido:**
- BUG B — colunas planas em `negocios.*` ficam NULL (cosmético, dados
  vivem em `dados_json`/`calc_json`)
- Validação visual fim-a-fim no browser ainda não rodada após FIX 1–7

---

## Glossário rápido

- **NDA** = Termo de Confidencialidade que comprador assina pra ver dados sigilosos
- **ISE** = Índice de Saúde Empresarial (score 0-100, soma de 6 dimensões)
- **calc_json** = JSON canônico com DRE/BP/ISE/valuation gerado pela skill v2
- **fator/múltiplo** = multiplicador aplicado ao RO anual pra valuation
- **valor_1n / avaliacao_min/max** = faixa central da avaliação calculada
- **T43b/T44** = fases do diagnóstico (T43b = preview da skill, T44 = commit)
- **Laudo grátis** = `/laudo-completo.html` (visão pública)
- **Laudo pago** = `/laudo-pago.html` (visão completa, R$99)
- **Laudo admin** = `/laudo-admin.html` (visão interna pra Thiago)

---

## Quando me passar contexto novo

Se mudou algo importante depois desta versão, abre **uma seção "Atualizações"
no fim** com a data, ao invés de reescrever a spec inteira. Eu leio em ordem
e a versão mais recente vence.

```
## Atualizações
### 2026-05-15
- Adicionada tabela `negociacoes` com fluxo de oferta/contraoferta
- ...
```
