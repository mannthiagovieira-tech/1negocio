# 1Negócio · Handoff de fim de sessão — 28/04/2026

Sessão de trabalho intensa de ~9 horas no `backend-v2`. Documento serve de ponte para próxima sessão.

## ESTADO ATUAL DAS 9 FASES DA SPEC

| Fase | Descrição | Status |
|---|---|---|
| 1 | Banco e parâmetros | ✅ Migrations criadas (não aplicadas — Decisão #21) |
| 2 | Skill avaliadora v2 | ✅ Concluída (snapshot v2026.07) |
| 3 | Frontend dos laudos | 🟡 60% — laudo-admin e laudo-pago prontos |
| 4 | 5 Edge Functions IA | ⏸️ Não iniciada |
| 5 | Diagnóstico v2 | ⏸️ Não iniciada |
| 6 | Index público | ⏸️ Não iniciada |
| 7 | Painel admin (aba Parâmetros) | ⏸️ Não iniciada |
| 8 | Selic watcher | ⏸️ Não iniciada |
| 9 | Validação Forste + 2-3 negócios | ⏸️ Não iniciada |

## O QUE FOI FEITO HOJE

### Fase 2 — Skill v2026.07 fechada

Refactor completo da skill-avaliadora-v2.js cobrindo:

- Catálogo de 21 upsides parametrizado em `parametros_versoes.upsides_catalogo`
- agregarPotencial12mV2 com 4 lógicas (ro_direto, multiplo_aumento, passivo_direto, qualitativo_sem_calculo) + 3 caps (categoria, ISE, absoluto) + tributário separado fora dos caps
- Bug B do crescimento_pct corrigido (distingue 0 deliberado de 0 ausente)
- Ramo fantasma do fat_anterior removido
- 6 fantasmas de sub-métricas tratados com proxies reais (P1, P2 removida, P6×2, P8×2)
- Fix gap fator_ise (Math.round antes do lookup)
- Componente Crescimento da Atratividade reformulado: usa crescimento_pct histórico, removeu uso de crescimento_proj_pct (Regra 2 — projeção do vendedor não entra em score)
- Schema do calc_json reorganizado com novo bloco potencial_12m, novo bloco recomendacoes_pre_venda, upsides como objeto {ativos, paywalls}
- 5 fixtures de teste versionados em validacao/skill-fixtures/

### Fase 3 — Laudo-admin refatorado

Laudo-admin.html completamente refatorado pro schema novo:

- Strings de fonte_crescimento atualizadas (historico_real, sem_resposta)
- SUBMET_ORIGEM_MAP atualizado v2026.07 (chaves stale removidas)
- Tag de status do negócio + datas (D-I sem log de eventos)
- renderUpsidesAdmin com {ativos, paywalls} + categorias técnicas + labels human-readable
- Nova seção POTENCIAL 12M com pills de tributário dominante + obs economia=0 + tabelas
- Sub-bloco "Qualitativos / Pré-venda" em UPSIDES
- renderOndeAparece atualizado com sec-potencial-12m
- Skill expõe _modo no calc_json
- Notinha explicativa "↑ ganho estimado no valor de venda" nos cards de upside monetários
- Bug visual "Consolidac" cortado corrigido
- Tag "DEMO" elegante no header
- Toggle dark/light theme via CSS variables

### Fase 3 — Laudo-pago refatorado (segunda peça da Fase 3)

Refactor completo do laudo-pago.html pro schema v2026.07:

- REVAMP renderUpsides com {ativos, paywalls} + categorias técnicas + valor R$ no card + ordem por R$ decrescente
- Fix campo morto valor_potencial_12m → potencial_12m.potencial_final.valor_projetado_brl
- Fallback _versao_parametros 'v2026.04' → '—' (não hardcodar versão)
- Texto introdutório em UPSIDES
- Toggle dark/light com CSS variables, default LIGHT (impressão amigável)
- DEMO_DATA regenerado via fixture forste-completo.js
- laudo-completo.html legado deletado (rollback via tag backup-pre-v2-2026-04-28)

6 bugs críticos pré-existentes corrigidos (forEach em objeto, contadores antigos, DEMO_DATA velho, etc).

Decisões aprovadas:
- D-1: Default light, toggle dark opcional
- D-2: Paywalls como "Análise complementar" (cliente já pagou, sem termo "bloqueado")
- D-3: Ordem cards por R$ decrescente
- D-4: laudo-completo.html deletado no commit final
- D-5: Fallback usa '—' em vez de versão hardcoded
- D-6: DEMO_DATA regenerado via fixture

Mapeamento documentado em relatorios/2026-04-28-mapeamento-laudo-pago.md.

Commits: 3ccdf8b → e2e94a0 → 78eb37f → 92c451a → 3dd762e → b62bb16

### Outros

- Tag de segurança Git: backup-pre-v2-2026-04-28 apontando para origin/main (commit d8faa8e)
- Pendências arquiteturais registradas em relatorios/

## 5 EVOLUÇÕES APROVADAS QUE PRECISAM VIRAR SPEC REV3

A sessão de hoje produziu 5 evoluções sobre a spec-v2-final-rev2.md que precisam ser incorporadas em uma rev3:

### Evolução 1 — Componente Crescimento da Atratividade

Spec rev2 (linha 446-448): usa D.crescimento_proj_pct com peso 25%.
Decisão sessão 28/04: usa D.crescimento_pct (histórico) com peso 25%. Quando ausente, score 3.

Razão: projeção do vendedor não pode informar valuation (Regra 2 definida pelo Thiago).

### Evolução 2 — Categorias técnicas dos upsides

Spec rev2 (linha 609): 5 categorias = obrigatorio, ganho_rapido, estrategico, transformacional, bloqueado.
Decisão sessão 28/04: 5 categorias = ro, passivo, multiplo, qualitativo, paywall.

Razão: as categorias antigas eram do tipo "produto" (impacto comercial percebido). As novas são técnicas (mecanismo matemático no valuation). Mais auditável e parametrizável.

### Evolução 3 — Bloco potencial_12m

Spec rev2 não tem bloco dedicado. Cada upside tinha impacto_no_valuation { min_pct, max_pct } sem agregação.

Decisão sessão 28/04: bloco potencial_12m completo com:
- tributário separado (fora dos caps)
- agregação por categoria (ro, passivo, multiplo) com bruto + capped
- 3 caps em sequência (categoria → ISE → absoluto)
- potencial_final em pct e brl
- valor_projetado_brl

Razão: descobrimos que +123% no Forste era fantasia matemática sem caps. Os 3 caps protegem contra fantasia.

### Evolução 4 — Bloco recomendacoes_pre_venda

Spec rev2 não tem.

Decisão sessão 28/04: array dedicado com {id, label, mensagem} para ações qualitativas que não geram contribuição monetária mas são pré-requisitos (separar PF/PJ, documentar processos, etc).

### Evolução 5 — Subdivisão upsides: { ativos, paywalls }

Spec rev2: array único com categoria 'bloqueado' marcando paywalls.
Decisão sessão 28/04: objeto { ativos[], paywalls[] }.

Razão: organização de rendering. Não muda metodologia.

## PENDÊNCIAS ARQUITETURAIS REGISTRADAS

Documentadas em relatorios/ (não bloqueiam, atacar quando relevante):

1. Camada de normalização do D — único ponto de mapeamento diagnóstico↔skill (4-6h, atacar pós-merge)
2. Log de eventos do negócio + invalidação textos IA — atacar junto com Edge Functions IA (Fase 4)
3. Modelo rico de upsides — Thiago descreveu modelo com ganho de caixa (economia mensal × 12) + ganho de avaliação (RO_novo × Fator_novo) + qualitativos amplificando via ISE. Spec rev3 deve registrar isso. Implementação 8-12h, prioridade pós-Fase 3.
4. Limpeza case-collision em _arquivo/ — git rm --cached arquivos duplicados (5 min, sem urgência)
5. pg_dump completo do banco — fazer antes do merge backend-v2 → main (não agora)

## O QUE FALTA EM CADA FASE

### Fase 3 (continuar)

- laudo-gratuito.html — criar do zero, versão pública. Subset do calc_json sem dados sensíveis. Estimativa: 2h.
- negocio.html v3 — página pública do anúncio com 2 níveis (antes/depois NDA). Decisão #16 textos anônimos. Estimativa: 3-4h.

### Fase 4 — 5 Edge Functions IA

Decisão #15: gerar 7 textos analíticos no commit do laudo + 3 textos comerciais na criação do anúncio.

- gerar_textos_laudo (chamado quando laudo é commitado)
- gerar_textos_anuncio (chamado quando anúncio é criado)
- regerar_texto_individual (botão admin pra regerar 1 texto específico)
- cron_textos_pendentes (worker pra reprocessar status='pendente_geracao')
- selic_watcher (cron BCB diário, alerta admin se Selic mudou >0.5pp)

### Fase 5 — Diagnóstico v2

Decisão #18: cálculos centralizados na skill. T28, T29, T31, T44 chamam funções da skill em vez de duplicar lógica.

Inclui também:
- Fix vendedor_id no salvarNegocioDB (P0 #2 do backlog antigo)
- Adicionar D.impostos_atrasados como campo numérico (T39a)
- T44 v2 (preview da avaliação)

### Fase 6 — Index público

- Conectar home ao Supabase (substituir DATA = [...] hardcoded)
- Substituir negocios.descricao por texto_resumo_executivo_anonimo (Decisão #16)
- Filtros e ordenação reais

### Fase 7 — Painel admin

- Aba Parâmetros pra editar parametros_versoes via UI
- Edição completa do negócio (modal com todos os campos)
- Botão regerar textos IA

### Fase 8 — Selic watcher

Cron diário consultando BCB API, alerta admin via WhatsApp/email se Selic mudou significativamente.

### Fase 9 — Validação

Rodar Forste real (1N-RZHUYL) na skill v2 + abrir laudo-admin com ?id=1N-RZHUYL para validação visual + testar com 2-3 negócios adicionais antes do merge.

## PROCESSO RECOMENDADO PRA PRÓXIMA SESSÃO

ANTES DE QUALQUER AÇÃO TÉCNICA, na próxima sessão:

1. Ler integralmente este handoff
2. Ler spec-v2-final-rev2.md (1.621 linhas — é o documento mestre)
3. Ler backlog-1negocio-27abr2026.md
4. Confirmar com Thiago: "Li os 3 documentos. Estamos na Fase X, próximo passo é Y. Confirma?"

Sem confirmar essa leitura, qualquer trabalho técnico tem risco de desalinhamento (foi exatamente o que aconteceu na sessão de hoje).

NÃO INVENTAR PROCESSO ORGANIZACIONAL paralelo (frentes, modos cruzeiro, etc). Usar nomenclatura da spec: Fase 1, Fase 2, etc.

NÃO PRESSIONAR pra rodar pg_dump nem aplicar migrations. Decisão #21 é clara: estratégia paralela, sem destruição durante desenvolvimento.

## SUGESTÃO DE PRÓXIMOS PASSOS

Em ordem:

1. Validação visual final do laudo-admin com Forste sintético (DEMO_DATA já regenerado)
2. Atualizar spec rev2 → rev3 incorporando as 5 evoluções aprovadas
3. Atacar Fase 3: começar pelo laudo-gratuito (subset do laudo-pago, mais enxuto, com paywalls bloqueados)
4. Em paralelo: redesign visual do Claude do design (se Thiago quiser começar essa frente)
5. Quando Fase 3 estiver completa, atacar Fase 4 (Edge Functions IA)

Estimativa pra fechar v2 completa: 15-20h focadas adicionais.

## DÍVIDA TÉCNICA REGISTRADA NESTA SESSÃO

- DEMO_DATA hardcoded inline nos arquivos de laudo (laudo-admin.html e laudo-pago.html). Cada arquivo tem ~600+ linhas de DEMO_DATA. Em futuro, mover pra arquivo separado tipo demo-data.js importado pelos laudos. Não bloqueia, é polimento.

- chartProgressao SVG no laudo-pago tem cores hardcoded que não adaptam totalmente ao tema dark. Polimento futuro. Documentado no commit 92c451a.

- Breakdown detalhado dos upsides nos cards (laudo-pago e laudo-admin). Hoje cards mostram apenas o ganho no valor de venda. Caminho A (skill expor breakdown por categoria) registrado em relatorios/2026-04-29-pendencia-breakdown-upsides.md. Custo: 4.5-5.5h. Atacar pós-Fase 3.
