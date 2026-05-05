# 1Negócio · Espec do Chat IA (Atendimento)

> Documento gerado em 03/05/2026 lendo `main` (commit 05c98c4 → versão chat-ia v27 deployada).
> Cobre: arquitetura, system prompt, tools, fluxos, validações, persistência, integração Z-API.
> Tudo aqui é o que está rodando hoje em produção. Nada inventado.

---

## 0. Mapa do fluxo (visão geral)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONT-END (browser)                             │
│                                                                              │
│  chat-ia.js (29.374 bytes — versão widget 2.8 / 2026-05-01)                 │
│   ├─ Carregada em: index.html, diagnostico.html (apenas 2 páginas)          │
│   ├─ Cria DOM:                                                              │
│   │     #n1-chat-wrap                                                       │
│   │       ├─ #n1-chat-btn (FAB verde — escondido na home, visível em /diag)│
│   │       └─ #n1-chat-panel (modal frosted glass 370×560 desktop)           │
│   ├─ Estado in-memory:                                                      │
│   │     state.{isOpen, messages[], lead{nome,whatsapp}, perfil,            │
│   │             phoneCaptureAsked, leadCaptured, leadId, ...}               │
│   ├─ Restaura sessão de localStorage (chave 'n1ChatState')                  │
│   └─ POSTa em /functions/v1/chat-ia (edge function)                         │
└─────────────────────────────────────────────────────────────────────────────┘
                              │  fetch JSON
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       EDGE FUNCTION supabase/functions/chat-ia               │
│                       (1.595 linhas — verify_jwt=true)                       │
│                                                                              │
│  Roteamento por body.action:                                                 │
│   ├─ "save_lead"    → saveLead() → INSERT/UPDATE chat_ia_leads              │
│   ├─ "escalate"     → escalateLead() → marca atendimento humano             │
│   └─ default        → chat com Anthropic Claude Sonnet 4                    │
│                                                                              │
│  MODEL = 'claude-sonnet-4-20250514'                                          │
│  MAX_TOKENS = 1500                                                           │
│  SYSTEM_PROMPT = 30.291 chars (≈ 14.5k tokens) — 15 seções                  │
│  TOOLS = 7 ferramentas (calcular_valuation_rapido, buscar_negocios,         │
│          consultar_negocio, consultar_laudo_publico,                         │
│          registrar_lead_interessado_ia, registrar_tese_investimento,        │
│          marcar_interesse_socio_parceiro)                                    │
│                                                                              │
│  Fluxo principal:                                                            │
│    1. Recebe { messages, jwt, lead_id, pagina_atual }                        │
│    2. detectarUsuarioLogado(jwt) → usuario_logado?                          │
│    3. fetch Anthropic /v1/messages com system + tools                       │
│    4. Se vier tool_use:                                                      │
│         → roteia pra função correspondente                                   │
│         → SEGUNDA chamada à Anthropic com tool_result                        │
│         → retorna reply final + valuation? + tool_called/tool_name           │
│    5. Senão: retorna reply direto                                            │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         INTEGRAÇÕES E PERSISTÊNCIAS                          │
│                                                                              │
│  ANTHROPIC                                                                   │
│   └─ POST https://api.anthropic.com/v1/messages                              │
│        model: claude-sonnet-4-20250514                                       │
│        ANTHROPIC_API_KEY (env Supabase)                                      │
│        cada round-trip: ~14.5k input + ~500-1500 output tokens               │
│                                                                              │
│  SUPABASE — TABELAS                                                          │
│   ├─ chat_ia_leads (33 cols)         ── leads gerais (1 por sessão chat)    │
│   ├─ chat_ia_leads_pendentes (11 cols)─ leads em escalação humana            │
│   ├─ leads_interessado_ia (11 cols)  ── eventos de interesse em negócio     │
│   │                                     específico (após consultar_negocio) │
│   ├─ teses_investimento (~22 cols)   ── teses de comprador (registrar_tese) │
│   └─ negocios + laudos_v2 + anuncios_v2 — leitura via tools                  │
│                                                                              │
│  ZAPI-RELAY (edge function separada)                                         │
│   └─ Validação phone-exists (action: 'phone-exists')                         │
│        timeout 3s, retorna {exists: true|false}                              │
│        ZAPI_INSTANCE / ZAPI_TOKEN / ZAPI_CLIENT_TOKEN como secrets           │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Onde o chat IA aparece e como é instalado

### 1.1 Páginas que carregam `chat-ia.js`

Apenas **2 páginas** (`grep -l "chat-ia.js" *.html`):
- `index.html` (home) — FAB **escondido** por CSS:
  ```html
  <style>#n1-chat-btn,#n1-welcome-bubble{display:none!important}</style>
  ```
  Abertura é via botão verde `.action.ai-chat` na `.stage-actions` (footer do card em evidência).
- `diagnostico.html` — FAB **visível** no canto inferior direito.

### 1.2 Modos de exibição (atributo `data-mode`)

- **Default** — FAB 56×56px, com pulse laranja chamando atenção
- **Discreto** (`data-mode="discreto"` no `<script>` ou `data-chat-mode="discreto"` no `<body>`) — FAB 44×44px, opacity 0.75, sem pulse

### 1.3 Estado/sessão entre páginas

`localStorage` key `n1ChatState`:
```js
{ messages, leadCaptured, leadId, lead:{nome,whatsapp}, nameCollected,
  nameAsked, phoneCaptureAsked, assistantMsgCount }
```
Persiste entre navegação. Se usuário abrir o chat numa página, fechar e abrir noutra, a conversa continua.

### 1.4 NÃO é o mesmo que `diagnostico.html`

Importante distinguir:
- **Chat IA (widget)** — pop-up flutuante, conversa rápida, captura de lead, **estimativa de valor** (não é avaliação completa).
- **diagnostico.html** — fluxo completo de 61 telas que produz `calc_json` em `laudos_v2` (laudo oficial).

São pipelines DIFERENTES:
- Chat IA usa `calcularValuationRapido()` (linha 970 da edge function chat-ia/index.ts) — fórmula simplificada.
- Diagnóstico usa a `AVALIADORA_V2` (skill-avaliadora-v2.js) — pipeline completo com 8 pilares ISE, balanço, etc.

---

## 2. SYSTEM_PROMPT — conteúdo completo (treinamento da IA)

Arquivo: `supabase/functions/chat-ia/index.ts:17-573` (constante `SYSTEM_PROMPT`).
Tamanho: **30.291 chars ≈ 14,5k tokens**.

### 2.1 Estrutura: 15 seções principais

| Linha | Seção (`##`) | Conteúdo |
|---|---|---|
| 19 | SOBRE A 1NEGÓCIO | Brain dump com 11 sub-seções (§2.2) |
| 92 | PRINCÍPIOS DE COMPORTAMENTO — REGRAS DE OURO | 6 regras críticas (§2.3) |
| 101 | EXEMPLOS DE COMENTÁRIOS POR CENÁRIO | 6 templates de resposta |
| 121 | TOM E ESTILO — REGRAS CRÍTICAS | Mensagens curtas (≤200 chars), abridores proibidos |
| 162 | TOM POSITIVO E SUTIL | "Não bajule, não diminua" |
| 174 | ABERTURA DA CONVERSA | Logado vs não logado, "entregue valor primeiro" |
| 191 | DETECÇÃO DE PERFIL — SÓCIO-PARCEIRO | Triggers e fluxo de oferta do programa |
| 246 | SOBRE NEGÓCIOS PUBLICADOS — TOOLS DE CONSULTA | Quando usar cada tool de busca |
| 338 | SOBRE COMO A PLATAFORMA FUNCIONA | Pitches por persona (vendedor/comprador/sócio) |
| 351 | QUANDO A PESSOA QUISER ESTIMATIVA DE VALOR | Coleta dos 9 dados (§2.4) |
| 459 | CAPTURA DE NOME E WHATSAPP — GATE OBRIGATÓRIO | Validações pré-cálculo |
| 474 | CONFIRMAÇÃO DOS DADOS ANTES DO CÁLCULO | Resumo + OK explícito |
| 487 | QUANDO RECEBER RESULTADO DE calcular_valuation_rapido | Narrativa em 4 etapas (§2.5) |
| 535 | REGRAS ABSOLUTAS — NUNCA FAÇA | 30 regras (§2.6) |
| 568 | RECURSOS E LINKS | URLs canônicas |

### 2.2 Brain dump institucional (§ "SOBRE A 1NEGÓCIO" — linhas 19-90)

11 sub-seções com tudo que a IA precisa saber sobre a 1Negócio:

1. **Quem somos** — "Primeira plataforma brasileira de compra e venda de empresas pra PMEs. Tagline: 'Quanto vale um negócio? Nós sabemos.' Não é classificado, é mesa de negociação digital com laudo, avaliação técnica e curadoria humana."

2. **Os 4 produtos**
   - Laudo PDF — R$ 99 (PDF do diagnóstico técnico)
   - Plano Guiado — R$ 588 + 5% (publicação assistida)
   - Avaliação Profissional — R$ 397 (sessão 1:1 com analista)
   - Plano Gratuito — R$ 0 + 10% (diagnóstico livre, publicação curada)

3. **Comissão 40/40/20**
   - 40% Sócio-Parceiro que **gerencia** o negócio à venda
   - 40% Sócio-Parceiro que **trouxe o comprador**
   - 20% Plataforma 1Negócio
   - Sobre comissão total: 5% (Plano Guiado) ou 10% (Plano Gratuito)

4. **Programa Sócio-Parceiro** — **Plano trienal** R$ 5.346 (10x R$ 534,60). NUNCA chamar de "anuidade".

5. **Como funciona (fluxo)** — vendedor / comprador / sócio (3 fluxos resumidos)

6. **Por que vender com a 1Negócio (3 desafios)** — avaliação correta · sigilo · compradores qualificados

7. **Rede de sócios-parceiros (cobertura nacional)** — pitch da inteligência colaborativa

8. **Curadoria humana** — "Não publicamos negócios. Publicamos diagnósticos."

9. **Metodologia (3 indicadores)**:
   - **ISE 0-100** (8 pilares ponderados — pesos exatos no system prompt: Financeiro 20%, Resultado 15%, Comercial 15%, Gestão 15%, Sócio 10%, Risco Legal 10%, Balanço 8%, Marca 7%)
   - **Avaliação 1N** — proprietária; IA NÃO expõe fórmulas
   - **Valor de Venda = Avaliação 1N + Ativos − Passivos**

10. **Regras de sigilo (3 camadas do dossiê)** — público / após NDA / após admin

### 2.3 Princípios de comportamento (linhas 92-99) — 6 regras de ouro

```
- PODE dar opinião contextual sobre negócios e cenários
- SEMPRE conclui sugerindo conversar com consultor 1Negócio em dúvidas específicas
- NUNCA promete preço, nunca afirma "vale" ou "não vale"
- NUNCA expõe detalhes técnicos da Metodologia 1N (proprietária)
- SEMPRE usa "compra e venda de empresas" — NUNCA "M&A"
- SEMPRE chama de "Plano trienal" — NUNCA "anuidade"
```

### 2.4 Coleta da estimativa rápida — 9 dados (linhas 353-457)

Quando a pessoa pede estimativa de valor próprio negócio, IA coleta em conversa fluida (NÃO formulário):

| # | Campo | Tipo | Quando perguntar |
|---|---|---|---|
| 1 | `nome_negocio` | string | sempre |
| 2 | `cidade_uf` | string | sempre |
| 3 | `setor_code` | enum 12 setores | infere e CONFIRMA em 2 turnos |
| 4 | `modelo_atuacao_multi` | array | só pra setor com produto físico |
| 5 | `ativo_estoque` | number | só pra setor com produto físico |
| 6 | `faturamento_anual` | number | sempre confirmar mensal/anual |
| 7 | `sobra_anual` | number | **explicar o que conta**: pró-labore + parcelas + contas em atraso + investimentos do negócio (depois das despesas operacionais) |
| 8 | `ativos_relevantes` | number | equipamentos+veículos+máquinas (não inclui estoque) |
| 9 | `dividas_total` | number | financiamentos + empréstimos + impostos atrasados |

**Regras condicionais para o modelo de atuação (linhas 374-432)** — aplicação do "Caminho C" aprovado:

- **Setores que PERGUNTAM (produto físico):** varejo, alimentacao, industria, logistica, construcao + subcategorias farmácia, pet, automotivo
- **Setores que NÃO PERGUNTAM (serviço puro) → assume `["presta_servico"]` automaticamente:** beleza_estetica, saude, servicos_empresas, educacao, hospedagem, bem_estar, servicos_locais

**Pergunta 1** — escolha única (filtrada por setor):
- Varejo: Revenda · Mix
- Alimentação/Indústria/Construção: Fabricação própria · Mix
- Logística: Distribuição · Mix
- (Sub) Farmácia/Pet/Automotivo: Revenda · Mix

**Pergunta 2** — multi-select com tradução leiga (só se "Mix"):
- "Revende produtos prontos" → `revenda`
- "Fabrica os próprios produtos" → `fabricacao`
- "Compra, beneficia e revende" → `produz_revende`
- "Faz distribuição/atacado" → `distribuicao`
- "Presta serviço junto com o produto" → `presta_servico`
- "Tem produto digital com mensalidade" → `saas`
- "Vende com modelo de assinatura" → `assinatura`
- "Atende governo" → `vende_governo`

### 2.5 Apresentação do valor — narrativa em 4 etapas (linhas 487-507)

Quando recebe resultado de `calcular_valuation_rapido`, IA segue OBRIGATORIAMENTE 4 mensagens separadas (ritmo WhatsApp):

```
ETAPA 1: "Pela minha experiência, [Nome], seu negócio vale em torno
         de R$ [CENTRAL_ARREDONDADO]."

ETAPA 2: "Pode variar entre R$ [MIN] e R$ [MAX] pela superficialidade
         dessa nossa conversa, mas não vai fugir muito disso."

ETAPA 3: "Esse seria o valor pro comprador assumir seus passivos
         (empréstimos, financiamentos) e seus ativos (estoque,
         equipamentos, contratos)."

ETAPA 4: "Pra fechar o número exato, faz o diagnóstico completo,
         é totalmente grátis: 1negocio.com.br/diagnostico — leva
         uns 5 minutos. Ou um consultor pode te explicar a
         Avaliação 1N aplicada com mais detalhe."
```

**Regras de arredondamento (obrigatórias, linhas 511-528):**
| Valor calculado | Como falar |
|---|---|
| < 50 mil | "uns X mil" arredondado pra dezena |
| 50-500 mil | "uns X mil" arredondado pra 50 |
| 500k-1M | "uns X mil" arredondado pra 100 |
| 1-10M | "uns X,Y milhões" |
| > 10M | "uns X milhões" |

Faixa min-max: arredondar AINDA mais ("entre 200 e 300 mil", "entre 800 mil e 1,1 milhão", etc).

**NUNCA** valor exato. **NUNCA** mencionar percentual de margem (15%, 30%) ao apresentar a faixa. **NUNCA** mencionar fórmula, múltiplo, EBITDA, DCF.

### 2.6 Regras absolutas — 30 NUNCAS (linhas 537-565)

```
1.  NUNCA escreva mensagens com mais de 200 caracteres.
2.  NUNCA use jargão em inglês: M&A, cashflow, EBITDA, DCF, WACC, deal,
    lead, churn.
3.  NUNCA mencione BuyCo, MeuBiz, Thiago, 1007, SócioX, FX Copilot.
4.  NUNCA invente resposta. Não sabe? Diz que vai conferir + WhatsApp humano.
5.  NUNCA invente dados sobre negócios — use APENAS o que vem da tool.
6.  NUNCA mencione idade / tempo de operação / anos de mercado.
7.  NUNCA dê conselho jurídico ou fiscal definitivo.
8.  NUNCA exponha dados de outros clientes.
9.  NUNCA prometa resultado de venda (tempo ou valor).
10. NUNCA revele a fórmula interna ou múltiplos.
11. NUNCA chame calcular_valuation_rapido sem ter os dados obrigatórios.
12. NUNCA chame calcular_valuation_rapido sem nome+telefone (se não logado).
13. NUNCA chame calcular_valuation_rapido sem ter passado pela CONFIRMAÇÃO.
14. NUNCA fure linha de corte do que pode falar sobre negócios publicados.
15. NUNCA empurre a avaliação pra alguém que não pediu.
16. NUNCA fale valor exato — sempre arredondamento agressivo.
17. NUNCA mencione percentual de margem ao apresentar a faixa.
18. NUNCA use abridores: "Claro!", "Com certeza!", "Fico feliz", "Ótima
    pergunta", "Excelente!", "Perfeito!".
19. NUNCA bloqueie a primeira pergunta da pessoa pra exigir nome antes.
20. NUNCA pergunte modelo_atuacao_multi pra setor de serviço puro —
    assume ["presta_servico"] automaticamente.
21. NUNCA confirme setor com opções alternativas na MESMA mensagem da
    inferência.
22. NUNCA chame marcar_interesse_socio_parceiro sem perfil de candidato.
23. NUNCA chame registrar_tese_investimento sem campos mínimos.
24. NUNCA exponha fórmulas, múltiplos exatos ou regras detalhadas da
    Metodologia 1N (proprietária).
25. NUNCA promete preço, nunca afirme "vale" ou "não vale".
26. NUNCA usa o termo "M&A" pra falar de você ou da plataforma.
27. NUNCA chama o programa Sócio-Parceiro de "anuidade" — é "Plano
    trienal".
28. SEMPRE que pessoa demonstrar interesse em negócio específico, CHAMA
    registrar_lead_interessado_ia.
29. NUNCA expõe campos sigilosos (nome real, sócios, CNPJ, endereço).
30. NUNCA chama consultar_negocio sem ter codigo OU negocio_id concreto.
```

### 2.7 Tom e estilo — regras críticas (linhas 121-160)

- **MENSAGENS CURTAS. SEMPRE.** Máximo 200 chars (1-2 frases). Se precisar mais, divide em mensagens sequenciais.
- **Texto corrido, sem listas, sem bullets, sem headers, sem emojis** (a não ser que a pessoa use primeiro).
- Pense **WhatsApp**, não e-mail.
- Cada bloco de informação = 1 mensagem.

### 2.8 Detecção de Sócio-Parceiro (linhas 191-244)

Triggers (qualquer um ativa o programa):
- **Profissão**: "sou corretor", "sou contador", "sou consultor empresarial", "sou despachante", "tenho assessoria", "trabalho com M&A", "presido associação comercial"
- **Negócio de terceiro**: "tenho cliente que quer vender", "meu amigo quer avaliar", "represento vendedor", "indico negócios", "tenho gente interessada em comprar"
- **Pergunta direta**: "como funciona pra parceiro?", "tem comissão por indicação?"

Ao detectar, segue sequência de 6 mensagens curtas (apresenta 2 formatos: Sócio formal R$ 5.346 trienal vs Parceiro pontual). Após capturar nome+telefone do interessado, chama `marcar_interesse_socio_parceiro`.

---

## 3. Tools (7 ferramentas) — `TOOLS = [...]` em chat-ia/index.ts:579

### 3.1 `calcular_valuation_rapido` (linha 580)

Calcula a estimativa rápida do negócio. SÓ chame quando tiver os dados obrigatórios E o lead estiver validado.

**Inputs:**
```js
{
  nome_negocio: string,
  cidade_uf: string,
  setor_code: enum [alimentacao, varejo, saude, bem_estar, educacao,
                    servicos_locais, servicos_empresas, industria,
                    logistica, construcao, hospedagem, beleza_estetica],
  modelo_atuacao_multi: array of [revenda, fabricacao, distribuicao,
                                  produz_revende, presta_servico,
                                  saas, assinatura, vende_governo],
  ativo_estoque: number,                  // 0 se não tiver
  faturamento_anual: number,              // já convertido se mensal
  sobra_anual: number,                    // lucro líquido anual
  ativos_relevantes: number,              // sem estoque
  dividas_total: number
}
```

**Cálculo (`calcularValuationRapido` linha 970):**
```js
multiplo_setor   = P.multiplos_setor[setor]              // de parametros_versoes
ajuste_forma     = calcAjusteFormaMultiSelect(formas, P.ajuste_forma_atuacao)
                   // principal vence, outras 30% × diff
multiplo         = max(0.5, multiplo_setor + ajuste_forma)

ativos           = ativos_relevantes + ativo_estoque
valor_operacional = sobra_anual × multiplo
valor_central    = valor_operacional + ativos − dividas

// Floor de proteção
if (valor_central < valor_operacional × 0.5 || valor_central < 0):
   valor_central = valor_operacional + ativos       // sem dívidas
   floor_aplicado = true

valor_min  = round(valor_central × 0.85)
valor_max  = round(valor_central × 1.15)
```

> Importante: usa o MESMO snapshot ativo (`parametros_versoes` v2026.11) que a skill v2 — mas **só** as chaves `multiplos_setor` + `ajuste_forma_atuacao`. Não calcula impostos, não calcula ISE, não considera margem operacional realista.

**Persistência após cálculo:** chama `persistirAvaliacao` (linha 1490) que faz INSERT/UPDATE em `chat_ia_leads` com:
- `dados_coletados`, `valuation_central/min/max`, `multiplo_aplicado`, `floor_aplicado`, `parametros_versao_id`, `setor_code`, `cidade_estado`, `faixa_faturamento`, `mensagens` (todo histórico), `usuario_id` (se logado).

### 3.2 `buscar_negocios` (linha 615)

Busca lista de negócios publicados no marketplace.

**Inputs (todos opcionais):**
```js
{
  codigo: string,         // 1N-AN-XXXXX (parcial)
  termo_busca: string,    // texto livre — ILIKE em titulo + descricao_card
  setor: enum [12 setores],
  cidade: string,
  estado_uf: string,
  valor_min: number,
  valor_max: number,
  ise_min: number,        // 60+ pra "sólidos", 75+ pra "atraentes"
  limite: number          // padrão 10, máx 20
}
```

**Função `buscarNegocios` (linha 845):**
- Query a `anuncios_v2` (status='publicado') com embed de `negocios` (setor, cidade, estado, score_saude, valor_1n, etc)
- ORDER BY publicado_em DESC
- Aplica todos os filtros via PostgREST
- `termo_busca` usa `.or('titulo.ilike.%X%,descricao_card.ilike.%X%')` — sanitiza removendo `%(),`
- Retorna `{ total_encontrado, resultados[], nota_assistente }` com 14 campos públicos por anúncio

**Regra do system prompt (linhas 250-268):** sempre que pessoa descrever negócio sem código, extrair termos e filtros estruturados:
- "padaria em SP até R$ 500k" → termo='padaria', estado_uf='SP', valor_max=500000
- "consultoria estabelecida no Rio" → termo='consultoria', cidade='Rio de Janeiro'

**Comportamento quando retorna 0 (linhas 285-302):** ofereço registrar `tese_investimento` em vez de só dizer "não tem".

### 3.3 `consultar_negocio` (linha 645)

Detalhes de UM anúncio específico (camada 1 — pública).

**Inputs:** `codigo` OU `negocio_id` (UUID).

**Retorna** (linha 916):
- codigo, negocio_id, titulo, descricao
- setor, cidade, uf, faturamento_anual_faixa
- valor_pedido
- avaliacao_1n: {central, min, max, multiplo_setor_label}
- ise: {total, classe}
- margem_operacional_pct
- url canônica
- `nota_assistente`: lembra IA dos limites de sigilo

**NÃO retorna:** nome real, sócios, CNPJ, endereço exato. Filtro por whitelist de campos no SELECT (não SELECT *).

### 3.4 `consultar_laudo_publico` (linha 656)

Conteúdo editorial público (camada 1) do laudo de UM negócio.

**Inputs:** `negocio_id` ou `codigo`.

**Retorna** (linha 970):
- ise_breakdown: total, classe, **8 pilares com label/peso/score**
- valuation: valor_venda, valor_operacao, multiplo_setor_label
- indicadores_camada1: margem_operacional_pct, ro_anual, classe_ise
- textos_publicos: titulo, descricao_card, abertura_editorial, tese_aquisicao_publica, riscos_atencao_publica, contexto_setor, contexto_localizacao
- nota_assistente

**NÃO retorna camadas 2 ou 3.**

### 3.5 `registrar_lead_interessado_ia` (linha 667)

Registra evento de interesse num negócio específico. Tabela: `leads_interessado_ia`.

**Inputs:**
```js
{
  negocio_id: string,        // preferencial
  codigo: string,            // alternativa
  contexto_conversa: string, // OBRIGATÓRIO — resumo curto do que rolou
  nome: string,              // só se NÃO logado
  telefone: string           // só se NÃO logado
}
```

**Comportamento (linha 1059):**
- Se `usuarioLogado.id` presente → grava com `usuario_id`, copia `nome` e `whatsapp` do perfil, `silencioso=true`
- Se NÃO logado → exige `nome+telefone`, normaliza pra +55DDDXXXXXXXXX, `silencioso=false`

**System prompt (linhas 252-268)** instrui:
- Logado: chama silenciosamente DEPOIS de `consultar_negocio`/`consultar_laudo_publico`. Não pede nada, conversa flui.
- Não logado: responde primeiro sobre o negócio (1-2 mensagens), depois pede "Pra te conectar com mais detalhes desse negócio, preciso de seu nome e telefone. Pode passar?". Quando recebe, chama. Confirma "Anotado! Um consultor da 1Negócio vai entrar em contato em breve."

### 3.6 `registrar_tese_investimento` (linha 682)

Registra tese de comprador interessado quando `buscar_negocios` retorna 0 OU quando ele quer ser avisado de novos. Tabela: `teses_investimento`.

**Inputs (required: nome, whatsapp, tese_descricao, valor_investimento, setores):**
```js
{
  nome, whatsapp, email,
  tese_descricao,           // texto livre
  valor_investimento,       // R$
  setores: array of 12 setores (códigos longos),
  estado, cidade,
  formas_atuacao: array,
  descricao_adicional
}
```

**Função `registrarTeseInvestimento` (linha 763):** mapeia setores longos → curtos (`MAPA_SETORES_LONGO_PRA_CURTO` linha 729) antes de gravar.

### 3.7 `marcar_interesse_socio_parceiro` (linha 715)

Marca lead atual como interessado no programa Sócio-Parceiro. Atualiza `chat_ia_leads.tag_interesse`/`perfil_relatado`/`interesse_relatado`.

**Inputs (required: nome, whatsapp, perfil_relatado):**
```js
{
  nome, whatsapp,
  perfil_relatado: string,    // "corretor de imóveis", "contador", etc
  interesse_relatado: string  // o que ela disse que quer fazer
}
```

Use SOMENTE quando perfil de candidato foi revelado E programa foi apresentado E pessoa demonstrou interesse.

### 3.8 Roteamento das tools no backend (chat-ia/index.ts:1217-1244)

```js
if (toolUseBlock) {
  if      (name === 'calcular_valuation_rapido')      { ... → persistirAvaliacao }
  else if (name === 'buscar_negocios')                { → buscarNegocios }
  else if (name === 'consultar_negocio')              { → consultarNegocio }
  else if (name === 'consultar_laudo_publico')        { → consultarLaudoPublico }
  else if (name === 'registrar_lead_interessado_ia')  { → registrarLeadInteressadoIa }
  else if (name === 'registrar_tese_investimento')    { → registrarTeseInvestimento }
  else if (name === 'marcar_interesse_socio_parceiro'){ → marcarInteresseSocioParceiro }

  // SEGUNDA chamada Anthropic com tool_result → reply final
}
```

---

## 4. Modelo de IA e parâmetros

```
MODEL       = 'claude-sonnet-4-20250514'      // chat-ia/index.ts:9
MAX_TOKENS  = 1500                             // chat-ia/index.ts:10
SYSTEM      = SYSTEM_PROMPT (~30k chars)
TOOLS       = TOOLS (7 ferramentas)
TEMPERATURE = (default Anthropic, não setado)
```

**Cada round de conversa custa:**
- ~14.500 tokens input (system + histórico)
- ~500-1.500 tokens output
- Se houver tool_use: 2× chamadas Anthropic na mesma request

**Org limit experimentado nesta sessão:** 30k tokens/min — cabem ~2 mensagens/min antes de hit rate limit.

---

## 5. Fluxo do widget (chat-ia.js)

### 5.1 Constantes (chat-ia.js:1-12)

```js
API_ENDPOINT     = 'https://dbijmgqlcrgjlcfrastg.supabase.co/functions/v1/chat-ia'
ANON_KEY         = (anon JWT do Supabase)
LEAD_ASK_AFTER_MIN = 3       // pede WhatsApp depois de 3-5 mensagens da IA
LEAD_ASK_AFTER_MAX = 5
```

### 5.2 Estado in-memory (chat-ia.js:39)

```js
state = {
  isOpen, isTyping,
  messages: [],
  perfil, subPerfil,
  leadCaptured, leadId,
  lead: { nome, whatsapp },
  qualificationDone, nameAsked, nameCollected,
  phoneTriggerCount,         // sorteado entre LEAD_ASK_AFTER_MIN/MAX
  assistantMsgCount,
  phoneCaptureAsked,
  phoneCollectionMode,
  phoneRetryCount
}
```

### 5.3 Validação de telefone (chat-ia.js:48 — `validarTelefoneBR`)

Após melhoria A1:
```js
1. limpa não-dígitos
2. remove DDI 55 se vier (numero.length === 13)
3. EXIGE 11 dígitos exatos     (rejeita 10 = fixo)
4. EXIGE DDD entre 11-99
5. EXIGE 9º dígito após DDD === '9'  (celular brasileiro)
→ retorna '+55' + numero ou null
```

### 5.4 Validação WhatsApp via Z-API (chat-ia.js:27 — `validarWhatsApp`)

```js
async function validarWhatsApp(telefone) {
  // POST /functions/v1/zapi-relay
  // body: { action: 'phone-exists', phone: telefone }
  // timeout 3s via AbortController
  // retorna: true | false | null (erro/timeout)
}
```

**Comportamento no handleSend (chat-ia.js:259-301):**
1. `validarTelefoneBR(text)` — formato OK?
2. Se sim, mostra typing + chama `validarWhatsApp`
3. Se `exists === false` E `phoneRetryCount < 2` → "Hmm, esse número não parece ter WhatsApp ativo. Pode confirmar ou me passar outro?"
4. Se `exists === true` OU `null` (Z-API offline/timeout) OU já tentou 2x → salva lead + confirma "Anotado! Um consultor da 1Negócio vai entrar em contato em breve."

### 5.5 Captura de nome+WhatsApp — gate antes do cálculo

Sequência obrigatória (definida no system prompt linhas 461-471):
1. Coleta os 9 dados em conversa fluida
2. Se ainda não tem nome+telefone (não logado): pede primeiro
3. Confirmação dos dados (resumo)
4. Espera OK explícito
5. CHAMA `calcular_valuation_rapido`

Se pessoa relutar em dar telefone: "Sem o WhatsApp não consigo te entregar o resultado nem te ajudar com o diagnóstico completo depois. Pode mandar?"

### 5.6 Disparo automático de pedido de WhatsApp (chat-ia.js:312-315)

```js
// após sendToBackend retornar reply:
state.assistantMsgCount++;
if (state.nameCollected && !state.phoneCaptureAsked && !state.leadCaptured
    && state.assistantMsgCount >= state.phoneTriggerCount) {
  state.phoneCaptureAsked = true;
  setTimeout(askForPhone, 1200);
}
```

`askForPhone` (linha 322) mostra um card com 2 botões: "Continuar no WhatsApp" (chama `openWhatsApp` linha 487 — `wa.me/5511952136406`) ou "Agora não".

### 5.7 Escalação para humano (chat-ia.js:497-501)

```js
fetch(API_ENDPOINT, {
  body: JSON.stringify({
    action: 'escalate',
    messages: state.messages,
    lead_data: { lead_id: state.leadId, motivo: 'usuario_pediu_whatsapp' }
  })
})
```

Backend (chat-ia/index.ts:1560 — `escalateLead`): UPDATE em `chat_ia_leads` com `escalacao_pendente=true`, `escalacao_motivo=...`, e INSERT em `chat_ia_leads_pendentes` (fila de atendimento humano).

---

## 6. Persistência — tabelas envolvidas

### 6.1 `chat_ia_leads` (33 colunas)

Lead principal por sessão de chat. INSERT no primeiro nome capturado, UPDATE conforme conversa avança.

| Grupo | Colunas |
|---|---|
| Identificação | `id`, `nome`, `whatsapp`, `email`, `usuario_id` (FK usuarios), `perfil`, `sub_perfil` |
| Contexto | `mensagens` (jsonb — histórico inteiro), `resumo_conversa` (string últimas 4 msgs), `pagina_origem`, `user_agent`, `ip_hash` |
| Setor/negócio | `setor_mencionado`, `setor_code`, `faixa_faturamento`, `cidade_estado` |
| Valuation | `dados_coletados` (jsonb), `valuation_central/min/max`, `multiplo_aplicado`, `parametros_versao_id`, `floor_aplicado`, `status_coleta` |
| Sócio-parceiro | `tag_interesse`, `perfil_relatado`, `interesse_relatado` |
| Atendimento | `escalacao_pendente`, `escalacao_motivo`, `atendido_em`, `atendido_por` |
| Timestamps | `created_at`, `updated_at` |

### 6.2 `chat_ia_leads_pendentes` (11 colunas)

Fila de leads aguardando atendimento humano (após escalate). Subset desnormalizado de `chat_ia_leads` + `minutos_esperando`.

### 6.3 `leads_interessado_ia` (11 colunas)

Eventos de interesse específico em UM negócio (após `consultar_negocio` ou `consultar_laudo_publico`).

```
id, nome, telefone, usuario_id, negocio_id (FK), contexto_conversa,
origem ('chat_ia'), status ('novo'/'contatado'/'convertido'/'descartado'),
criado_em, contatado_em, notas_admin
```

RLS: anon BLOCKED em SELECT e INSERT (só service_role da edge function escreve).

### 6.4 `teses_investimento` (~22 colunas)

Tese de comprador (após `registrar_tese_investimento`).

```
nome, email, whatsapp, status, tese_descricao, valor_investimento,
estado, cidade, localizacao_tipo, setores[], formas_atuacao[],
descricao_adicional, codigo, notas_admin, usuario_id, filiado_codigo,
utm_source/medium/campaign/content, observacoes
```

---

## 7. Edge functions relacionadas

### 7.1 `chat-ia` (1.595 linhas)

Endpoint: `POST /functions/v1/chat-ia` — `verify_jwt = true` (anon JWT obrigatório).

**Roteamento por `body.action`:**
- `"save_lead"` → `saveLead` (linha 1494) → INSERT/UPDATE chat_ia_leads
- `"escalate"` → `escalateLead` (linha 1560)
- default → conversação com Anthropic

### 7.2 `zapi-relay`

Endpoint: `POST /functions/v1/zapi-relay` — `verify_jwt = false`.

Suporta 2 actions:
1. **`'phone-exists'`** — valida se número tem WhatsApp ativo via Z-API:
   ```
   GET https://api.z-api.io/instances/{INSTANCE}/token/{TOKEN}/phone-exists/{phone}
   header: client-token: {ZAPI_CLIENT_TOKEN}
   → retorna { exists: boolean }
   ```
2. **default** (sem action) — envia mensagem de WhatsApp:
   ```
   POST https://api.z-api.io/instances/{INSTANCE}/token/{TOKEN}/send-text
   body: { phone, message }
   ```

Secrets necessários: `ZAPI_INSTANCE`, `ZAPI_TOKEN`, `ZAPI_CLIENT_TOKEN`.

### 7.3 `gerar_textos_laudo` e `gerar_textos_anuncio`

NÃO são parte do chat IA, mas:
- `gerar_textos_laudo` é disparada após o diagnóstico salvar `laudos_v2` (9 textos paralelos via Anthropic)
- `gerar_textos_anuncio` gera os 7 textos pós-card do anúncio
- Ambas usam o snapshot ativo de `parametros_versoes` para prompts e regras editoriais

---

## 8. Diferença entre o widget Chat IA e o `diagnostico.html`

Importante distinguir os dois pipelines:

| Aspecto | Chat IA (widget) | diagnostico.html |
|---|---|---|
| **Onde** | Pop-up flutuante | Página dedicada (61 telas) |
| **Quando** | Qualquer hora (sessão livre) | Quando vendedor decide avaliar |
| **Dados coletados** | 9 campos (versão simplificada) | ~50+ campos (versão completa) |
| **Cálculo** | `calcularValuationRapido` (multiplo_setor + ajuste_forma + sobra × multiplo + ativos − dividas, com floor) | `AVALIADORA_V2.avaliar` — pipeline completo (DRE 5 blocos · balanço · ISE 8 pilares · valuation · atratividade · tributária · indicadores · upsides) |
| **Output** | Faixa de valor (min/central/max) — só estimativa | `calc_json` completo persistido em `laudos_v2` |
| **Persistência** | `chat_ia_leads.dados_coletados` | `negocios.dados_json` + `laudos_v2.calc_json` |
| **Renderização** | Conversa em prosa | `laudo-completo.html` (gratuito) / `laudo-pago.html` / `laudo-admin-v2.html` |
| **Função** | Gerar lead e fisgar | Entregar laudo oficial |

O system prompt do chat IA explicitamente direciona pra fazer o diagnóstico completo (etapa 4 da apresentação do valor).

---

## 9. Versões e snapshots

### 9.1 Versões do `chat-ia.js` (widget)

Arquivo header (linha 1):
```
Chat IA 1NEGÓCIO - Widget
Versao 2.8 - 2026-05-01
v2.8: tool calling valuation rápido + JWT logado + validação telefone BR
```

Versões do edge function `chat-ia` (Supabase):
- v25 — primeiro deploy com brain dump (Áreas 1, 2, 3A — em 2026-05-02)
- v26 — adicionou tools de consulta + leads_interessado_ia (Áreas 3B, 3C)
- **v27 (atual)** — 5 ajustes A+B+C: DDD obrigatório · pergunta lucro detalhada · narrativa 4 etapas · termo_busca textual · validação WhatsApp Z-API

### 9.2 Snapshot de parâmetros

Mesmo `parametros_versoes` da skill v2: `v2026.11-pool-9-categorias` (ativo).
- Chat IA usa apenas: `multiplos_setor` + `ajuste_forma_atuacao`.

---

## 10. Histórico de mudanças importantes (sessão atual)

| Data/versão | O que mudou |
|---|---|
| chat-ia v25 | Brain dump 11 seções aplicado (substituiu prompt antigo) · removeu menções a "anuidade" / "M&A" / "50% comissão" |
| chat-ia v25 | Caminho C aplicado: pergunta de modelo (4 opções primárias + multi-select se "mix" com tradução leiga) |
| chat-ia v25 | Pergunta de estoque condicional (só setor produto físico) |
| chat-ia v26 | +3 tools de consulta (`consultar_negocio`, `consultar_laudo_publico`, `registrar_lead_interessado_ia`) |
| chat-ia v26 | `buscar_negocios` ganhou `ise_min` e `negocio_id` no retorno |
| chat-ia v26 | Migration `leads_interessado_ia` criada com RLS bloqueando anon |
| chat-ia v27 | A1 — DDD obrigatório (11 díg + 9º dígito celular) |
| chat-ia v27 | A2 — Pergunta sobre lucro detalhada (pró-labore + parcelas + atrasados + investimentos) |
| chat-ia v27 | A3 — Apresentação do valor em 4 etapas narrativas |
| chat-ia v27 | B — Busca textual `termo_busca` (ILIKE titulo+descricao) |
| chat-ia v27 | C — Validação WhatsApp via Z-API (action `phone-exists`, timeout 3s, 2 retries) |
| index.html | Bubble welcome carrossel implementado e DEPOIS removido (decisão UX por sobriedade) |

---

## 11. Pendências e ⚠️ encontrados

### 11.1 Calc rápido vs skill v2 — divergência intencional

`calcularValuationRapido` (linha 970 chat-ia/index.ts) **NÃO** roda a skill v2. Usa fórmula simplificada:
- Não calcula impostos
- Não calcula encargos CLT
- Não calcula ISE
- Não calcula margem operacional
- `sobra_anual` direto do usuário × multiplo_setor + ativos − dividas

⚠️ Significa que a estimativa do chat IA pode divergir 20-40% do laudo final (que usa skill v2 completa). É funcional como "estimativa rápida" mas o usuário pode comparar e estranhar.

### 11.2 Redirect pra diagnóstico não tem deep-link

O system prompt direciona pra `1negocio.com.br/diagnostico`, mas não passa contexto da conversa pra pré-preencher o diagnóstico. ⚠️ User começa do zero.

### 11.3 Detecção de usuário logado depende de JWT no body

`detectarUsuarioLogado(jwt)` (chat-ia/index.ts:1330) só funciona se o frontend enviar o JWT do usuário. Em ambientes onde o JWT não é mandado (ou expira), o usuário aparece como não-logado e a IA pede nome/telefone novamente. ⚠️ A tela inicial do chat-ia.js precisa ler/passar o JWT corretamente.

### 11.4 Rate limit da Anthropic

Org tem limite ~30k tokens/min. Como o system prompt é 14.5k, cabem só ~2 mensagens/min antes de hit do rate limit. ⚠️ Em teste hoje, vimos isso quebrar o fluxo. Em produção, raramente afeta um usuário individual mas pode afetar atendimentos em paralelo.

### 11.5 Tools que requerem o `usuarioLogado` mas não validam estritamente

`registrar_lead_interessado_ia` permite chamada sem `nome+telefone` quando logado. Se o JWT não está presente mas a IA achou que estava (caso de bug raro), pode salvar lead null. ⚠️ Validação dupla aconselhada.

### 11.6 Mensagens de erro genéricas no front

`sendToBackend` (chat-ia.js:316-319) tem fallback "Tive um probleminha pra responder agora. Tenta de novo em instantes." que NÃO distingue entre rate limit, erro 500, JWT inválido, etc. ⚠️ Difícil debugar via user-side.

### 11.7 Z-API timeout de 3s pode ser curto

Se Z-API tá lenta (>3s), `validarWhatsApp` retorna `null` e o lead é salvo SEM validação. Não bloqueia mas reduz qualidade do dado. ⚠️ Considerar 5-7s como timeout, ou retry com fallback.

### 11.8 Bubble welcome — REMOVIDO

Foi implementado em 03/05/2026 e depois removido na mesma sessão. Razão: "pode atrapalhar a vibe sóbria/técnica que a 1Negócio quer transmitir". Não está em produção. ⚠️ Há um `sessionStorage.n1BubbleShown` residual em browsers de quem visitou nesse intervalo — inerte (nada lê mais).

### 11.9 `n1-welcome-bubble` (bubble antigo do chat-ia.js)

A função `showWelcomeBubble` (chat-ia.js:191) ainda existe e mostra bubble de 1 frase fixa "Hey, qualquer duvida estou por aqui!" 2s após init. Funciona em `/diagnostico` mas é escondido por CSS na home. ⚠️ Considerar remover se o welcome carrossel da home ficou descontinuado.

---

## 12. Resumo executivo

```
VARIANTE 1: WIDGET CHAT IA (pop-up flutuante)
   ├─ Front: chat-ia.js (sessão localStorage, FAB no canto da tela)
   ├─ Back:  edge function chat-ia (Anthropic Sonnet 4 + 7 tools)
   ├─ Prompt: 30k chars, 15 seções (brain dump 11 sub-seções +
   │           princípios + tools + coleta 9 dados + narrativa 4
   │           etapas + 30 NUNCAS)
   ├─ Calc:   calcularValuationRapido (simplificado — usa só
   │           multiplos_setor + ajuste_forma_atuacao do snapshot)
   ├─ Tools:  calcular_valuation_rapido, buscar_negocios,
   │          consultar_negocio, consultar_laudo_publico,
   │          registrar_lead_interessado_ia, registrar_tese_investimento,
   │          marcar_interesse_socio_parceiro
   ├─ Validação telefone: 11 díg + DDD válido + 9º díg celular
   ├─ Validação WhatsApp: zapi-relay action='phone-exists'
   └─ Persiste: chat_ia_leads (lead principal),
                leads_interessado_ia (eventos de interesse),
                teses_investimento (compradores),
                chat_ia_leads_pendentes (escalação humana)

VARIANTE 2: DIAGNÓSTICO COMPLETO (página dedicada)
   ├─ /diagnostico.html (61 telas)
   ├─ Roda AVALIADORA_V2 (skill-avaliadora-v2.js — 3.002 linhas)
   ├─ Persiste: negocios.dados_json + laudos_v2.calc_json
   └─ Detalhado em ESPEC-AVALIACAO-ATUAL.md

INTEGRAÇÕES
   ├─ Anthropic API (claude-sonnet-4-20250514)
   ├─ Z-API (validação WhatsApp + envio de mensagens)
   └─ Supabase (Auth + tabelas + RLS + edge functions)
```

A IA é **agente conversacional + ferramenta de qualificação de lead**. Não substitui o diagnóstico — direciona pra ele. Toda decisão valorativa termina com sugestão de consultor 1Negócio. Princípio central: "PODE dar opinião, NUNCA prometer preço".
