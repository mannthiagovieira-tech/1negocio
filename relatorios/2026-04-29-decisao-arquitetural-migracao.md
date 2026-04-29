# Decisão arquitetural — Migração v1 → v2

**Data:** 29/04/2026
**Status:** Aprovada por Thiago, supersede plano de "Fases sequenciais" da spec rev3
**Contexto:** Sessão pós-investigação de conflitos SQL, integrações e Edge Functions

---

## DECISÃO

Migração será feita por **paralelo na main + adaptação incremental de páginas**, 
direto na branch main, sem branch isolada de desenvolvimento.

---

## CARACTERÍSTICA CRÍTICA DO CONTEXTO

**Não há cliente real em produção, não há fluxo no site ainda.**

Isso muda completamente a análise de risco:
- "Risco produção" durante migração = inexistente
- "Cliente vê tela quebrada" = ninguém está vendo
- "Skill v2 falhar silenciosamente para cliente real" = não há cliente
- Ambiente Supabase único (project ID dbijmgqlcrgjlcfrastg)
- ANTHROPIC_API_KEY já disponível pra Edge Functions

Isso permite trabalhar diretamente na main sem riscos típicos de migração.

---

## PAPEL DA BACKEND-V2 DAQUI PRA FRENTE

Branch backend-v2 deixa de ser sandbox ativa e vira **arquivo de referência**.

Contém:
- Skill v2 (snapshots v2026.04-07) pronta
- Laudo-admin refatorado pronto
- Laudo-pago refatorado pronto
- Migrations 001-008 criadas
- Documentação completa (spec rev3, mapeamentos, decisões pendentes)

Trabalho novo (Fase 4, paralelo, adaptação de páginas) acontece **direto na main**. 
Arquivos prontos em backend-v2 são copiados pra main quando necessário.

backend-v2 fica preservada como histórico até confirmação de sucesso da migração. 
Pode ser deletada depois.

---

## ESTRATÉGIA APROVADA

### Princípio 1: Paralelo dentro da própria main

Skill v1 e skill v2 rodam em paralelo dentro do main. Diagnóstico chama as duas:

```
DIAGNÓSTICO (intacto)
    ↓
chama AVALIADORA.avaliar()       → laudos_completos    (v1, intocada)
chama AVALIADORA_V2.avaliar()    → laudos_v2           (v2, sandbox interna)
    ↓
redireciona pro laudo gratuito v1 (fluxo atual mantido)
```

Não há fork de branch durante desenvolvimento. Tudo na main.

### Princípio 2: Páginas v1 NÃO mudam de fluxo

Cada página da v1 (laudo-gratuito, index, negocio.html, portal-usuario, painel-admin) 
mantém EXATAMENTE seu fluxo atual:
- Mesmas integrações (Stripe, Z-API, Twilio)
- Mesmas Edge Functions chamadas
- Mesmos webhooks
- Mesmos popups, CTAs, redirects, fluxos
- Mesmo termo de adesão

A ÚNICA mudança em cada página: **fonte de informação que ela exibe.**

Hoje:
- Página tem texto/número hardcoded
- Página calcula coisas em runtime no JavaScript
- Página lê schema antigo de calc_json v1

Depois (após adaptação):
- Página busca dados de calc_json v2 (gerado em paralelo pela skill v2)
- Página busca textos analíticos de calc_json.textos_ia (gerados pela Fase 4)
- Estrutura visual, popups, fluxos, integrações: idênticos a hoje

### Princípio 3: Adaptação página por página, no tempo do operador

Não há "dia D" da migração. Cada página é adaptada quando estiver pronta:
1. Operador aponta arquivo da v1 (intocado na main)
2. Mapeamento de hardcodes (somente leitura)
3. Decisões de produto sobre cada hardcode
4. Adaptação cirúrgica preservando 100% do fluxo
5. Validação visual com Forste demo
6. Commit e próxima página

### Princípio 4: Skill v1 morre por desuso

Quando todas as páginas estiverem lendo de calc_json v2, skill v1 fica órfã. 
Aposentadoria gradual:
1. Para de chamar AVALIADORA.avaliar (1 linha de código)
2. Tabelas v1 ficam órfãs (sem custo deixar)
3. Eventualmente DROP TABLE laudos_completos (Decisão #21: 30 dias depois)
4. Eventualmente delete skill-avaliadora.js v1

Sem evento traumático.

---

## PRÉ-REQUISITO IDENTIFICADO

**Antes de adaptar páginas v1, completar Fase 4 (Edge Function gerar_textos_laudo).**

Razão: o laudo-admin é o "repositório de verdade" de onde as páginas v1 vão buscar 
informação. Os 7 textos analíticos são parte dessa verdade. Se Fase 4 não estiver 
pronta, cada página adaptada vai precisar de fallback temporário pros textos 
vazios — retrabalho garantido quando Fase 4 chegar.

Atacar Fase 4 ANTES de adaptar páginas elimina retrabalho.

---

## ORDEM DE EXECUÇÃO APROVADA

### Passo 0 — Checkpoint segurança
- Tag git da main antes de qualquer mudança
- Backup de garantia

### Passo 1 — Fase 4 (Edge Function gerar_textos_laudo) — DESENVOLVIDA NA MAIN

**Localização:** main (não backend-v2)

Razão: ambiente Supabase único, ANTHROPIC_API_KEY já disponível, Edge Function é 
função nova sem impacto no fluxo v1 existente. Não há motivo pra desenvolver em 
sandbox.

Trabalho:
- Configurar ANTHROPIC_API_KEY como secret no Supabase produção
- Criar Edge Function `gerar_textos_laudo` em supabase/functions/
- Escrever 7 prompts versionados (em migration ou em parametros_versoes)
- Criar tabela logs_edge_functions
- Validar com Forste sintético

Estimativa: 5-8h

### Passo 2 — Subir paralelo na main

**Localização:** main

**Fonte do código:** arquivos prontos em backend-v2 são copiados pra main:
- skill-avaliadora-v2.js
- laudo-admin.html (versão v2 refatorada)
- migrations 001-008

Trabalho:
- Aplicar migrations no Supabase produção (não destrutivo)
- Copiar skill-avaliadora-v2.js da backend-v2 pra main
- Substituir laudo-admin.html da main pela versão v2 (Decisão A: sem cliente real, 
  sem motivo pra ter dois)
- Adicionar gatilho no diagnostico.html chamando AVALIADORA_V2 em paralelo
- Edge Function gerar_textos_laudo dispara automaticamente após cada novo 
  calc_json v2

Estimativa: 1.5-2h

### Passos 3+ — Adaptar páginas v1, uma por vez

**Localização:** main

Ordem sugerida (pode mudar conforme prioridade do operador):
- laudo-gratuito.html (mapeamento já pronto em backend-v2, copiar pra main)
- index.html (cards da home)
- negocio.html (página do anúncio com 2 níveis pré/pós-NDA)
- portal-usuario.html
- painel-admin.html (se necessário)

Cada uma: 3-6h dependendo da complexidade.

### Passo final — Aposentar v1

Quando todas as páginas estiverem adaptadas:
- Remover chamada paralela da skill v1
- Esperar 30 dias (Decisão #21)
- DROP TABLE laudos_completos, parametros_1n
- Deletar skill-avaliadora.js v1
- Deletar branch backend-v2 (após confirmação de sucesso da migração)

---

## DECISÕES TÉCNICAS RELACIONADAS

### Tabelas
- parametros_versoes (nova) — não conflita com parametros_1n
- laudos_v2 (nova) — não conflita com laudos_completos
- ALTER aditivo em negocios (4 colunas nullable) — não destrutivo
- logs_edge_functions (nova) — pra monitoramento Fase 4

### Conflitos identificados
- ZERO conflitos destrutivos
- Coexistência v1 + v2 totalmente segura

### Edge Functions
- 7 deployadas sem source local (validar-whatsapp, zapi-relay, diagnostico-sessao,
  enviar-whatsapp-laudo, notificar-diagnostico, chat-ia, auth-wpp)
- Recomendação: rodar `supabase functions download` antes do Passo 1 pra 
  preservar source no repo

### Stripe
- Webhook não tem source local
- Pode estar deployado direto ou pode não existir
- Não bloqueia migração — investigar quando entrar em laudo-pago v2

### Anthropic
- ZERO uso atual no repo
- Único uso provável: function chat-ia deployada (sem source)
- Fase 4 é greenfield total
- API key disponível pelo operador

---

## PRINCÍPIOS INVIOLÁVEIS

1. **main intocada onde já funciona** — só adicionamos paralelo e novas funções, 
   não mexemos no fluxo v1 existente
2. **Páginas v1 mantêm 100% das integrações** — só trocam fonte de dados
3. **Adaptação cirúrgica** — preservar estrutura, popups, CTAs, fluxos
4. **Sem inventar** — só substituir hardcode/cálculo runtime por leitura do 
   calc_json v2
5. **Validação visual a cada página adaptada** — Forste demo deve bater com 
   laudo-admin v2
6. **Trabalho novo direto na main** — sem branch isolada, sem fork de desenvolvimento

---

## ESTADO DE IMPLEMENTAÇÃO

| Item | Status | Localização |
|---|---|---|
| Skill v2 (snapshots v2026.04-07) | ✅ Pronta | backend-v2 (será copiada pra main) |
| Tabelas paralelas (parametros_versoes, laudos_v2) | ✅ Migrations criadas | backend-v2 (será aplicada na main) |
| Laudo-admin v2 | ✅ Pronto | backend-v2 (será copiado pra main) |
| Laudo-pago v2 | ✅ Pronto em backend-v2 (será reaproveitado) | backend-v2 |
| Checkpoint segurança da main | ⏸️ Próximo passo | main |
| Fase 4 — Edge Function gerar_textos_laudo | ⏸️ Após checkpoint | main |
| Paralelo na main | ⏸️ Após Fase 4 | main |
| Adaptação laudo-gratuito.html | ⏸️ Após paralelo | main |
| Adaptação index.html | ⏸️ Após laudo-gratuito | main |
| Adaptação negocio.html | ⏸️ | main |
| Adaptação portal-usuario.html | ⏸️ | main |
| Adaptação painel-admin.html | ⏸️ | main |
| Aposentadoria v1 | ⏸️ Após todas as páginas adaptadas | main |
| Deletar branch backend-v2 | ⏸️ Após sucesso confirmado | — |

---

## REFERÊNCIAS

- Spec rev3: relatorios/spec-v2-final-rev3.md
- Mapeamento laudo-gratuito: relatorios/2026-04-29-mapeamento-hardcodes-laudo-gratuito.md
- Decisões pendentes laudo-gratuito: relatorios/2026-04-29-decisoes-pendentes-laudo-gratuito.md
- Pendência breakdown upsides: relatorios/2026-04-29-pendencia-breakdown-upsides.md
