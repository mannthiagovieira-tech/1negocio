# Chat IA — Changelog v28

**Data:** 2026-05-03
**Arquivo modificado:** `supabase/functions/chat-ia/index.ts` (constante `SYSTEM_PROMPT`)
**Backup:** `supabase/functions/chat-ia/index.ts.backup-pre-v28-03mai2026`
**Tamanho do prompt:** 30.291 → **32.074 chars** (+1.783 chars; ~14,9k tokens input agora)

---

## O que mudou

### M1 — Tagline institucional (linha 22)

**Antes:**
> Primeira plataforma brasileira de compra e venda de empresas pra PMEs.

**Depois:**
> Plataforma colaborativa de compra e venda de empresas.

Razão: alinhamento com posicionamento institucional atual. "Primeira plataforma brasileira" foi removido como reivindicação. O foco passa a ser **colaborativa** (rede + curadoria + tecnologia).

A tagline curta ("Quanto vale um negócio? Nós sabemos.") e a frase de posicionamento ("Não é classificado, é mesa de negociação digital com laudo, avaliação técnica e curadoria humana") permanecem inalteradas.

---

### M3 — Lista de produtos atualizada (linhas 26-30)

**Antes (4 produtos):**
- Laudo PDF — R$ 99
- Plano Guiado — R$ 588 + 5%
- **Avaliação Profissional — R$ 397** ← removido
- Plano Gratuito — R$ 0 + 10%

**Depois (4 produtos com Sócio-Parceiro como produto):**
- Laudo PDF — R$ 99
- Plano Guiado — R$ 588 + 5%
- Plano Gratuito — R$ 0 + 10%
- **Plano Sócio-Parceiro (trienal) — R$ 5.346 (10x R$ 534,60)** ← adicionado

Razão: produto "Avaliação Profissional R$ 397" não existe mais. Plano Sócio-Parceiro passa a aparecer também na lista de produtos (referência cruzada com §4 do brain dump).

---

### M5 — Distinção Sócio vs Parceiro no brain dump (linhas 42-62)

**Antes:** apenas 1 parágrafo resumido.

**Depois:** parágrafo de abertura + **2 formatos detalhados**:

- **FORMATO 1 — SÓCIO (institucional):** Plano trienal R$ 5.346 (10x R$ 534,60), auto-serviço completo via portal, acesso a todos os negócios e teses, gerador de conteúdo IA, sem limite de vínculos, comissão 40%
- **FORMATO 2 — PARCEIRO (pontual):** sem plano, vinculação manual via 1Negócio (WhatsApp direto), limite de vínculos simultâneos, sem painel próprio, comissão 40%

Instrução: ao detectar candidato a Sócio-Parceiro, IA apresenta as 2 opções. Quem escolher Parceiro é orientado a contato via WhatsApp direto (não auto-serviço).

Razão: produto está sendo separado conceitualmente. Chat IA precisa diferenciar pra orientar candidato corretamente.

---

### M4 — Regra 2 das NUNCAs expandida (linhas 557-589)

**Antes (1 linha):**
> 2. NUNCA use jargão em inglês: M&A, cashflow, EBITDA, DCF, WACC, deal, lead, churn.

**Depois (33 linhas):**

Regra reorganizada em 3 blocos:

1. **TERMOS VETADOS** (12 termos):
   M&A · DCF · WACC · Valuation (em conversa com cliente) · EBITDA isolado · Benchmark · ROI / TIR / VPL · Equity / Stake / Cap Table · Earnout · Due Diligence · Cashflow · deal · churn

2. **SUBSTITUIÇÕES OFICIAIS** (11 traduções para Português leigo):
   - M&A → "compra e venda de empresas"
   - DCF / Valuation → "avaliação financeira"
   - Margem → "quanto sobra de cada R$ 100"
   - Benchmark → "comparativo com mercado"
   - ROI → "retorno do investimento"
   - Due diligence → "análise de risco"
   - Earnout → "acordo de valor variável"
   - EBITDA → "lucro real da operação"
   - Cashflow → "fluxo de caixa"
   - Deal → "negócio" / "operação"
   - Churn → "cancelamento de clientes"

3. **QUANDO O TERMO TÉCNICO FOR INEVITÁVEL:** Sempre vem com explicação curta entre parênteses ou frase ao lado. Exemplo: *"O EBITDA — o lucro real da operação, antes de impostos e dívidas — é..."*

Razão: lista expandida pra cobrir vocabulário M&A completo, com substituições oficiais aprovadas pra que a IA tenha o caminho certo de comunicação (não só o que NÃO falar).

---

## Decisões registradas (não viraram edits)

### A1 — Linha 203 com "trabalho com M&A" (MANTIDO)

A linha está em **DETECÇÃO DE PERFIL — SÓCIO-PARCEIRO** como trigger de **escuta** (frases que o usuário diz). NÃO é a IA falando "M&A".

Decisão: **manter**. Remover quebraria a detecção de perfis profissionais (corretores/contadores/consultores que usam o jargão pra se identificar). A regra 26 ("nunca usar M&A") aplica-se à fala da IA, não à escuta.

### A2 — Email (SEM MUDANÇAS)

Investigado. Não há nenhuma menção a email como **canal ativo de comunicação** ("te mandamos por email", "verifica seu email") no system prompt.

As ocorrências encontradas são:
- Linhas 125 e 160: "ritmo de WhatsApp, não de e-mail" — reforço do canal preferido (mantém)
- Código fora do prompt (tools schema, saveLead): `email: { type: 'string', description: 'E-mail (opcional)' }` — campo opcional de cadastro (mantém)

Decisão: nenhuma alteração necessária.

---

## Linhas alteradas (resumo)

| Mudança | Linha (antes) | Tipo |
|---|---|---|
| M1 — Tagline | 22 | substituição em 1 linha |
| M3 — Produtos | 26-30 | -1 linha + 1 linha nova |
| M5 — Sócio vs Parceiro | 42-43 | +18 linhas |
| M4 — NUNCAs regra 2 | 538 | +32 linhas (1 → 33) |

Total: +49 linhas líquidas no SYSTEM_PROMPT.

---

## Validações

- ✅ Sintaxe TS válida (`new Function()` parse OK)
- ✅ System prompt: 32.074 chars (cresceu 1.783)
- ✅ Diff limpo (revisado linha a linha)
- ✅ Backup criado: `supabase/functions/chat-ia/index.ts.backup-pre-v28-03mai2026`
- ⏳ Deploy pendente

---

## Próximo passo

Deploy via Supabase CLI:

```bash
cd /Users/premium/1negocio
supabase functions deploy chat-ia --project-ref dbijmgqlcrgjlcfrastg --no-verify-jwt=false
```

Após deploy:
1. Smoke test: `curl ... { messages: [{role:'user', content:'oi'}] }` — confirma reply OK
2. Teste de tagline: perguntar "Como funciona a 1Negócio?" — resposta NÃO deve usar "primeira plataforma brasileira"
3. Teste de produtos: perguntar "Quais são os planos de vocês?" — deve listar 4 produtos sem "Avaliação Profissional R$ 397"
4. Teste de Sócio vs Parceiro: perguntar "como funciona o programa de sócio?" — deve apresentar os 2 formatos
5. Teste de jargão: perguntar "vale a pena pelo EBITDA?" — IA deve responder usando "lucro real da operação"

Versão será **chat-ia v28** após deploy.

---

## Não alteradas (intacto conforme briefing)

- ✅ Tools (continuam as 7: calcular_valuation_rapido, buscar_negocios, consultar_negocio, consultar_laudo_publico, registrar_lead_interessado_ia, registrar_tese_investimento, marcar_interesse_socio_parceiro)
- ✅ Lógica de captura de nome+telefone (gate antes do cálculo)
- ✅ Função `calcularValuationRapido` (cálculo client-side)
- ✅ Edge function endpoints (chat-ia + zapi-relay)
- ✅ Frontend `chat-ia.js`
- ✅ Snapshot ativo `parametros_versoes` (v2026.11-pool-9-categorias)

Apenas o **SYSTEM_PROMPT** (texto enviado para Anthropic) foi modificado.
