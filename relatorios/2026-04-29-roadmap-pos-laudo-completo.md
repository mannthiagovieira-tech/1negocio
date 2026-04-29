# Roadmap pós laudo-completo — sequência até plataforma pronta

**Data:** 29/04/2026
**Origem:** definido por Thiago ao final da sessão de adaptação do laudo-completo.

**Princípio mestre:** v2 é a fonte da verdade. Páginas v1 viram puros
renderizadores do calc_json v2. Skill v1 será aposentada ao final.

---

## SEQUÊNCIA DE EXECUÇÃO

### 1. Adaptar laudo-pago.html → 100% v2
**Status:** próximo a executar.

Trabalho previsto: similar ao laudo-completo (paths v1→v2, 8 ISE, 3
Atratividade, BP completo, sem cálculos inline). Tendência de ser MAIS
rápido pois a metodologia já foi validada e os componentes da v2 estão
estáveis.

Conteúdo extra que justifica o R$99 (paywalls do catálogo):
- pw_funil_vendas (Análise completa do funil de vendas)
- pw_mapeamento_concorrencia (Mapeamento competitivo do mercado)
- pw_plano_transicao_dono (Plano de transição do dono)

Investigar primeiro se a v2 já tem dados pra esses 3 paywalls ou se a
skill precisa calcular novos campos.

### 2. Atualizar link "Ver modelo" no laudo gratuito
Após laudo-pago publicado, trocar a URL do botão "Ver modelo" no
laudo-completo (hoje aponta pro modelo antigo).

### 3. Adaptar index.html (home) → ler Supabase
Hoje usa `DATA = [...]` hardcoded. Conectar ao Supabase pra mostrar
negócios publicados de verdade.

### 4. Adaptar negocio.html (página de negócio) — pré-NDA
Card detalhado que comprador vê ANTES de assinar NDA. Info pública
sem identificadores (nome, sócios, endereço).

### 5. Adaptar negocio.html (página de negócio) — pós-NDA
Mesma página, mas com info detalhada após NDA assinado. Inclui dossiê
nível 2 e 3.

### 6. Limpeza do repositório
Quando 1-5 estiverem 100% funcionando:
- Aposentar skill-avaliadora.js (v1)
- Mover backend-v2 pra arquivo histórico
- Remover demo_data inline dos laudos
- Outras limpezas pendentes

### 7. Teste fim-a-fim de criação de anúncio
Roteiro completo:
- Vendedor faz diagnóstico
- Vendedor assina termo de adesão
- Anúncio vai pra fila do admin
- Admin aprova e publica
- Anúncio aparece na home
- Comprador vê o card
- Comprador demonstra interesse
- Comprador assina NDA
- Sistema libera dossiê nível 2
- Validação de fluxo completo até liberação de arquivos finais

---

## DEPENDÊNCIAS TÉCNICAS

### Maquininha precisa expansão pro item 7
A maquininha atual (scripts/testar-diagnostico.js) cria perfil técnico
(usuario vendedor + negocio + skill v2 + textos IA).

Pro teste fim-a-fim do item 7 vai precisar:
- Criar usuário comprador também
- Aprovar anúncio (status 'publicado')
- Disparar fluxo de "demonstrar interesse"
- Simular assinatura de termo e NDA
- Validar liberação de dossiê

Não-bloqueante até item 6.

### Pendências técnicas paralelas
(Já catalogadas no handoff principal)
- Stats da plataforma hardcoded (substituir por valor real)
- 7 Edge Functions sem source local (`supabase functions download`)
- DEMO_DATA inline (~600+ linhas em cada laudo)
- Webhook Stripe sem source local

Atacar em paralelo OU depois do item 6, conforme prioridade.

---

## CRITÉRIO DE "PLATAFORMA PRONTA PRO PRIMEIRO CLIENTE REAL"

Ao final do roadmap (item 7 validado), a plataforma deve permitir:
- Vendedor cadastrar negócio via diagnóstico
- Sistema gerar laudo gratuito + cobrar laudo pago
- Admin aprovar e publicar anúncio
- Compradores descobrirem na home
- Compradores assinarem NDA e acessarem dossiê
- Sistema gerenciar mesa de negociação
- Tudo lendo e gravando na v2 (zero v1 ativa)

---

*Roadmap gerado em 29/04/2026 ao final da sessão de adaptação do
laudo-completo. Sequência aprovada por Thiago.*
