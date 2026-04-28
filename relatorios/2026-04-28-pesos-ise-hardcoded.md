# Pesos hardcoded do ISE — pré-migração para `parametros_versoes`

Data: 2026-04-28 · Branch: `backend-v2` · Base: commit `4e77e07`
Autor: relatório gerado por Claude Code (somente leitura)

## Estado atual

A skill calcula ISE a partir de **8 pilares**, cada pilar com 3 ou 4 sub-métricas.

Existem **dois níveis de peso**:

1. **Peso do pilar no ISE total** — vem de `P.pesos_ise.<pilar>` no snapshot, **com fallback hardcoded**.
2. **Peso de cada sub-métrica dentro do pilar** — **100% hardcoded inline**, sem qualquer chave em `parametros_versoes`.

O briefing (item 6.3) pede a migração de **pesos das sub-métricas** para `P.pesos_sub_metricas_ise`. Os pesos dos pilares já estão parametrizados (com fallback) — esses ficam como estão.

## Pesos dos pilares (já parametrizados)

| pilar | chave em P | fallback no código | fonte |
|-------|------------|--------------------|-------|
| p1_financeiro | `P.pesos_ise.p1_financeiro` | `0.20` | snapshot v2026.04 ✓ |
| p2_resultado | `P.pesos_ise.p2_resultado` | `0.15` | snapshot v2026.04 ✓ |
| p3_comercial | `P.pesos_ise.p3_comercial` | `0.15` | snapshot v2026.04 ✓ |
| p4_gestao | `P.pesos_ise.p4_gestao` | `0.15` | snapshot v2026.04 ✓ |
| p5_socio_dependencia | `P.pesos_ise.p5_socio_dependencia` | `0.10` | snapshot v2026.04 ✓ |
| p6_risco_legal | `P.pesos_ise.p6_risco_legal` | `0.10` | snapshot v2026.04 ✓ |
| p7_balanco | `P.pesos_ise.p7_balanco` | `0.08` | snapshot v2026.04 ✓ |
| p8_marca | `P.pesos_ise.p8_marca` | `0.07` | snapshot v2026.04 ✓ |
| **total** | — | **1.00** ✓ | — |

**Sugestão durante migração:** remover os fallbacks hardcoded duplicados (linhas 1182, 1211, 1242, 1284, 1305, 1324, 1353, 1387). Se `parametros_versoes` perder a chave, é melhor falhar explicitamente do que rodar com fallback silencioso desatualizado.

## Pesos das sub-métricas (TODOS hardcoded inline)

### P1 — Financeiro (linhas 1201–1206)

| sub-métrica | id | peso_decimal hardcoded |
|-------------|----|-----------------------|
| Margem operacional vs benchmark setorial | `margem_op_pct` | `0.25` |
| Separação PF/PJ no DRE | `dre_separacao` | `0.25` |
| Fluxo de caixa operacional positivo | `fluxo_caixa_positivo` | `0.25` |
| Contabilidade formal | `contabilidade_formal` | `0.25` |
| **soma** | | **1.00** ✓ |

### P2 — Resultado (linhas 1233–1237) ⚠ desigual

| sub-métrica | id | peso_decimal hardcoded |
|-------------|----|-----------------------|
| Resultado anual positivo | `ebitda_real` | `0.50` |
| Margem estável ou crescente | `margem_estavel` | `0.30` |
| Rentabilidade do imobilizado vs Selic | `rentabilidade_imobilizado` | `0.20` |
| **soma** | | **1.00** ✓ |

⚠ **P2 é o único pilar com pesos desiguais.** O `ebitda_real` é binário (10 se RO_anual > 0, senão 0 — linha 1213). Dar 50% do pilar a um boolean parece desproporcional. Confirmar origem desse 0.50/0.30/0.20 — talvez Thiago tenha razão pra isso, mas não há comentário.

### P3 — Comercial (linhas 1274–1279)

| sub-métrica | id | peso_decimal hardcoded |
|-------------|----|-----------------------|
| Número de clientes ativos | `num_clientes` | `0.25` |
| Recorrência vs benchmark | `recorrencia_pct` | `0.25` |
| Concentração de clientes vs limite | `concentracao_pct` | `0.25` |
| Base de clientes documentada | `base_clientes_documentada` | `0.25` |
| **soma** | | **1.00** ✓ |

### P4 — Gestão (linhas 1296–1300)

| sub-métrica | id | peso_decimal hardcoded |
|-------------|----|-----------------------|
| Processos documentados | `processos_documentados` | `1/3` |
| Possui gestor dedicado | `tem_gestor` | `1/3` |
| Investe em sistemas/ERP | `sistemas_implantados` | `1/3` |
| **soma** | | **0.999...** ≈ 1.00 ✓ |

### P5 — Sócio / Dependência (linhas 1315–1319) ⚠ projeção embutida

| sub-métrica | id | peso_decimal hardcoded |
|-------------|----|-----------------------|
| Opera sem o dono | `opera_sem_dono` | `1/3` |
| Equipe permanece pós-venda | `equipe_permanece` | `1/3` |
| Pró-labore documentado | `prolabore_documentado` | `1/3` |
| **soma** | | **0.999...** ≈ 1.00 ✓ |

⚠ **`equipe_permanece` é projeção do vendedor sobre comportamento futuro de terceiros pós-venda.** Linha 1311: `s2 = ep === 'sim' ? 10 : ep === 'provavelmente' ? 6 : 0`. Isso é exatamente o tipo de "Coisa A" (opinião não-validada) que a Regra 2 do briefing pede pra remover de scores.

**Decisão pendente do Thiago:** remover essa sub-métrica do P5? Ou substituir por critério baseado em dado realizado (ex: tempo médio de permanência da equipe atual)?

⚠ **`prolabore_documentado` (linha 1313):** `s3 = D.prolabore > 0 ? 8 : 5`. A nota é maior quando **TEM** pró-labore (8 vs 5). O texto da sub-métrica é "pró-labore documentado" — supõe-se que ter pró-labore > 0 é proxy de "documentado". Lógica funciona, mas é frouxa: alguém que paga pró-labore sem documentar formalmente recebe nota 8 igual quem documenta.

### P6 — Risco Legal (linhas 1343–1348)

| sub-métrica | id | peso_decimal hardcoded |
|-------------|----|-----------------------|
| Sem passivo trabalhista | `sem_passivo_trabalhista` | `0.25` |
| Sem ações judiciais | `sem_acao_judicial` | `0.25` |
| Impostos em dia | `impostos_em_dia` | `0.25` |
| Volume de impostos atrasados | `sem_impostos_atrasados` | `0.25` |
| **soma** | | **1.00** ✓ |

### P7 — Balanço (linhas 1378–1382)

| sub-métrica | id | peso_decimal hardcoded |
|-------------|----|-----------------------|
| Patrimônio líquido positivo | `patrimonio_positivo` | `1/3` |
| Liquidez (ativos / passivos) | `liquidez` | `1/3` |
| NCG vs faturamento mensal | `ncg_saudavel` | `1/3` |
| **soma** | | **0.999...** ≈ 1.00 ✓ |

### P8 — Marca / Reputação (linhas 1401–1405)

| sub-métrica | id | peso_decimal hardcoded |
|-------------|----|-----------------------|
| Marca registrada no INPI | `marca_inpi` | `1/3` |
| Reputação online | `reputacao_online` | `1/3` |
| Presença digital | `presenca_digital` | `1/3` |
| **soma** | | **0.999...** ≈ 1.00 ✓ |

## Estrutura proposta para `P.pesos_sub_metricas_ise`

```json
{
  "p1_financeiro": {
    "margem_op_pct": 0.25,
    "dre_separacao": 0.25,
    "fluxo_caixa_positivo": 0.25,
    "contabilidade_formal": 0.25
  },
  "p2_resultado": {
    "ebitda_real": 0.50,
    "margem_estavel": 0.30,
    "rentabilidade_imobilizado": 0.20
  },
  "p3_comercial": {
    "num_clientes": 0.25,
    "recorrencia_pct": 0.25,
    "concentracao_pct": 0.25,
    "base_clientes_documentada": 0.25
  },
  "p4_gestao": {
    "processos_documentados": 0.333333,
    "tem_gestor": 0.333333,
    "sistemas_implantados": 0.333334
  },
  "p5_socio_dependencia": {
    "opera_sem_dono": 0.333333,
    "equipe_permanece": 0.333333,
    "prolabore_documentado": 0.333334
  },
  "p6_risco_legal": {
    "sem_passivo_trabalhista": 0.25,
    "sem_acao_judicial": 0.25,
    "impostos_em_dia": 0.25,
    "sem_impostos_atrasados": 0.25
  },
  "p7_balanco": {
    "patrimonio_positivo": 0.333333,
    "liquidez": 0.333333,
    "ncg_saudavel": 0.333334
  },
  "p8_marca": {
    "marca_inpi": 0.333333,
    "reputacao_online": 0.333333,
    "presenca_digital": 0.333334
  }
}
```

(Nos pilares com 1/3, o último cobre o erro de arredondamento para somar exatamente 1.00 — convenção comum.)

## Resumo executivo

- **8 pilares × 3–4 sub-métricas = 28 pesos hardcoded inline** (todos somam corretamente 1.00 dentro do pilar)
- **Migração mecânica** (preserva todos os números atuais) é segura — pode ir direto para `P.pesos_sub_metricas_ise` sem mudar comportamento
- **2 pesos suspeitos** identificados durante a auditoria, **fora do escopo da migração mecânica**:
  1. **P2 distribuição 0.50/0.30/0.20** — único pilar desbalanceado, com `ebitda_real` (binário) levando 50%. Validar origem.
  2. **P5 `equipe_permanece`** — sub-métrica baseada em projeção do vendedor sobre comportamento futuro. Viola a Regra 2 do briefing. Decidir: remover, substituir, ou manter por enquanto?
- **Sugestão extra:** remover os 8 fallbacks hardcoded em P1–P8 (linhas 1182, 1211, 1242, 1284, 1305, 1324, 1353, 1387) durante o mesmo PR — se o snapshot não tem `pesos_ise`, é bug e deve falhar visivelmente.

**Pronto para migração mecânica aguardando decisão sobre os 2 pontos suspeitos acima e o ajuste dos fallbacks.**
