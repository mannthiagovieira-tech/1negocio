# 1Negócio · Spec calc_json v2 — Revisão 3
**Substitui rev2. Incorpora 8 evoluções das sessões 28-29/04/2026 (validação + implementação).**
*29/04/2026*

> **Histórico:** rev1 (parcial), rev2 (27/04/2026, 1621 linhas, 20 decisões),
> **rev3** (29/04/2026, +5 decisões = 25, novo bloco potencial_12m, novo bloco
> recomendacoes_pre_venda, upsides reorganizados como `{ativos, paywalls}`,
> componente Crescimento usando histórico em vez de projeção, categorias
> técnicas dos upsides, regras de exibição padronizadas pra cards).

---

## MUDANÇAS DESTA REVISÃO

### Evolução 1 — Componente Crescimento da Atratividade usa histórico
**Antes (rev2 §3.8):** `score_crescimento` lia `D.crescimento_proj_pct` (projeção do vendedor).
**Agora (rev3 §3.8):** lê `D.crescimento_pct` (histórico). Quando ausente, score 3 (penalidade leve, sem fingir score neutro).
**Razão:** projeção do vendedor não pode informar valuation (Regra inviolável: Coisa A não informa Coisa B). Decisão #21.

### Evolução 2 — Categorias técnicas dos upsides
**Antes (rev2 §3.13):** 5 categorias produto-style: `obrigatorio`, `ganho_rapido`, `estrategico`, `transformacional`, `bloqueado`.
**Agora (rev3 §3.13):** 5 categorias técnicas: `ro`, `passivo`, `multiplo`, `qualitativo`, `paywall`.
**Razão:** categorias técnicas refletem mecanismo matemático no valuation (`ro` = aumenta resultado operacional, `passivo` = reduz dívida etc). Mais auditável e parametrizável que produto-style. Decisão #22.

### Evolução 3 — Bloco `potencial_12m` agregado com 3 caps
**Antes (rev2):** cada upside tinha `impacto_no_valuation { min_pct, max_pct }` sem agregação.
**Agora (rev3 §3.16):** bloco `potencial_12m` completo com tributário separado (fora dos caps), agregação por categoria (ro/passivo/multiplo) com bruto + capped, 3 caps em sequência (categoria → ISE → absoluto), `potencial_final` em pct e brl, `valor_projetado_brl`.
**Razão:** descobrimos que +123% no Forste era fantasia matemática sem caps. Os 3 caps protegem contra fantasia. Decisão #23.

### Evolução 4 — Bloco `recomendacoes_pre_venda`
**Antes (rev2):** não existia.
**Agora (rev3 §3.17):** array dedicado com `{id, label, mensagem}` para ações qualitativas que não geram contribuição monetária mas são pré-requisitos (separar PF/PJ, documentar processos, registrar marca, aumentar presença digital). Decisão #24.

### Evolução 5 — Subdivisão upsides: `{ ativos, paywalls }`
**Antes (rev2):** array único com categoria `'bloqueado'` marcando paywalls.
**Agora (rev3):** objeto `{ ativos[], paywalls[] }`. Razão: organização de rendering. Não muda metodologia. Aplicado junto com Decisão #22 acima.

### Evolução 6 — Cards de upside SEMPRE mostram R$ (Decisão #25)
Em todas as superfícies que mostram upsides individualmente (laudo-admin, laudo-pago, laudo-gratuito), cada card exibe: pill da categoria + título humano + descrição curta + **valor R$ em destaque** + notinha `"↑ ganho estimado no valor de venda do negócio se a ação for executada"`.
- **Qualitativos:** `"Ação necessária — sem valor monetário direto"` (não inventar número).
- **Paywalls no laudo-pago:** revelar R$ normalmente (cliente já pagou).
- **Paywalls no laudo-gratuito:** bloquear com `"Liberar com laudo R$99"`.
**Razão:** laudo-pago e laudo-gratuito não terão a seção POTENCIAL 12M agregada (admin-only). Sem R$ no card individual, vendedor/comprador não vê ganho de cada ação.

### Evolução 7 — Pendência: Breakdown detalhado por categoria (Caminho A)
Documentado em [`relatorios/2026-04-29-pendencia-breakdown-upsides.md`](2026-04-29-pendencia-breakdown-upsides.md).
Cada categoria de upside expõe campos próprios: RO (`valor_atual + valor_alvo + economia_mensal + ganho_caixa_12m + ganho_avaliacao`), PASSIVO (`valor_atual + valor_alvo + economia_juros_anual + ganho_avaliacao`), MULTIPLO (`delta_multiplo + ganho_avaliacao`), QUALITATIVO (sem valores), TRIBUTARIO (`economia_anual + ganho_avaliacao`).
**Status:** ⏸️ pendente, atacar pós-Fase 3. Custo: 4.5–5.5h.

### Evolução 8 — Refinamentos visuais aprovados em 29/04
- DRE: tirar `"/ ano"` do número grande dos KPIs (sub `"/ mês"` dá contexto).
- Tabela INDICADORES: cabeçalhos `"Negócio / Média setor / Diferença"` (não `"VALOR / BENCH / Δ"`).
- PMP/PMR: sem badge de status (não comparam isoladamente).
- Ciclo financeiro: regra própria (`≤ 0` → EXCELENTE, `1-30` → BOM, `31-60` → NORMAL, `> 60` → ATENÇÃO).
- `"Regime Ótimo"` → `"Regime Ideal"` em todo o documento.
- Frases prescritivas hardcoded deletadas (Atratividade veredicto, Fator R, "negócio já está no regime ótimo"). Geração via IA é o caminho oficial (Decisão #15 da rev2).
- Bug fix: `peso_pct` usar `Math.round()` ou `.toFixed(0)` pra evitar `7.000000000000001%`.

---

## ÍNDICE

0. **MUDANÇAS DESTA REVISÃO** (8 evoluções — rev3)
1. Princípios arquiteturais (**25 decisões** — 20 da rev2 + 5 da rev3)
2. Estrutura de tabelas
3. Schema calc_json v2 completo (subseções 3.16 `potencial_12m` e 3.17 `recomendacoes_pre_venda` novas)
4. Parâmetros calibrados (motor — subseções 4.20 `upsides_catalogo`, 4.21 `caps`, 4.22 `pesos_sub_metricas_ise` novas)
5. Tabelas tributárias (Bloco 5 referenciado)
6. Ordem oficial do DRE (5 blocos — Bloco 2 da revisão)
7. Fórmula de cálculo do valuation (Bloco 1 corrigido)
8. Balanço Patrimonial v2 (Bloco 4)
9. Fluxo de execução
10. Implicações nos arquivos
11. Geração de textos IA (frases prescritivas hardcoded deletadas em 29/04 — geração via IA é o caminho oficial)
12. Edge Functions necessárias
13. Versionamento de parâmetros
14. Mudanças necessárias no diagnóstico (subseção 14.4 nova: Caminho A para breakdown detalhado)
15. Checklist Passo 3
16. **Estado de implementação rev3** (novo — snapshot do que cada decisão já tem implementado)

---

## SEÇÃO 1 — PRINCÍPIOS ARQUITETURAIS

As **25 decisões** que regem toda a v2 (20 da rev2 + 5 incorporadas em rev3):

| # | Decisão | Origem |
|---|---|---|
| 1 | calc_json é dono da verdade. `negocios.calc_json` e `laudos` morrem | Auditoria |
| 2 | `negocios` vira metadata leve. `dossie_json` separado pra qualitativo | Auditoria |
| 3 | Sem benchmark silencioso — flag `usou_benchmark: true` quando aplicar | Auditoria |
| 4 | Apenas delta% e payback rodam pós-publicação no client | Auditoria |
| 5 | Schema v2 aninhado, com `_versao` | Auditoria |
| 6 | Sem migração — começa do zero | Auditoria |
| 7 | Avaliação imutável: carrega versão de parâmetros do dia. Não recalcula retroativo | Auditoria |
| 8 | Cenário C: skill roda 1× na T44 (preview), botão "Gerar laudo" só persiste | Auditoria |
| 9 | Texto IA persiste no calc_json (gera 1× no commit, exceto regeneração manual) | Auditoria |
| 10 | Selic em `parametros_1n.selic_anual`, atualização Opção C, calibração a cada 6 meses | Auditoria |
| 11 | Nomes finais: `laudo-fonte`, `laudo-gratuito`, `laudo-pago` | Auditoria |
| 12 | **Design não muda — só JS muda. Layout dos laudos preservado.** | Auditoria + revisão |
| 13 | ISE: 8 pilares (opção C), pesos somam 100% | Auditoria |
| 14 | Análise tributária reflete obrigação fiscal real (regra oficial), não declarada | Revisão |
| 15 | Textos IA gerados em 2 momentos: (a) 7 textos analíticos no commit do laudo, (b) 3 textos comerciais na criação do anúncio. Nenhum regenera automaticamente | Revisão |
| 16 | Todo texto público (card index, negocio.html antes do NDA) usa versão anônima — sem nome, sócios, endereço, CNPJ. Números arredondados | Revisão |
| 17 | **Tributação tem 3 bases de incidência por regime:** Simples (DAS sobre fat + FGTS sobre folha), Presumido (fat + folha + base presumida), Real (fat + folha + RO como proxy de lucro) | Revisão |
| 18 | **Cálculos centralizados na skill.** Telas intermediárias do diagnóstico (T28, T29, T31, T44) chamam funções da skill. Sem lógica duplicada | Revisão |
| 19 | **RO ≤ 0:** valor_operacao = 0, valor_venda = patrimônio_líquido + aviso forte + CTA especialista | Revisão |
| 20 | **Provisão CLT 13º+1/3 férias** vai pro Passivo Circulante do Balanço (não DRE), fator `13% × 6 × encargos` | Revisão |
| 21 | **Componente Crescimento da Atratividade** usa `D.crescimento_pct` (histórico real). Quando ausente, score 3 (penalidade leve). Projeção do vendedor (`crescimento_proj_pct`) **não entra em score** — Regra "Coisa A não informa Coisa B" | Sessão 28/04 |
| 22 | **Categorias técnicas dos upsides:** `ro`, `passivo`, `multiplo`, `qualitativo`, `paywall`. Refletem mecanismo matemático no valuation, não percepção comercial. Substituem produto-style (obrigatorio/ganho_rapido/etc) | Sessão 28/04 |
| 23 | **Bloco `potencial_12m` agregado** com 3 caps em sequência: categoria → ISE → absoluto. Tributário separado (fora dos caps). Protege contra fantasia matemática (e.g. +123% sem caps) | Sessão 28/04 |
| 24 | **Bloco `recomendacoes_pre_venda` separado** — array `{id, label, mensagem}` para ações qualitativas pré-requisito (PF/PJ, processos, marca, presença digital). Não confundir com `upsides.ativos[]` | Sessão 28/04 |
| 25 | **Cards de upside SEMPRE mostram R$ em destaque** em laudo-admin/pago/gratuito. Pill da categoria + título + descrição + R$ + notinha. Qualitativos: copy padrão. Paywall: revela no laudo-pago, bloqueia no laudo-gratuito | Sessão 29/04 |

---

## SEÇÃO 2 — ESTRUTURA DE TABELAS

### 2.1 — `laudos_completos` (único soberano)

```sql
CREATE TABLE laudos_completos (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id            UUID NOT NULL REFERENCES negocios(id),
  versao                INTEGER NOT NULL DEFAULT 1,
  ativo                 BOOLEAN NOT NULL DEFAULT true,
  calc_json             JSONB NOT NULL,
  criado_em             TIMESTAMPTZ NOT NULL DEFAULT now(),
  parametros_versao_id  TEXT NOT NULL REFERENCES parametros_versoes(id),

  UNIQUE (negocio_id, ativo) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX idx_laudos_negocio ON laudos_completos(negocio_id);
CREATE INDEX idx_laudos_ativo ON laudos_completos(negocio_id, ativo) WHERE ativo = true;
```

**Regras:**
- Cada nova avaliação = INSERT novo registro. O anterior fica `ativo = false` (histórico imutável).
- Reavaliação = INSERT com `versao = max(versao) + 1`. Nunca UPDATE no calc_json.
- **Único campo do calc_json que recebe UPDATE pós-criação:** `textos_ia.*` quando admin regerar manualmente, e `textos_anuncio.*` quando criar/regerar anúncio.

### 2.2 — `parametros_versoes` (tabela nova)

```sql
CREATE TABLE parametros_versoes (
  id            TEXT PRIMARY KEY,
  ativo         BOOLEAN NOT NULL DEFAULT false,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por    TEXT,
  promovido_em  TIMESTAMPTZ,
  promovido_por TEXT,
  nota          TEXT,
  snapshot      JSONB NOT NULL,

  UNIQUE (ativo) DEFERRABLE INITIALLY DEFERRED
);
```

**Regras:**
- Avaliações fazem JOIN via `parametros_versao_id`.
- Avaliações antigas continuam apontando pra suas versões antigas.
- Promover nova versão = transação atômica (UPDATE ativo=false na anterior + UPDATE ativo=true na nova).

### 2.3 — `negocios` (refatorada)

**Mantém:** `id, vendedor_id, nome, tag, codigo_diagnostico, slug, status, titulo_anuncio, preco_pedido, plano, comissao_pct, publicado_em, created_at, updated_at, expira_em, vendido_em, reativado_em, abertura_negociacao, reuniao_cal, aceita_parcelamento, aceita_transicao, tentou_vender_antes, termo_aceito_em, funil_*, aprovacao_*, alteracao_*`

**Cria nova:** `dossie_json JSONB` — guarda campos qualitativos editáveis pelo vendedor (descrição_geral, motivo_venda, urgencia, expectativa_valor, prazo_transicao, riscos, tese, concorrentes, diferenciais, posicionamento_preco, ameacas_competitivas, pontos_fortes, pontos_fracos, motivacao, horario_funcionamento, tipo_venda_descricao, itens_excluidos_venda, obs_tributaria, tipo_negocio_breve, contexto_extra).

**Remove:** ~30 colunas de cálculo e identificação que migram para calc_json/dossie_json.

### 2.4 — `parametros_1n` (refatorada)

Chaves canônicas v2:

```
selic_anual                       NUMERIC
multiplos_setor                   JSONB (12 setores)
ajuste_forma_atuacao              JSONB (8 formas)
fator_ise                         JSONB (5 faixas)
pesos_ise                         JSONB (8 pilares)
regras_pilares                    JSONB (sub-métricas detalhadas)
pesos_atratividade                JSONB (3 componentes)
score_setor_atratividade          JSONB (12 setores)
faixas_atratividade               JSONB (4 faixas)
faixas_crescimento                JSONB (7 faixas)
benchmarks_dre                    JSONB (12 setores × 6 indicadores)
modificadores_forma_atuacao_dre   JSONB (8 formas × 6 indicadores)
benchmarks_indicadores            JSONB (12 setores × 5 indicadores)
regras_upsides                    JSONB
regras_tributarias                JSONB (Simples 5 anexos, Presumido, Real, MEI)
mapeamento_setor_anexo_simples    JSONB
mapeamento_setor_presuncao        JSONB
rat_por_setor                     JSONB (12 setores)
regras_arredondamento             JSONB
prompts_textos_ia                 JSONB
```

### 2.5 — Tabelas a serem dropadas

```sql
DROP TABLE laudos;
ALTER TABLE negocios DROP COLUMN calc_json;
```

---

## SEÇÃO 3 — SCHEMA calc_json v2 COMPLETO

### 3.1 — Estrutura geral aninhada

```json
{
  "_versao_calc_json": "2.0",
  "_versao_parametros": "v2026.04",
  "_data_avaliacao": "2026-04-27T10:00:00Z",
  "_skill_versao": "2.0.0",

  "identificacao":             { /* 3.2 */ },
  "inputs_origem":             { /* 3.3 */ },
  "dre":                       { /* 3.4 */ },
  "balanco":                   { /* 3.5 */ },
  "ise":                       { /* 3.6 */ },
  "valuation":                 { /* 3.7 */ },
  "atratividade":              { /* 3.8 */ },
  "operacional":               { /* 3.9 */ },
  "icd":                       { /* 3.10 */ },
  "indicadores_vs_benchmark":  { /* 3.11 */ },
  "analise_tributaria":        { /* 3.12 */ },
  "upsides":                   { /* 3.13 — { ativos[], paywalls[] } (rev3) */ },
  "textos_ia":                 { /* 3.14 — gerado no commit */ },
  "textos_anuncio":            { /* 3.15 — gerado na criação do anúncio */ },
  "potencial_12m":             { /* 3.16 — agregação com 3 caps (rev3) */ },
  "recomendacoes_pre_venda":   { /* 3.17 — qualitativos sem brl (rev3) */ },
  "_modo":                     "preview" | "commit" | "demo"
}
```

### 3.2 — `identificacao`

```json
{
  "id": "uuid",
  "codigo_diagnostico": "1N-RZHUYL",
  "slug": "1N-RZHUYL",
  "nome": "Forste — Soluções de Gestão",
  "tipo_negocio_breve": "Consultoria de gestão para pequenas indústrias",
  "setor": { "code": "servicos_empresas", "label": "Serviços B2B" },
  "modelo_atuacao": {
    "selecionados": ["presta_servico"],
    "principal": "presta_servico"
  },
  "regime_tributario_declarado": {
    "code": "simples",
    "label": "Simples Nacional",
    "anexo_simples": "III",
    "fator_r_calculado": 26.15,
    "observacao_fator_r": "Sua atividade pode estar sujeita ao Fator R do Simples Nacional. Confirme com seu contador o anexo correto."
  },
  "localizacao": { "cidade": "Florianópolis", "estado": "SC" },
  "tempo_operacao_anos": 4,
  "expectativa_valor_dono": 500000,
  "pct_produto": 0
}
```

### 3.3 — `inputs_origem` (rastreabilidade)

```json
{
  "cmv":          { "valor": 0,      "fonte": "informado_servico_puro" },
  "aluguel":      { "valor": 4500,   "fonte": "informado" },
  "folha_clt":    { "valor": 17000,  "fonte": "informado" },
  "outros_cf":    { "valor": 1000,   "fonte": "informado" },
  "concentracao": { "valor": 45,     "fonte": "informado" },
  "recorrencia":  { "valor": 90,     "fonte": "informado" }
}
```

**Valores:** `informado` | `informado_servico_puro` | `informado_zero_intencional` | `usou_benchmark` | `nao_informado`.

Quando usa benchmark:
```json
{ "valor": 8400, "fonte": "usou_benchmark", "benchmark_pct": 8, "benchmark_setor": "servicos_empresas" }
```

### 3.4 — `dre` (Decisão #14, #17, ordem do Bloco 2)

```json
{
  "fat_mensal": 65000,
  "fat_anual": 780000,

  "deducoes_receita": {
    "impostos_calculados_mensal": 7430,
    "impostos_calculados_anual": 89154,
    "impostos_declarados_pelo_vendedor_mensal": null,
    "diferenca_potencial_passivo_mensal": 0,
    "taxas_recebimento_total_mensal": 520,
    "taxas_recebimento_detalhe": {
      "cartao_debito": 195,
      "cartao_credito": 285,
      "antecipacao": 40,
      "marketplace": 0,
      "gateway_pix_boleto": 0
    },
    "comissoes": 3250,
    "royalty_pct_aplicado": 0,
    "mkt_franquia_pct_aplicado": 0,
    "total_deducoes": 11200
  },
  "rec_liquida_mensal": 53800,

  "cmv": 0,
  "lucro_bruto_mensal": 53800,

  "pessoal": {
    "clt_folha_bruta": 17000,
    "clt_encargos_mensal": 1360,
    "encargos_aliquota_aplicada": 0.08,
    "pj_custo": 4994,
    "royalty_fixo": 0,
    "mkt_franquia_fixo": 0,
    "folha_total_mensal": 23354
  },

  "ocupacao": {
    "aluguel": 4500,
    "facilities": 0,
    "terceirizados": 0,
    "total": 4500
  },

  "operacional_outros": {
    "sistemas": 0,
    "outros_cf": 1000,
    "mkt_pago": 3500,
    "total": 4500
  },

  "ro_mensal": 14029,
  "ro_anual": 168348,
  "margem_operacional_pct": 21.58,

  "abaixo_do_ro": {
    "resultado_financeiro": {
      "despesas_financeiras": 0,
      "receitas_financeiras": 0
    },
    "impostos_sobre_lucro": {
      "irpj_anual": 0,
      "csll_anual": 0,
      "observacao": "Simples Nacional inclui no DAS"
    },
    "lucro_liquido_mensal": 14029,
    "prolabore": 0,
    "antecipacao_eventual": 0,
    "parcelas_dividas": 3500,
    "investimentos": 0,
    "potencial_caixa_mensal": 10529
  }
}
```

### 3.5 — `balanco` (Bloco 4 da revisão + Decisão #20)

```json
{
  "ativos": {
    "caixa": 20000,
    "contas_receber": 35000,
    "estoque": 0,
    "equipamentos": 30000,
    "imovel": 0,
    "ativo_franquia": 0,
    "outros": 0,
    "total": 85000,
    "imobilizado_total": 30000
  },
  "passivos": {
    "fornecedores_a_vencer": 8000,
    "fornecedores_atrasados": 0,
    "impostos_atrasados_sem_parcelamento": 0,
    "saldo_devedor_emprestimos": 60000,
    "provisao_clt_calculada": {
      "valor": 14321,
      "formula": "clt_folha × 0.13 × 6 × fator_encargo",
      "fator_encargo_aplicado": 1.08,
      "regime_referencia": "simples_anexo_III"
    },
    "outros_passivos": 0,
    "total": 82321
  },
  "patrimonio_liquido": 2679,
  "ncg": {
    "valor": 27000,
    "calculo": "contas_receber + estoque - fornecedores_a_vencer - fornecedores_atrasados"
  },
  "ciclo_financeiro": {
    "pmr_dias": 25,
    "pmp_dias": 30,
    "ciclo_dias": -5
  }
}
```

### 3.6 — `ise` (8 pilares com decomposição completa)

Estrutura mantida da spec anterior. Cada pilar carrega:
- `id`, `label`, `peso_pct`, `score_0_10`, `contribuicao_no_total`
- `sub_metricas[]` com `id`, `peso_pct_no_pilar`, `valor_calculado`, `unidade`, `score_0_10`, `regra_aplicada`

Estrutura completa documentada na Seção 3.6 da versão anterior — preservada integralmente.

### 3.7 — `valuation` (Bloco 1 corrigido + Decisão #19)

```json
{
  "multiplo_setor": {
    "codigo": "servicos_empresas",
    "label": "Serviços B2B",
    "valor": 2.06
  },
  "ajuste_forma_atuacao": {
    "principal": {
      "codigo": "presta_servico",
      "label": "Prestando serviços",
      "valor": 0.06
    },
    "outras": [],
    "total_ajuste": 0.06
  },
  "multiplo_base": 2.12,
  "fator_ise": {
    "classe": "Operacional",
    "valor": 1.00,
    "faixa": "50–69"
  },
  "fator_final": 2.12,

  "ro_anual": 168348,
  "valor_operacao": 356898,
  "patrimonio_liquido": 2679,
  "valor_venda": 359577,

  "ro_negativo": false,
  "ro_negativo_msg": null,
  "alerta_pl_negativo": null,
  "cta_especialista": null
}
```

**Fórmula final corrigida (Bloco 1):**
- `multiplo_base = multiplo_setor + ajuste_forma_atuacao.total_ajuste`
- `fator_final = multiplo_base × fator_ise.valor`
- `valor_operacao = ro_anual × fator_final`
- `valor_venda = valor_operacao + patrimonio_liquido` ← **sem max(0, ...)**

**Comportamento RO ≤ 0 (Decisão #19):**
```
SE ro_mensal <= 0:
  valor_operacao = 0
  valor_venda = patrimonio_liquido (pode ser positivo ou negativo)
  ro_negativo = true
  ro_negativo_msg = "Esta empresa está sendo avaliada apenas pelo valor de seus ativos líquidos. O resultado operacional negativo impede a aplicação da metodologia padrão. Recomendamos uma sessão com especialista para avaliar oportunidades de melhoria antes da venda."
  cta_especialista = {
    ativo: true,
    label: "Agendar conversa com especialista",
    url: "/agendar-especialista?codigo={codigo_diagnostico}"
  }
```

**Alertas para casos extremos:**
```
SE valor_venda < 0:
  alerta_pl_negativo.tipo = "valor_negativo"
  alerta_pl_negativo.mensagem = "Dívidas líquidas excedem o valor da operação. Considere..."

SE valor_venda < valor_operacao × 0.30 AND ro_mensal > 0:
  alerta_pl_negativo.tipo = "divida_engole_valor"
  alerta_pl_negativo.mensagem = "Dívidas líquidas reduzem significativamente o valor de venda..."
```

### 3.8 — `atratividade` (CTA exclusivo do laudo gratuito)

```json
{
  "total": 70,
  "label": "Boa",
  "componentes": [
    {
      "id": "ise",
      "label": "Saúde do negócio",
      "peso_pct": 50,
      "score_0_10": 6.0,
      "fonte": "ise.total / 10"
    },
    {
      "id": "setor",
      "label": "Apelo do setor",
      "peso_pct": 25,
      "score_0_10": 9,
      "fonte": "parametros.score_setor_atratividade[servicos_empresas]"
    },
    {
      "id": "crescimento",
      "label": "Momentum de crescimento",
      "peso_pct": 25,
      "score_0_10": 5,
      "fonte_crescimento": "historico_real",
      "crescimento_pct_aplicado": 8,
      "penalidade_aplicada": 0,
      "metadata": null
    }
  ]
}
```

**Fórmula:**
```
atratividade.total = round((ise/10 × 0.50 + score_setor × 0.25 + score_crescimento × 0.25) × 10)
```

**Componente `crescimento` (Decisão #21):**
- `score_crescimento` é derivado de `D.crescimento_pct` (histórico real, do diagnóstico).
- `D.crescimento_proj_pct` (projeção do vendedor) **não entra** — Regra "Coisa A não informa Coisa B".
- `fonte_crescimento` indica origem:
  - `'historico_real'` — vendedor respondeu (mesmo que tenha respondido `0%` deliberado).
  - `'sem_resposta'` — vendedor pulou. Score = **3** (penalidade leve, não score neutro).
- Quando `fonte_crescimento === 'sem_resposta'`, `metadata = { componente: 'crescimento', motivo: 'sem_resposta', score: 3 }` documenta a penalidade aplicada.
- Faixas históricas: `30+` → 10, `20-29.9` → 9, `10-19.9` → 7, `5-9.9` → 5, `-5 a 4.9` → 4 (Estável), `-15 a -5.1` → 2, `-100 a -15.1` → 0.

### 3.9 — `operacional`

```json
{
  "num_funcs_clt": 4,
  "num_funcs_pj": 0,
  "num_funcs_total": 4,
  "clientes_ativos": 32,
  "ticket_medio_mensal": 2031,
  "recorrencia_pct": 90,
  "concentracao_pct": 45,
  "concentracao_status": "alto",
  "processos": "parcial",
  "dependencia_socio": "parcial",
  "ro_por_funcionario_mensal": 3507
}
```

### 3.10 — `icd`

```json
{
  "pct_completude": 50,
  "total_perguntas": 21,
  "total_respondidas": 11,
  "respondidas": ["Faturamento mensal", "Regime tributário", "..."],
  "nao_respondidas": ["Marca INPI", "Reputação"]
}
```

### 3.11 — `indicadores_vs_benchmark`

```json
{
  "indicadores": [
    {
      "id": "margem_operacional",
      "label": "Margem operacional",
      "valor_negocio": 21.58,
      "unidade": "%",
      "benchmark": 33.0,
      "delta_pp": -11.42,
      "status": "abaixo",
      "regra_aplicada": "setor B2B 30% + modificador presta_servico +3pp"
    },
    {
      "id": "folha_pct",
      "label": "Folha sobre faturamento",
      "valor_negocio": 26.15,
      "benchmark": 40.0,
      "delta_pp": -13.85,
      "status": "no_alvo"
    },
    {
      "id": "aluguel_pct",
      "valor_negocio": 6.92,
      "benchmark": 4.0,
      "delta_pp": 2.92,
      "status": "abaixo"
    },
    {
      "id": "cmv_pct",
      "valor_negocio": 0,
      "benchmark": 0,
      "regra_pct_produto_aplicada": "pct_produto = 0% → benchmark CMV ajustado a zero",
      "status": "neutro"
    },
    {
      "id": "concentracao_pct",
      "valor_negocio": 45,
      "benchmark": 18,
      "delta_pp": 27,
      "status": "abaixo"
    },
    {
      "id": "recorrencia_pct",
      "valor_negocio": 90,
      "benchmark": 60,
      "delta_pp": 30,
      "status": "no_alvo"
    }
  ]
}
```

### 3.12 — `analise_tributaria`

```json
{
  "regime_declarado": "simples",
  "anexo_simples": "III",
  "fator_r_calculado": 26.15,
  "fator_r_observacao": "Próximo ao limite de 28%. Pode estar sujeito ao Fator R. Confirme com contador.",
  "regime_otimo_calculado": "simples",
  "regime_otimo_anexo": "III",

  "comparativo_regimes": [
    {
      "regime": "simples",
      "anexo": "III",
      "imposto_anual": 89154,
      "encargo_folha_anual": 16320,
      "total_anual": 105474,
      "aliquota_efetiva_pct": 11.43,
      "viabilidade": "viavel",
      "observacao": "Regime atual"
    },
    {
      "regime": "presumido",
      "imposto_anual": 128334,
      "encargo_folha_anual": 76500,
      "total_anual": 204834,
      "aliquota_efetiva_pct": 26.26,
      "viabilidade": "viavel"
    },
    {
      "regime": "real",
      "imposto_anual": 128000,
      "encargo_folha_anual": 76500,
      "total_anual": 204500,
      "aliquota_efetiva_pct": 26.22,
      "viabilidade": "viavel"
    },
    {
      "regime": "mei",
      "viabilidade": "inviavel",
      "observacao": "Faturamento R$ 780k/ano acima do limite MEI de R$ 81k/ano"
    }
  ],

  "economia_potencial": {
    "comparado_a": "simples",
    "regime_recomendado": "simples",
    "economia_anual": 0,
    "economia_pct_do_ro": 0,
    "observacao": "Forste já está no regime ótimo"
  },

  "gera_upside_obrigatorio": false,
  "regra_obrigatorio": "economia anual > R$ 10.000 E > 5% do RO anual"
}
```

### 3.13 — `upsides` (Decisão #22 + #25)

Schema rev3: `upsides` é objeto `{ ativos[], paywalls[] }`. Cada item carrega:

```json
{
  "id": "ro_renegociar_custos_fixos",
  "categoria": "ro",
  "label": "Renegociar custos fixos",
  "descricao": "Aluguel, sistemas e outros custos fixos podem ser renegociados...",
  "gate": { "expressao": "(indicadores && indicadores.aluguel_pct ...)", ... },
  "formula_calculo": { "tipo": "ro_direto", "parametros": { ... } },
  "fonte_de_calculo": "Benchmark renegociação de aluguel/contratos..."
}
```

**5 categorias técnicas (Decisão #22):**

| categoria | mecanismo no valuation |
|---|---|
| `ro` | Aumenta resultado operacional (renegociar custos, otimizar precificação, reduzir folha, recuperar inativos) |
| `passivo` | Reduz dívida (regularizar fornecedores, reestruturar dívidas, resolver passivos trabalhistas) |
| `multiplo` | Move o múltiplo (aumentar recorrência, diversificar clientes, reduzir dependência do sócio) |
| `qualitativo` | Recomendação sem contribuição monetária direta (formalizar contabilidade, separar PF/PJ, documentar processos, registrar marca, aumentar presença digital) |
| `paywall` | Análises bloqueadas no laudo-gratuito, reveladas no laudo-pago |

**Distribuição (catálogo v2026.07):** 21 upsides + 3 paywalls + N recomendações pré-venda.

**Regra de exibição em cards (Decisão #25):**

Cada superfície que exibe upsides individualmente (laudo-admin, laudo-pago, laudo-gratuito) renderiza:
- Pill da categoria (label human-readable: "Resultado Operacional", "Redução de Passivos", "Aumento de Múltiplo", "Qualitativo", "Análise complementar")
- Título humano (`label`)
- Descrição curta (`descricao`)
- **Valor R$ em destaque** (lookup em `potencial_12m.upsides_ativos[id]`)
- Notinha `"↑ ganho estimado no valor de venda do negócio se a ação for executada"`

Variantes por superfície:
- **Qualitativo:** `"Ação necessária — sem valor monetário direto"` (não inventar número).
- **Paywall no laudo-pago:** revelar R$ normalmente (cliente já pagou).
- **Paywall no laudo-gratuito:** bloquear com `"Liberar com laudo R$99"`.

### 3.14 — `textos_ia` (gerados no commit)

```json
{
  "_gerados_em": "2026-04-27T10:00:00Z",
  "_modelos_usados": {
    "haiku": "claude-haiku-4-5-20251001",
    "sonnet": "claude-sonnet-4-6"
  },
  "status": "concluido",

  "texto_resumo_executivo_completo":  { "modelo": "haiku",  "conteudo": "..." },
  "texto_contexto_negocio":           { "modelo": "haiku",  "conteudo": "..." },
  "texto_parecer_tecnico":            { "modelo": "sonnet", "conteudo": "..." },
  "texto_riscos_atencao":             { "modelo": "sonnet", "conteudo": "..." },
  "texto_diferenciais":               { "modelo": "haiku",  "conteudo": "..." },
  "texto_publico_alvo_comprador":     { "modelo": "sonnet", "conteudo": "..." },
  "descricoes_polidas_upsides": [
    { "id_upside": "comercial_renegociar_aluguel", "texto": "..." }
  ]
}
```

**Status possíveis:** `concluido`, `pendente_geracao`, `erro_persistente`.

### 3.15 — `textos_anuncio` (gerados na criação do anúncio)

```json
{
  "_gerados_em": null,
  "_status": "nao_gerado",

  "texto_resumo_executivo_anonimo": {
    "modelo": "haiku",
    "conteudo": null,
    "_pendente_geracao": true,
    "_aguarda": "criacao_anuncio"
  },
  "sugestoes_titulo_anuncio": {
    "modelo": "haiku",
    "conteudo": [],
    "_pendente_geracao": true
  },
  "texto_consideracoes_valor": {
    "modelo": "sonnet",
    "conteudo": null,
    "_pendente_geracao": true,
    "_input_necessario": "negocios.preco_pedido"
  }
}
```

### 3.16 — `potencial_12m` (Decisão #23 — novo bloco rev3)

Agregação determinística do potencial de aumento do valor de venda em 12 meses.
Tributário separado fora dos caps. 3 caps em sequência (categoria → ISE → absoluto).

```json
{
  "_versao": "v2.1",

  "upsides_ativos": [
    {
      "id": "ro_renegociar_custos_fixos",
      "categoria": "ro",
      "label": "Renegociar custos fixos",
      "contribuicao_bruta_pct": 0.04811,
      "contribuicao_pos_cap_categoria_pct": 0.04811,
      "contribuicao_brl": 30406
    },
    {
      "id": "mu_diversificar_clientes",
      "categoria": "multiplo",
      "label": "Diversificar carteira de clientes",
      "contribuicao_bruta_pct": 0.20422,
      "contribuicao_pos_cap_categoria_pct": 0.20422,
      "contribuicao_brl": 129060
    }
  ],

  "agregacao": {
    "tributario": {
      "brl": 0,
      "pct": 0,
      "sem_cap": true,
      "fonte": "analise_tributaria.economia_potencial.economia_anual"
    },
    "por_categoria": {
      "ro":       { "bruto_pct": 0.04811, "cap_aplicado": false, "capped_pct": 0.04811 },
      "passivo":  { "bruto_pct": 0,       "cap_aplicado": false, "capped_pct": 0       },
      "multiplo": { "bruto_pct": 0.20422, "cap_aplicado": false, "capped_pct": 0.20422 }
    },
    "potencial_alavancas_pre_ise_pct": 0.25233,
    "cap_ise": {
      "ise_score": 84.1,
      "ise_score_arredondado": 84,
      "faixa": "75-89",
      "cap_aplicavel": 0.65,
      "cap_aplicado": false,
      "potencial_pos_ise_pct": 0.25233
    },
    "cap_absoluto": {
      "threshold": 0.80,
      "aplicado": false,
      "potencial_pos_absoluto_pct": 0.25233
    },
    "tributario_dominante": false
  },

  "potencial_final": {
    "pct": 0.25233,
    "brl": 159466,
    "valor_projetado_brl": 791441
  },

  "ordenacao_exibicao": []
}
```

**Caps em sequência (Decisão #23):**
1. **Cap por categoria** — limita contribuição máxima de cada categoria (`ro`, `passivo`, `multiplo`) configurado em `parametros_versoes.caps.por_categoria`.
2. **Cap ISE** — limita potencial total das alavancas em função do ISE arredondado (faixas: `<60` → 0.30, `60-74` → 0.45, `75-89` → 0.65, `90-100` → 0.80).
3. **Cap absoluto** — teto global de 80% (`parametros_versoes.cap_absoluto`), independente de ISE.

**Tributário separado:** `agregacao.tributario.sem_cap = true` indica que a economia tributária **não passa por cap nenhum** (é certeza fiscal, não probabilidade). Flag `tributario_dominante = true` quando a contribuição tributária representa mais de 50% do potencial total.

**`valor_projetado_brl`** = `valor_venda` (rev2 §3.7) `+ potencial_final.brl`. É o valor em 12 meses se ações executadas.

### 3.17 — `recomendacoes_pre_venda` (Decisão #24 — novo bloco rev3)

Array dedicado a ações qualitativas pré-requisito que **não geram contribuição monetária direta** mas são pré-requisitos pra destravar valor (separar PF/PJ, documentar processos, registrar marca, aumentar presença digital).

```json
[
  { "id": "rec_separar_pf_pj",            "label": "Separar pessoa física de pessoa jurídica",  "mensagem": "Separação PF/PJ é pré-requisito de qualquer comprador profissional" },
  { "id": "rec_documentar_processos",     "label": "Documentar processos operacionais",         "mensagem": "Processos documentados reduzem risco percebido pelo comprador..." },
  { "id": "rec_registrar_marca",          "label": "Registrar marca no INPI",                   "mensagem": "Marca registrada no INPI é ativo intangível protegido..." },
  { "id": "rec_aumentar_presenca_digital", "label": "Aumentar presença digital",                "mensagem": "Presença digital robusta amplia base de compradores..." }
]
```

**Diferença em relação a `upsides.ativos[].categoria === 'qualitativo'`:**
- `recomendacoes_pre_venda` é array dedicado de **mensagens curtas** focado em pré-venda.
- `upsides.ativos[].categoria === 'qualitativo'` são upsides do catálogo com gate técnico que disparou.
- Renderização: laudo-pago/admin podem mesclar ambos no sub-bloco "Qualitativos · Pré-venda".

---

## SEÇÃO 4 — PARÂMETROS CALIBRADOS (motor)

### 4.1 — `multiplos_setor` (12 setores)

```json
{
  "servicos_empresas":  2.06,
  "educacao":           2.18,
  "saude":              2.12,
  "bem_estar":          1.87,
  "beleza_estetica":    1.76,
  "industria":          1.72,
  "hospedagem":         1.69,
  "logistica":          1.67,
  "alimentacao":        1.58,
  "servicos_locais":    1.58,
  "varejo":             1.52,
  "construcao":         1.46
}
```

### 4.2 — `ajuste_forma_atuacao` (8 formas)

```json
{
  "saas":             0.82,
  "assinatura":       0.46,
  "vende_governo":    0.28,
  "distribuicao":     0.12,
  "presta_servico":   0.06,
  "produz_revende":  -0.08,
  "fabricacao":      -0.18,
  "revenda":         -0.32
}
```

### 4.3 — Regra de agregação multi-select

- Identifica forma **principal** (maior valor de ajuste)
- Aplica ajuste principal integralmente
- Cada forma adicional contribui com `30% × (ajuste_extra − ajuste_principal)`

### 4.4 — `fator_ise` (5 faixas)

```json
[
  { "min": 85,  "max": 100, "nome": "Estruturado",  "fator": 1.30 },
  { "min": 70,  "max": 84,  "nome": "Consolidado",  "fator": 1.15 },
  { "min": 50,  "max": 69,  "nome": "Operacional",  "fator": 1.00 },
  { "min": 35,  "max": 49,  "nome": "Dependente",   "fator": 0.85 },
  { "min": 0,   "max": 34,  "nome": "Embrionário",  "fator": 0.70 }
]
```

### 4.5 — `pesos_ise` (8 pilares)

```json
{
  "p1_financeiro":         0.20,
  "p2_resultado":          0.15,
  "p3_comercial":          0.15,
  "p4_gestao":             0.15,
  "p5_socio_dependencia":  0.10,
  "p6_risco_legal":        0.10,
  "p7_balanco":            0.08,
  "p8_marca":              0.07
}
```

### 4.6 — `regras_pilares`

Estrutura completa documentada na Seção 4.6 da spec parcial anterior — preservada integralmente. Sub-métricas, faixas, casos especiais.

### 4.7 — `pesos_atratividade`

```json
{ "ise": 0.50, "setor": 0.25, "crescimento": 0.25 }
```

### 4.8 — `score_setor_atratividade`

```json
{
  "servicos_empresas": 9, "educacao": 8, "saude": 8,
  "beleza_estetica": 7, "bem_estar": 7,
  "varejo": 6, "alimentacao": 6, "hospedagem": 6, "logistica": 6,
  "industria": 5, "servicos_locais": 5, "construcao": 4
}
```

### 4.9 — `faixas_atratividade`

```json
[
  { "min": 80, "max": 100, "label": "Excelente" },
  { "min": 65, "max": 79,  "label": "Boa" },
  { "min": 50, "max": 64,  "label": "Moderada" },
  { "min": 0,  "max": 49,  "label": "Baixa" }
]
```

### 4.10 — `faixas_crescimento`

```json
[
  { "min": 30,    "max": 999,  "score": 10, "label": "Crescimento forte" },
  { "min": 20,    "max": 29.9, "score": 9,  "label": "Crescimento sólido" },
  { "min": 10,    "max": 19.9, "score": 7,  "label": "Crescimento moderado" },
  { "min": 5,     "max": 9.9,  "score": 5,  "label": "Crescimento leve" },
  { "min": -5,    "max": 4.9,  "score": 4,  "label": "Estável" },
  { "min": -15,   "max": -5.1, "score": 2,  "label": "Em queda" },
  { "min": -100,  "max": -15.1,"score": 0,  "label": "Queda forte" }
]
```

### 4.11 — `benchmarks_dre` (12 setores × 6 indicadores em % do faturamento)

```json
{
  "servicos_empresas":  { "cmv": 5,  "folha": 35, "aluguel": 5,  "outros_cf": 8, "mkt": 3, "margem_op": 30 },
  "educacao":           { "cmv": 5,  "folha": 38, "aluguel": 8,  "outros_cf": 8, "mkt": 4, "margem_op": 28 },
  "saude":              { "cmv": 12, "folha": 32, "aluguel": 8,  "outros_cf": 8, "mkt": 3, "margem_op": 25 },
  "bem_estar":          { "cmv": 5,  "folha": 30, "aluguel": 12, "outros_cf": 8, "mkt": 4, "margem_op": 22 },
  "beleza_estetica":    { "cmv": 10, "folha": 30, "aluguel": 10, "outros_cf": 8, "mkt": 3, "margem_op": 22 },
  "industria":          { "cmv": 45, "folha": 18, "aluguel": 5,  "outros_cf": 8, "mkt": 2, "margem_op": 12 },
  "hospedagem":         { "cmv": 18, "folha": 25, "aluguel": 12, "outros_cf": 10,"mkt": 4, "margem_op": 18 },
  "logistica":          { "cmv": 22, "folha": 32, "aluguel": 5,  "outros_cf": 10,"mkt": 2, "margem_op": 12 },
  "alimentacao":        { "cmv": 32, "folha": 22, "aluguel": 9,  "outros_cf": 8, "mkt": 3, "margem_op": 15 },
  "servicos_locais":    { "cmv": 12, "folha": 28, "aluguel": 8,  "outros_cf": 8, "mkt": 2, "margem_op": 18 },
  "varejo":             { "cmv": 48, "folha": 14, "aluguel": 5,  "outros_cf": 6, "mkt": 3, "margem_op": 10 },
  "construcao":         { "cmv": 38, "folha": 22, "aluguel": 4,  "outros_cf": 8, "mkt": 2, "margem_op": 10 }
}
```

### 4.12 — `modificadores_forma_atuacao_dre` (8 formas × 6 indicadores, aditivos pp)

```json
{
  "presta_servico":  { "cmv": -3, "folha":  5, "aluguel": -1, "outros_cf": 0, "mkt":  0, "margem_op":  3 },
  "produz_revende":  { "cmv":  3, "folha": -3, "aluguel":  2, "outros_cf": 0, "mkt":  0, "margem_op": -2 },
  "fabricacao":      { "cmv":  5, "folha": -3, "aluguel":  2, "outros_cf": 0, "mkt": -1, "margem_op": -3 },
  "revenda":         { "cmv":  8, "folha": -8, "aluguel": -1, "outros_cf": 0, "mkt":  1, "margem_op": -3 },
  "distribuicao":    { "cmv":  5, "folha": -3, "aluguel": -2, "outros_cf": 0, "mkt": -1, "margem_op": -2 },
  "vende_governo":   { "cmv":  2, "folha":  2, "aluguel": -1, "outros_cf": 0, "mkt": -2, "margem_op": -3 },
  "saas":            { "cmv": -8, "folha":  5, "aluguel": -4, "outros_cf": 0, "mkt":  3, "margem_op":  8 },
  "assinatura":      { "cmv": -3, "folha":  1, "aluguel": -1, "outros_cf": 0, "mkt":  2, "margem_op":  4 }
}
```

### 4.13 — Regra de aplicação dos benchmarks

```
para cada indicador (cmv, folha, aluguel, outros_cf, mkt, margem_op):
  benchmark_setor = benchmarks_dre[setor][indicador]

  modificador_total = modificadores_forma_atuacao_dre[principal][indicador]
  para cada forma_extra em formas[1:]:
    diff = modificadores[forma_extra][indicador] - modificadores[principal][indicador]
    modificador_total += 0.30 × diff

  benchmark_intermediario = benchmark_setor + modificador_total

  SE indicador == "cmv":
    benchmark_final = benchmark_intermediario × (D.pct_produto / 100)
  SENAO:
    benchmark_final = benchmark_intermediario
```

### 4.14 — `benchmarks_indicadores` (12 setores × 5 indicadores operacionais)

```json
{
  "servicos_empresas":  { "margem_bruta": 65, "concentracao_max": 18, "pmr": 28, "pmp": 30, "recorrencia_tipica": 60 },
  "educacao":           { "margem_bruta": 70, "concentracao_max": 6,  "pmr": 10, "pmp": 30, "recorrencia_tipica": 90 },
  "saude":              { "margem_bruta": 60, "concentracao_max": 12, "pmr": 25, "pmp": 30, "recorrencia_tipica": 50 },
  "bem_estar":          { "margem_bruta": 75, "concentracao_max": 2,  "pmr": 0,  "pmp": 30, "recorrencia_tipica": 95 },
  "beleza_estetica":    { "margem_bruta": 60, "concentracao_max": 8,  "pmr": 0,  "pmp": 30, "recorrencia_tipica": 40 },
  "industria":          { "margem_bruta": 32, "concentracao_max": 25, "pmr": 40, "pmp": 35, "recorrencia_tipica": 30 },
  "hospedagem":         { "margem_bruta": 55, "concentracao_max": 8,  "pmr": 0,  "pmp": 30, "recorrencia_tipica": 0 },
  "logistica":          { "margem_bruta": 28, "concentracao_max": 20, "pmr": 30, "pmp": 30, "recorrencia_tipica": 50 },
  "alimentacao":        { "margem_bruta": 58, "concentracao_max": 8,  "pmr": 0,  "pmp": 25, "recorrencia_tipica": 5 },
  "servicos_locais":    { "margem_bruta": 55, "concentracao_max": 12, "pmr": 12, "pmp": 30, "recorrencia_tipica": 30 },
  "varejo":             { "margem_bruta": 38, "concentracao_max": 5,  "pmr": 25, "pmp": 40, "recorrencia_tipica": 5 },
  "construcao":         { "margem_bruta": 22, "concentracao_max": 35, "pmr": 55, "pmp": 40, "recorrencia_tipica": 0 }
}
```

### 4.15 — `regras_upsides`

Estrutura de regras geradoras de cada categoria. Documentada na Seção 4.15 da spec parcial. Preservada.

### 4.16 — `regras_arredondamento` (Decisão #16)

```json
{
  "faturamento": {
    "ate_100k_ano":  { "arredondar_para": "dezena_de_mil" },
    "100k_a_1M_ano": { "arredondar_para": "dezena_de_mil" },
    "acima_1M_ano":  { "arredondar_para": "centena_de_mil" }
  },
  "margem_operacional": { "arredondar_para": "inteiro_pct" },
  "recorrencia":        { "arredondar_para": "multiplo_de_5" },
  "ise": {
    "publico":   { "exibir": "nao" },
    "apos_nda":  { "exibir": "exato_com_decomposicao" }
  },
  "funcionarios": {
    "publico": {
      "ate_5":     "equipe enxuta",
      "6_a_15":    "equipe de pequeno porte",
      "16_a_50":   "equipe estabelecida",
      "acima_50":  "equipe robusta"
    },
    "apos_nda":  { "exibir": "exato_com_separacao_clt_pj" }
  },
  "cidade": { "exibir_publico": "cidade + uf" }
}
```

### 4.17 — `prompts_textos_ia`

10 prompts (9 textos + 1 versão anônima do resumo). Cada prompt definido em detalhe na Seção 8.3 da spec parcial anterior. Modelos: Haiku 4.5 ou Sonnet 4.6 conforme tipo de texto.

### 4.18 — `rat_por_setor`

```json
{
  "construcao":         3.0,
  "industria":          2.0,
  "logistica":          2.0,
  "alimentacao":        2.0,
  "beleza_estetica":    1.5,
  "bem_estar":          1.5,
  "hospedagem":         1.5,
  "servicos_empresas":  1.0,
  "educacao":           1.0,
  "saude":              1.0,
  "servicos_locais":    1.0,
  "varejo":             1.0
}
```

### 4.19 — `mapeamento_setor_anexo_simples` e `mapeamento_setor_presuncao`

Mapeamentos completos documentados na Seção 7 do Bloco 5 (arquivo separado `bloco5-tabelas-tributarias.md`).

### 4.20 — `upsides_catalogo` (rev3 — novo, Decisão #22)

Array de 21 upsides + 3 paywalls em `parametros_versoes.upsides_catalogo`. Cada entrada: `id`, `categoria` (técnica), `label`, `descricao`, `gate.expressao`, `formula_calculo.{tipo, parametros}`, `fonte_de_calculo`. Atualmente em snapshot v2026.07 (migration `006_seed_parametros_v2026_05.sql` introduziu, ajustado por 007 e 008).

### 4.21 — `caps` por categoria (rev3 — novo, Decisão #23)

```json
{
  "por_categoria": {
    "ro":       0.50,
    "passivo":  0.30,
    "multiplo": 0.50
  },
  "ise_faixas": [
    { "ise_min": 90, "ise_max": 100, "cap": 0.80 },
    { "ise_min": 75, "ise_max": 89,  "cap": 0.65 },
    { "ise_min": 60, "ise_max": 74,  "cap": 0.45 },
    { "ise_min": 0,  "ise_max": 59,  "cap": 0.30 }
  ],
  "absoluto": 0.80
}
```

### 4.22 — `pesos_sub_metricas_ise` (rev3 — novo, calibração)

Pesos de cada sub-métrica dentro de cada pilar do ISE. Reorganizados em
v2026.07 (P2 reduzido a 2 sub-métricas removendo `margem_estavel`,
P6 renomeado, P8 reativando `presenca_digital`). Estrutura:

```json
{
  "p1_financeiro":       { "margem_op_pct": 0.25, "dre_separacao": 0.25, ... },
  "p2_resultado":        { "ebitda_real": 0.50, "rentabilidade_imobilizado": 0.50 },
  ...
  "p8_marca":            { "marca_inpi": 0.33, "reputacao": 0.33, "presenca_digital": 0.33 }
}
```

---

## SEÇÃO 5 — TABELAS TRIBUTÁRIAS

**Documento separado:** `/mnt/user-data/outputs/bloco5-tabelas-tributarias.md`

Contém:
- Simples Nacional completo (5 anexos × 6 faixas, regra do Fator R, Anexo IV pagar INSS por fora)
- Lucro Presumido (presunções IRPJ/CSLL por atividade, alíquotas, cálculo trimestral)
- Lucro Real (alíquotas, base sobre RO conforme Decisão #17)
- MEI (limites, valores DAS-MEI 2026, tratamento de fat acima do limite)
- Encargos sobre folha (composição completa, RAT por setor, FAP neutro)
- Mapeamento setor × forma → anexo Simples
- Mapeamento setor × forma → presunção Lucro Presumido
- Algoritmo da skill em pseudo-código
- 4 exemplos auditáveis (Forste, Restaurante, Consultoria PJ, MEI estourado)
- 11 pontos `(verificar)` para validação com contador

---

## SEÇÃO 6 — ORDEM OFICIAL DO DRE (Bloco 2 da revisão)

### 6.1 — Estrutura em 5 blocos

Esta é a ordem **única usada em TODOS os materiais**: diagnóstico T44, laudo gratuito, laudo pago, laudo-fonte, negocio.html após NDA.

```
═══ BLOCO 1 — RECEITA E DEDUÇÕES ═══

   FATURAMENTO BRUTO (mensal)

(−) Deduções da Receita:
   (−) Impostos sobre faturamento (Decisão #14 — calculado pela regra real)
   (−) Custos de recebimento (cartão + antecipação + marketplace + gateway)
   (−) Comissões pagas a terceiros
   (−) Royalties percentuais (% sobre receita — se franqueado)
   (−) Fundo de propaganda percentual (% sobre receita — se franqueado)

(=) RECEITA LÍQUIDA

═══ BLOCO 2 — CMV E LUCRO BRUTO ═══

(−) CMV / CSV (ajustado por pct_produto)

(=) LUCRO BRUTO

═══ BLOCO 3 — DESPESAS OPERACIONAIS ═══

   Despesas com Pessoal:
   (−) Folha CLT bruta
   (−) Encargos CLT (Simples 8% / Presumido-Real ~37,5%)
   (−) PJ / freelancers
   (−) Royalties fixos (R$ — se franqueado)
   (−) Fundo de propaganda fixo (R$ — se franqueado)
   * Provisão CLT 13º+férias NÃO entra aqui (Decisão #20)

   Despesas de Ocupação:
   (−) Aluguel
   (−) Facilities
   (−) Terceirizados

   Despesas Operacionais:
   (−) Sistemas
   (−) Outros custos fixos

   Marketing:
   (−) Marketing pago

(=) RESULTADO OPERACIONAL (RO) ← número que entra no valuation

═══ LINHA DIVISÓRIA ═══
▼▼▼ A partir daqui: informativo, NÃO entra no valuation ▼▼▼

═══ BLOCO 4 — RESULTADO FINANCEIRO E IMPOSTOS SOBRE LUCRO ═══

   Resultado Financeiro:
   (−) Despesas financeiras (juros bancários, IOF)
   (+) Receitas financeiras (rendimento de aplicações)

(=) RESULTADO ANTES DOS IMPOSTOS SOBRE LUCRO

   Impostos sobre Lucro (apenas Presumido e Real):
   (−) IRPJ + CSLL

(=) LUCRO LÍQUIDO

═══ BLOCO 5 — DESEMBOLSOS DO SÓCIO E POTENCIAL DE CAIXA ═══

(−) Pró-labore
(−) Antecipação eventual de recebíveis
(−) Parcelas de dívidas
(−) Investimentos do mês
(−) Distribuição de lucros

(=) POTENCIAL DE CAIXA MENSAL
```

### 6.2 — Regra crítica: cálculo de encargos sobre folha

```
SE regime == "simples" AND anexo != "IV":
  encargos_folha = clt_folha × 0.08  (apenas FGTS — INSS está no DAS)
SENAO (presumido, real, ou simples_anexo_IV):
  rat = parametros.rat_por_setor[setor_code]
  encargos_folha = clt_folha × (0.20 + rat + 0.058 + 0.025 + 0.002 + 0.08)
                 = clt_folha × (0.365 + rat)
```

### 6.3 — Onde cada material exibe o DRE

| Material | Versão do DRE |
|---|---|
| Diagnóstico T44 | Completo (até Potencial de Caixa) |
| Laudo gratuito | Até RO + Potencial de Caixa |
| Laudo pago | Completo + análise por linha |
| Laudo-fonte | Completo + diferenças entre declarado e calculado |
| negocio.html após NDA | Até RO (visão simplificada) |

---

## SEÇÃO 7 — FÓRMULA DE CÁLCULO DO VALUATION (Bloco 1 corrigido)

### 7.1 — Fluxo geral

```
funcao calcular_calc_json(D, parametros_versao):
  P = carregar_snapshot(parametros_versao)

  # 1. DRE (com impostos calculados pela regra real - Decisão #14)
  dre = calcular_dre(D, P.regras_tributarias)

  # 2. Balanço (com provisão CLT calculada - Decisão #20)
  balanco = calcular_balanco(D, P)

  # 3. ISE (8 pilares)
  ise = calcular_ise(D, dre, balanco, P)

  # 4. Valuation (com correções Bloco 1 e Decisão #19)
  valuation = calcular_valuation(D, dre, balanco, ise, P)

  # 5. Atratividade
  atratividade = calcular_atratividade(D, ise, P)

  # 6. Operacional, ICD, Indicadores vs Benchmark
  operacional = calcular_operacional(D, dre)
  icd = calcular_icd(D)
  indicadores = comparar_indicadores_com_benchmark(D, dre, operacional, P)

  # 7. Análise Tributária (3 regimes - Decisão #17)
  analise_trib = calcular_analise_tributaria(D, dre, P)

  # 8. Upsides (regras geradoras)
  upsides = gerar_upsides(D, dre, balanco, ise, indicadores, analise_trib, valuation, P)

  # 9. Inputs origem (rastreabilidade - Decisão #3)
  inputs_origem = registrar_origens(D)

  # 10. Atualiza potencial 12m no valuation
  valuation.potencial_12_meses = somar_upsides_12_meses(upsides, valuation.valor_venda)

  # Montar calc_json final
  return montar_calc_json(...)
```

### 7.2 — Função `calcular_valuation` (versão corrigida)

```
funcao calcular_valuation(D, dre, balanco, ise, P):
  # Ramo: RO ≤ 0 (Decisão #19)
  SE dre.ro_mensal <= 0:
    retorna {
      multiplo_setor: P.multiplos_setor[D.setor_code],
      ajuste_forma_atuacao: calcular_ajuste(D, P),
      multiplo_base: ...,
      fator_ise: ...,
      fator_final: ...,
      ro_anual: dre.ro_anual,
      valor_operacao: 0,
      patrimonio_liquido: balanco.patrimonio_liquido,
      valor_venda: balanco.patrimonio_liquido,
      ro_negativo: true,
      ro_negativo_msg: "Esta empresa está sendo avaliada apenas pelo valor de seus ativos líquidos...",
      cta_especialista: { ativo: true, label: "Agendar conversa com especialista", url: "..." }
    }

  # Ramo normal: RO > 0
  multiplo_setor = P.multiplos_setor[D.setor_code]
  ajuste_forma = calcular_ajuste_multi_select(D.modelo_atuacao_multi, P.ajuste_forma_atuacao)
  multiplo_base = multiplo_setor + ajuste_forma
  fator_ise = encontrar_faixa(ise.total, P.fator_ise).fator
  fator_final = multiplo_base × fator_ise

  valor_operacao = dre.ro_anual × fator_final
  valor_venda = valor_operacao + balanco.patrimonio_liquido    # Bloco 1: SEM max(0, ...)

  # Alertas para casos extremos
  alerta = null
  SE valor_venda < 0:
    alerta = { tipo: "valor_negativo", mensagem: "Dívidas líquidas excedem o valor da operação..." }
  SENAO SE valor_venda < valor_operacao × 0.30:
    alerta = { tipo: "divida_engole_valor", mensagem: "Dívidas líquidas reduzem significativamente..." }

  retorna { ..., valor_operacao, valor_venda, ro_negativo: false, alerta_pl_negativo: alerta }
```

### 7.3 — Função `calcular_ajuste_multi_select`

```
funcao calcular_ajuste_multi_select(formas, P_ajustes):
  SE len(formas) == 0: retorna 0
  ajustes = [(forma, P_ajustes[forma]) para forma em formas]
  ajustes.ordenar_desc_por_valor()
  principal = ajustes[0]
  ajuste_total = principal.valor
  para cada extra em ajustes[1:]:
    diff = extra.valor - principal.valor
    ajuste_total += 0.30 * diff
  retorna ajuste_total
```

---

## SEÇÃO 8 — BALANÇO PATRIMONIAL v2 (Bloco 4 da revisão)

### 8.1 — Estrutura

**Ativos** (todos coletados pelo diagnóstico):
- Caixa, contas a receber, estoque, equipamentos, imóvel próprio, ativo proporcional da franquia (calculado)
- Imobilizado total = equipamentos + imóvel + ativo_franquia (usado no Pilar 7 do ISE)

**Passivos:**
- Saldo devedor de empréstimos
- Fornecedores a vencer
- Fornecedores em atraso
- **Imposto atrasado SEM parcelamento** (NOVO — adicionar campo no T39a do diagnóstico)
- **Provisão CLT 13º+férias** (NOVO — calculado pela skill, Decisão #20)

### 8.2 — Cálculo da provisão CLT (Decisão #20)

```
SE regime == "simples" AND anexo != "IV":
  fator_encargo = 1.08  (FGTS sobre o que será pago)
SENAO:
  rat = parametros.rat_por_setor[setor_code]
  fator_encargo = 1.0 + 0.365 + rat
  # ex: setor servicos_empresas → 1.0 + 0.365 + 0.01 = 1.375

provisao_acumulada = clt_folha × 0.13 × 6 × fator_encargo
```

Onde:
- `0.13` = (1/12 do 13º) + (1/12 × 1/3 das férias)
- `6` = média de meses acumulados (entre 1 e 12)
- `fator_encargo` = ajusta pelo encargo total que incidirá sobre o pagamento

### 8.3 — Patrimônio Líquido

```
PL = TOTAL ATIVOS - TOTAL PASSIVOS
```

Pode ser **positivo ou negativo**. Negativo indica que dívidas líquidas excedem ativos — afeta diretamente `valor_venda` (Bloco 1 corrigido).

---


## SEÇÃO 9 — FLUXO DE EXECUÇÃO

### 9.1 — Cenário C confirmado (Decisão #8 + Decisão #15 + Decisão #18)

```
[Vendedor em diagnostico.html]
       ↓
   Telas T28, T29, T31, etc — cálculos parciais via funções da skill (Decisão #18)
       ↓
   Tela T44 (Revisão)
       ↓
   Click em "Ver revisão"
       ↓
   JS: P = carregar_versao_ativa('parametros_versoes')
   JS: calc_json_preview = AVALIADORA.avaliar(D, P, modo='preview')
   JS: window._calcJsonPreview = calc_json_preview
   JS: renderizarT44(calc_json_preview)
       ↓
   Vendedor confere os números
       ↓
   Click em "Gerar laudo definitivo"
       ↓
   ETAPA 1 — Persiste calc_json (sem textos)
   JS: INSERT INTO laudos_completos (negocio_id, versao=1, ativo=true,
                                     calc_json=window._calcJsonPreview,
                                     parametros_versao_id=P.id)
       ↓
   ETAPA 2 — Dispara Edge Function gerar_textos_laudo (assíncrona)
       ↓
   Redirect /laudo-gratuito.html?id=...
   Laudo renderiza com textos_ia.status = "pendente_geracao"
       ↓
[Edge Function roda em background]
   Tenta 1×, 2×, 3× com backoff (2s, 5s, 10s)
   Cada texto chama Claude API (Haiku ou Sonnet)
       ↓
   Sucesso: UPDATE laudos_completos SET calc_json = jsonb_set(...)
   Falha 3×: marca textos_ia.status = "erro_persistente"
       ↓
[Cron 10min retry pra status pendente_geracao ou erro_persistente]
```

### 9.2 — Fluxo de criação do anúncio (Decisão #15)

```
[Admin ou vendedor decide criar anúncio]
       ↓
   Define titulo_anuncio, preco_pedido, plano (gratuito/guiado)
       ↓
   Click "Criar anúncio"
       ↓
   ETAPA 1 — UPDATE negocios SET titulo_anuncio, preco_pedido, plano, status='publicado'
       ↓
   ETAPA 2 — Dispara Edge Function gerar_textos_anuncio (assíncrona)
   Gera os 3 textos:
     - texto_resumo_executivo_anonimo
     - sugestoes_titulo_anuncio (3 strings)
     - texto_consideracoes_valor (usa preco_pedido real)
       ↓
   UPDATE laudos_completos SET calc_json.textos_anuncio = {...}
       ↓
   Card index e negocio.html já consomem os novos textos
```

### 9.3 — Fluxo de regeneração manual

```
[Admin abre laudo-fonte.html]
   Vê todos os textos
   Click "Regerar texto X"
       ↓
   Edge Function gera só esse texto, atualiza calc_json
       ↓
   Refresh mostra novo texto
```

### 9.4 — Fluxo de reavaliação

```
[Negócio precisa ser reavaliado]
   diagnostico.html?codigo=1N-XXXXXX&modo=reavaliar
   Carrega respostas anteriores (D restaurado)
   Vendedor edita o que precisa
       ↓
   T44 → "Gerar laudo definitivo"
       ↓
   INSERT laudos_completos (versao = max + 1, ativo = true)
   UPDATE laudos_completos SET ativo = false WHERE versao < nova_versao
       ↓
   Versão anterior preservada como ativo=false (histórico imutável - Decisão #7)
```

---

## SEÇÃO 10 — IMPLICAÇÕES NOS ARQUIVOS

### 10.1 — Frontend (HTML/JS)

| Arquivo | Mudança | Esforço |
|---|---|---|
| `skill-avaliadora.js` | Reescrita completa, schema aninhado v2 + remoção de fallbacks hardcoded + leitura de parametros_versoes + análise tributária dos 3 regimes + RO negativo + provisão CLT | Alto (5-7h) |
| `diagnostico.html` | Remover funções de cálculo locais, T44 chama AVALIADORA.avaliar(modo:'preview'). Telas intermediárias (T28, T29, T31) também chamam funções da skill (Decisão #18). Adicionar 1 input em T39a (impostos atrasados) | Médio (3h) |
| `laudo-gratuito.html` (renomeado) | Atualizar leitura para schema aninhado. Adicionar Texto 9 (considerações sobre valor) entre os 3 números e o resto | Médio (2h) |
| `laudo-pago.html` | Atualizar leitura + remover ~200 linhas de código morto + integração com novos textos | Médio (2-3h) |
| `laudo-fonte.html` (reescrita) | Reescrita completa: mostra TUDO (calc_json + dossie_json + textos + decomposições + botões regerar) | Alto (4-5h) |
| `negocio.html` | 2 níveis de visibilidade (antes/após NDA). Anonimização conforme regras_arredondamento | Médio (3h) |
| `painel-admin.html` | Atualizar leitura + aba "Parâmetros" (versionamento) + botão regerar textos | Alto (5-6h) |
| `index.html` | Substituir `negocios.descricao` por `texto_resumo_executivo_anonimo`. Remover fallback hardcoded que vaza dados | Baixo (1h) |

### 10.2 — Edge Functions (novas)

| Edge Function | Função | Esforço |
|---|---|---|
| `gerar_textos_laudo` | Gera os 7 textos analíticos no commit | Alto (3h) |
| `gerar_textos_anuncio` | Gera os 3 textos comerciais na criação do anúncio | Médio (2h) |
| `regerar_texto_individual` | Regeneração manual via painel-admin | Baixo (1h) |
| `cron_textos_pendentes` | Cron 10min retry de textos pendentes | Médio (1.5h) |
| `selic_watcher` | Cron diário consulta BCB, notifica admin se Selic mudou | Médio (2h) |

### 10.3 — Banco de dados

| Item | Ação |
|---|---|
| `laudos_completos` | Adicionar `versao`, `ativo`, `parametros_versao_id`. Remover UNIQUE em `slug`. Adicionar UNIQUE em `(negocio_id, ativo)` deferrable |
| `parametros_versoes` | CREATE TABLE nova |
| `negocios` | Drop ~30 colunas + ADD `dossie_json JSONB` |
| `negocios.calc_json` | DROP COLUMN |
| `laudos` | DROP TABLE |
| `parametros_1n` | INSERT novas chaves canônicas |

### 10.4 — Esforço total estimado

| Categoria | Horas |
|---|---|
| Frontend (HTML/JS) | 25-30h |
| Edge Functions | 9-10h |
| Banco / migrações | 2-3h |
| Painel admin (versionamento) | 4-5h |
| Testes / ajustes | 5-8h |
| **TOTAL** | **45-56h** |

---

## SEÇÃO 11 — GERAÇÃO DE TEXTOS IA

> **Nota rev3 (29/04/2026):** frases prescritivas hardcoded foram **deletadas** dos
> renderers HTML em 29/04 — não foram migradas pra rev3 nem persistidas.
> Frases removidas:
> - Veredicto da Atratividade (5 variantes "alta/atrativa/padrão/limitada/baixa") —
>   prescreviam comportamento de negociação (`"janela 5–10%"`, `"desconto 10–20%"`)
>   sem base empírica. **Geração via IA é o caminho oficial** (Decisão #15 da rev2).
> - `"Negócio já está no regime ótimo"` (vinha de `economia_potencial.observacao`).
> - `"Sua atividade pode estar sujeita ao Fator R..."` (vinha de `fator_r_observacao`)
>   — info do Fator R agora está inline na seção IDENTIFICAÇÃO (alíquota efetiva +
>   Fator R %), sem repetir.
> Schema do calc_json mantém os campos (`economia_potencial.observacao`,
> `fator_r_observacao`, `analise_tributaria.fator_r_calculado`) — só removemos
> o render. Edge Functions de IA (Fase 4) podem reusar esses campos como input.

### 11.1 — Tabela consolidada — onde cada texto aparece

| # | Texto | Modelo | Laudo gratuito | Laudo pago | Laudo fonte | Card index | negocio.html antes NDA | negocio.html após NDA | Painel admin |
|---|---|---|---|---|---|---|---|---|---|
| 1a | Resumo executivo (completo) | Haiku | ✅ topo | ✅ topo | ✅ | ❌ | ❌ | ✅ | ❌ |
| 1b | Resumo executivo (anônimo) | Haiku | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ |
| 2 | Contexto do negócio | Haiku | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| 3 | Parecer técnico | Sonnet | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| 4 | Riscos e atenção | Sonnet | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| 5 | Diferenciais | Haiku | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |
| 6 | Público-alvo comprador | Sonnet | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| 7 | Descrições polidas dos upsides | Haiku | ✅ (4 free) | ✅ (10) | ✅ | ❌ | ❌ | ✅ (resumo) | ❌ |
| 8 | Sugestões de título (3) | Haiku | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| 9 | Considerações sobre valor | Sonnet | ✅ (se delta>15%) | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |

### 11.2 — Quando cada texto é gerado

**Momento 1 — Commit do laudo (T44):**
- Textos 1a, 2, 3, 4, 5, 6, 7

**Momento 2 — Criação do anúncio:**
- Textos 1b, 8, 9

**Regeneração manual (somente admin):** qualquer texto, individual.

### 11.3 — Prompts dos textos

10 prompts completos documentados na Seção 8.3 da spec parcial anterior. Modelos atribuídos:
- **Haiku 4.5** ($1/$5 por MTok): textos 1a, 1b, 2, 5, 7, 8 (descritivos/criativos)
- **Sonnet 4.6** ($3/$15 por MTok): textos 3, 4, 6, 9 (analíticos/julgamento)

### 11.4 — Custos estimados

Por laudo completo (commit): ~R$ 0,22
Por anúncio criado: ~R$ 0,07
Total por negócio: **~R$ 0,29**
Custo mensal estimado (100 laudos + 30 anúncios): **< R$ 50**

### 11.5 — Fallback (3 tentativas + cron)

```
Tentativa 1 → falha → wait 2s
Tentativa 2 → falha → wait 5s
Tentativa 3 → falha → wait 10s
Tentativa 4 → falha → marca status = "erro_persistente"

Cron cada 10min:
  busca calc_json com status in ("pendente_geracao", "erro_persistente")
  tenta de novo (até 3 vezes)
  se 3 falhas → mantém status "erro_persistente"

Painel admin (laudo-fonte):
  exibe alerta visual quando há textos pendentes
  botão "Regerar agora" dispara nova tentativa imediata
```

---

## SEÇÃO 12 — EDGE FUNCTIONS NECESSÁRIAS

### 12.1 — `gerar_textos_laudo`
**Trigger:** chamada do frontend após INSERT em `laudos_completos`
**Input:** `laudo_id`
**Função:** gera 7 textos analíticos via Claude API (Haiku/Sonnet conforme prompts), atualiza calc_json

### 12.2 — `gerar_textos_anuncio`
**Trigger:** chamada após UPDATE de `negocios.preco_pedido` ou criação inicial do anúncio
**Input:** `negocio_id` + `preco_pedido`
**Função:** gera 3 textos comerciais (1b, 8, 9), atualiza calc_json

### 12.3 — `regerar_texto_individual`
**Trigger:** botão no painel-admin (laudo-fonte)
**Input:** `laudo_id` + `texto_id`
**Função:** gera apenas o texto especificado, UPDATE específico

### 12.4 — `cron_textos_pendentes`
**Trigger:** cron 10 minutos (Supabase Cron)
**Função:** retry de laudos com textos pendentes

### 12.5 — `selic_watcher`
**Trigger:** cron diário (9h)
**Função:** consulta BCB, compara com `parametros_1n.selic_anual`. Se diferença > 0,25pp, notifica admin (não atualiza automaticamente — Decisão do admin)

### 12.6 — Padrão de tratamento de erros

Todas as Edge Functions:
```typescript
try {
  // operação
  return new Response(JSON.stringify({ ok: true, data }), { status: 200 })
} catch (error) {
  await supabase.from('logs_edge_functions').insert({
    funcao, laudo_id, erro: error.message, stack: error.stack, timestamp: new Date()
  })
  return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 })
}
```

---

## SEÇÃO 13 — VERSIONAMENTO DE PARÂMETROS

### 13.1 — UX no painel-admin

Nova aba "Parâmetros":
- Versão ativa visível
- Histórico de versões anteriores
- Editor inline de cada chave (JSON com validação)
- Diff visual entre versões
- Botão "Promover nova versão" com confirmação dupla

### 13.2 — Fluxo de promoção

1. Admin edita parâmetros → salva como rascunho (`ativo = false`)
2. Visualiza diff entre versão ativa e rascunho
3. Pode simular avaliação com versão rascunho (sem persistir)
4. Click "Promover" → confirmação
5. Transação atômica: `UPDATE ativo = false` na anterior + `UPDATE ativo = true` na nova

### 13.3 — Diff visual

Mostra mudanças por chave:
```
multiplos_setor:
  servicos_empresas: 2.06 → 2.10 (+0.04)
  educacao: 2.18 → 2.18 (sem mudança)
  ...
```

---

## SEÇÃO 14 — MUDANÇAS NECESSÁRIAS NO DIAGNÓSTICO (mínimas)

### 14.1 — Lista única de mudanças no `diagnostico.html`

1. **Remover funções locais de cálculo:** `gerarDescricaoRevisao`, `preencherConfirmacao`, `calcAvaliacaoFinal`, `calcISEfinal`. Substituir por chamadas à skill (Decisão #18)
2. **T44** chama `AVALIADORA.avaliar(modo:'preview')` em vez de cálculos próprios
3. **Telas intermediárias** (T28, T29, T31, etc.) chamam funções da skill em vez de duplicar lógica
4. **Adicionar 1 input em T39a:** `D.impostos_atrasados` (imposto atrasado SEM parcelamento) — variável já consultada no código mas nunca populada
5. **Não criar telas novas.** Não tocar em outras perguntas.

### 14.2 — Verificação: o que o diagnóstico já cobre (validado na revisão)

- ✅ Marketplace: `D.marketplaces` (T32) + `D.canais` com marketplace (T26)
- ✅ Comissões: `D.tem_comissao`, `D.comissao_pct`, `D.comissao_cobertura`
- ✅ Fornecedores a vencer: `D.fornec_a_vencer`
- ✅ Fornecedores em atraso: `D.fornec_atrasadas`
- ✅ Royalty/marketing toggle %/fixo
- ✅ Fator R: `D.fator_r`, `D.fator_r_pct`
- ✅ CNPJ oficial: `D.cnpj_*` (razão, regime, UF) — usar para validação cruzada
- ✅ Crescimento: `D.crescimento_pct` (histórico) e `D.crescimento_proj_pct` (projetado)

### 14.3 — Validação cruzada com CNPJ oficial

Quando `D.cnpj_regime` está preenchido (consulta automática):
- Comparar com `D.regime` declarado pelo vendedor
- Se diferente → marcar em `analise_tributaria.observacao_cnpj`: "Regime declarado difere do registrado na Receita Federal. Verifique."

### 14.4 — Pendência rev3: breakdown detalhado por categoria de upside (Caminho A)

Documentado em [`relatorios/2026-04-29-pendencia-breakdown-upsides.md`](2026-04-29-pendencia-breakdown-upsides.md). **Não bloqueia v2.**

Mudança proposta no schema:
- Cada `upsides.ativos[]` (e o item correspondente em `potencial_12m.upsides_ativos[]`)
  expõe campos próprios por categoria:
  - **RO:** `valor_atual_brl`, `valor_alvo_brl`, `economia_mensal_brl`,
    `ganho_caixa_12m_brl`, `ganho_avaliacao_brl`.
  - **PASSIVO:** `valor_atual_brl`, `valor_alvo_brl`, `economia_juros_anual_brl`,
    `ganho_avaliacao_brl`.
  - **MULTIPLO:** `delta_multiplo`, `ganho_avaliacao_brl`.
  - **QUALITATIVO:** sem campos monetários (mantém só `descricao`).
  - **TRIBUTARIO:** `economia_anual` (já calculado em `analise_tributaria`) +
    `ganho_avaliacao_brl`.

A skill já calcula esses valores intermediários em `gerarUpsidesV2` e
`agregarPotencial12mV2` mas não os expõe. Cards de upside em laudo-pago e
laudo-admin ganham `<details>` colapsável "▸ Como chegamos nesse valor".

**Custo:** 4.5–5.5h (skill 2-3h, laudo-pago 1h, laudo-admin 0.5h, validação 1h).
**Quando:** atacar pós-Fase 3 (laudo-gratuito + negocio.html v3 fechados).

---

## SEÇÃO 15 — CHECKLIST PASSO 3 (IMPLEMENTAÇÃO)

### Fase 1 — Banco e parâmetros (1-2 dias)
- [ ] Criar tabela `parametros_versoes`
- [ ] Inserir snapshot inicial v2026.04 com todos os parâmetros calibrados
- [ ] Adicionar colunas `versao, ativo, parametros_versao_id` em `laudos_completos`
- [ ] Adicionar `dossie_json` em `negocios`
- [ ] Drop `laudos`, `negocios.calc_json`
- [ ] Drop colunas obsoletas de `negocios`

### Fase 2 — Skill avaliadora v2 (4-5 dias)
- [ ] Reescrever `skill-avaliadora.js` com schema aninhado v2
- [ ] Implementar todas as funções de cálculo (DRE, Balanço com provisão CLT, ISE, Valuation com correções, Atratividade, Indicadores vs Benchmark, Análise Tributária dos 3 regimes, Upsides)
- [ ] Remover TODOS os fallbacks hardcoded
- [ ] Implementar `inputs_origem` em todos os campos
- [ ] Implementar tratamento RO ≤ 0 (Decisão #19)
- [ ] Implementar provisão CLT (Decisão #20)
- [ ] Testar com Forste (resultado esperado: ~R$ 359k com nova ordem do DRE)

### Fase 3 — Frontend laudos (3-5 dias)
- [ ] Renomear `laudo-completo.html` → `laudo-gratuito.html`
- [ ] Atualizar leitura no schema aninhado em `laudo-gratuito`, `laudo-pago`
- [ ] Adicionar Texto 9 (considerações sobre valor) no laudo gratuito
- [ ] Reescrever `laudo-fonte.html` com decomposição completa
- [ ] Atualizar `negocio.html` com 2 níveis de visibilidade

### Fase 4 — Edge Functions (2-3 dias)
- [ ] Implementar `gerar_textos_laudo` com 7 textos
- [ ] Implementar `gerar_textos_anuncio` com 3 textos
- [ ] Implementar `regerar_texto_individual`
- [ ] Implementar `cron_textos_pendentes`
- [ ] Configurar cron Supabase

### Fase 5 — Diagnóstico (1-2 dias)
- [ ] Remover funções de cálculo do `diagnostico.html`
- [ ] Telas intermediárias chamam skill (Decisão #18)
- [ ] T44 chama `AVALIADORA.avaliar(modo:'preview')`
- [ ] Adicionar input em T39a (`impostos_atrasados`)

### Fase 6 — Index e fluxo público (1-2 dias)
- [ ] Atualizar `index.html` para consumir `texto_resumo_executivo_anonimo`
- [ ] Remover fallback hardcoded que vaza dados
- [ ] Testar anonimização completa

### Fase 7 — Painel admin (3-4 dias)
- [ ] Atualizar leitura para schema aninhado
- [ ] Criar aba "Parâmetros" com editor de versões
- [ ] Botão de regeneração manual de textos
- [ ] Diff visual entre versões

### Fase 8 — Selic watcher (1 dia)
- [ ] Edge Function `selic_watcher`
- [ ] Configurar cron diário
- [ ] Configurar canal de notificação

### Fase 9 — Testes e ajustes (3-5 dias)
- [ ] Testar reavaliação (versão 2 mantém versão 1 como histórico)
- [ ] Testar fallback de textos IA
- [ ] Testar promoção de nova versão de parâmetros
- [ ] Validar com Forste e mais 2-3 negócios reais
- [ ] Testar caso RO negativo
- [ ] Testar caso PL negativo
- [ ] Validar cálculos tributários (Bloco 5) com contador

**Total estimado: 19-29 dias de trabalho focado.**

### Pendências fora de escopo da v2 (roadmap futuro)

- Multa por sonegação (calcular impacto no valor de venda quando vendedor declara menos imposto que devia)
- Análise tributária com Lucro Arbitrado
- Multi-currency (R$ + USD pra negócios internacionais)
- Integração com BCB para Selic automática
- Integração com Receita Federal pra validação de CNPJ além de leitura básica
- Forecasting de cenários (otimista/pessimista) no valuation
- Cálculo de créditos PIS/Cofins não-cumulativo no Lucro Real
- Anexo IV do Simples com tratamento detalhado de INSS por fora

---

## ANEXOS

### A.1 — Documentos relacionados

| Arquivo | Função |
|---|---|
| `auditoria-calc-json.md` | Auditoria inicial (Passo 1) |
| `passo2-spec-calc-json-v2-parcial.md` | Versão parcial (substituída) |
| `passo2-spec-calc-json-v2-final.md` | Versão final anterior (substituída por esta REV.2) |
| `bloco5-tabelas-tributarias.md` | Tabelas tributárias completas |
| **`spec-v2-final-rev2.md`** | **ESTE DOCUMENTO** — versão consolidada vigente |

### A.2 — Mudanças vs spec final anterior

| Área | Mudança |
|---|---|
| Decisões | 16 → 20 (adicionadas #17, #18, #19, #20) |
| Fórmula valor_venda | `+ max(0, PL)` → `+ PL` (sem trava) |
| RO negativo | Lógica simplificada e explícita |
| Provisão CLT | Movida do DRE para o Passivo |
| Ordem do DRE | Reorganizada em 5 blocos |
| Análise tributária | 3 regimes detalhados com cálculo passo a passo |
| Tabelas tributárias | Documento separado completo (Bloco 5) |
| Diagnóstico | Adição mínima — 1 input em T39a |

### A.3 — Pontos pra validação com contador (do Bloco 5)

11 itens marcados `(verificar)` no documento de tabelas tributárias. Resumo:
- Sublimite ICMS/ISS R$ 3,6M
- Lista exata de atividades sujeitas ao Fator R
- Limite Lucro Presumido R$ 78M (pode ter mudado)
- Tributação alimentação produz_revende
- Anexo IV pagar INSS por fora
- Limite MEI atualizado
- Valores DAS-MEI 2026
- IRPJ adicional R$ 60k/trim
- Presunção CSLL serviços hospitalares
- Construção civil sem material vs com
- Alíquotas atualizadas 2026

### A.4 — Recursos técnicos

- **Modelos Claude:** Haiku 4.5 ($1/$5 por MTok) + Sonnet 4.6 ($3/$15 por MTok)
- **Stack:** Supabase (Postgres + Edge Functions), Vercel (frontend estático), GitHub (código)
- **Selic referência:** 14% a.a. (monitorada via Edge Function)

### A.5 — Custos operacionais estimados

- Por laudo (commit): R$ 0,22
- Por anúncio: R$ 0,07
- **Total mensal estimado:** < R$ 50 (100 laudos + 30 anúncios + retries)
- Edge Functions Supabase: gratuitas até 500k invocações/mês

---

## SEÇÃO 16 — ESTADO DE IMPLEMENTAÇÃO REV3

Snapshot do que cada decisão da rev3 já tem implementado em 29/04/2026:

| Decisão | Descrição curta | Status | Onde |
|---|---|---|---|
| #1–#20 | Decisões da rev2 | ✅ herdadas | rev2 + skill v2026.07 |
| **#21** | Crescimento usa histórico, não projeção | ✅ implementado | `skill-avaliadora-v2.js` (Frente 2.5, commit `5c938df`); fixtures atualizados (Frente 2.4) |
| **#22** | Categorias técnicas dos upsides | ✅ implementado | snapshot v2026.07 (`upsides_catalogo` em `parametros_versoes`); laudo-admin + laudo-pago refatorados |
| **#23** | Bloco `potencial_12m` com 3 caps | ✅ implementado | `agregarPotencial12mV2` (commit `629359b`); fix gap fator_ise (`f233f0a`) |
| **#24** | Bloco `recomendacoes_pre_venda` | ✅ implementado | skill emite o array; laudo-admin renderiza sub-bloco; laudo-pago idem |
| **#25** | Cards mostram R$ em destaque | ✅ laudo-admin + laudo-pago | a aplicar em laudo-gratuito + negocio.html v3 (Fase 3 continuação) |
| Refinamentos visuais 29/04 | Copy + status PMP/PMR/Ciclo + "Ideal" + frases deletadas + bug peso_pct | ✅ laudo-pago | a replicar parcialmente em laudo-admin/laudo-gratuito conforme aplicável |
| Caminho A (breakdown) | Skill expõe `valor_atual/valor_alvo/economia_*/ganho_*` por categoria | ⏸️ pendente | atacar pós-Fase 3 (4.5–5.5h) |

### Próximos passos imediatos (pós-rev3)

1. **Validação visual final** do laudo-admin + laudo-pago em browser (light + dark) com `?id=demo`.
2. **Fase 3 (continuar):**
   - `laudo-gratuito.html` — criar do zero (subset do laudo-pago, paywalls bloqueados, ~2h).
   - `negocio.html` v3 — página pública do anúncio com 2 níveis antes/depois NDA (~3-4h).
3. **Fase 4** — 5 Edge Functions IA (textos analíticos no commit + textos comerciais na criação do anúncio + cron pendentes + selic_watcher).
4. **Caminho A** (rev3 §14.4) — quando Fase 3 estiver fechada.

---

*Spec v2 — Revisão 3 · 29/04/2026 · 1Negócio · Substitui rev2 (preservada como histórico)*
