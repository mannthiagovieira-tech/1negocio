# Pendência arquitetural — Breakdown detalhado dos upsides

**Data registro:** 29/04/2026
**Origem:** Sessão de validação visual do laudo-pago
**Status:** Registrada como evolução futura, não bloqueia v2

## Contexto

Durante validação do laudo-pago, identificou-se que os cards de upside mostram apenas o "ganho no valor de venda" (ex: R$ 30.406) em destaque, mas não mostram o breakdown de como esse número foi calculado.

Thiago pediu para incluir breakdown tipo:
- Economia mensal estimada
- Ganho de caixa em 12 meses
- Ganho no valor de venda

## Análise técnica

### Caminho B (descartado): derivar no laudo-pago

Tentativa: usar `(ro_anual × contribuicao_pct) / 12` como economia mensal.

**Falha em 4 de 5 cenários testados:**
- Renegociar custos fixos: funciona por coincidência (não é o cálculo real)
- Diversificar carteira de clientes: número derivado não significa nada (upside afeta múltiplo, não RO)
- Reduzir PMR: não afeta RO, afeta capital de giro
- Mudar regime tributário: já tem `economia_anual` calculado, derivação desperdiça info
- Quitar dívidas: não afeta RO, afeta passivo financeiro

**Conclusão:** Caminho B é insustentável. A heurística assume que todo upside afeta RO da mesma forma, o que é falso.

### Caminho A (recomendado): skill expor breakdown por categoria

A skill já calcula os valores intermediários em `gerarUpsidesV2` e `agregarPotencial12mV2`, mas só expõe `contribuicao_pct` e `contribuicao_brl` no JSON final.

**Proposta:** cada categoria de upside expõe os campos que fazem sentido para ela:

```json
{
  "id": "ro_renegociar_custos_fixos",
  "categoria": "ro",
  "valor_atual_brl": 9000,
  "valor_alvo_brl": 6500,
  "economia_mensal_brl": 2500,
  "ganho_caixa_12m_brl": 30000,
  "ganho_avaliacao_brl": 30406,
  "contribuicao_pct": 4.81,
  "fonte_calculo": "(custos_fixos_atual - custos_fixos_benchmark)"
}
```

**Estrutura por categoria:**

- **RO (Resultado Operacional):** valor_atual + valor_alvo + economia_mensal + ganho_caixa_12m + ganho_avaliacao
- **PASSIVO (Redução de Passivos):** valor_atual + valor_alvo + economia_juros_anual + ganho_avaliacao
- **MULTIPLO (Aumento de Múltiplo):** delta_multiplo + ganho_avaliacao (sem economia em caixa)
- **QUALITATIVO:** sem valores monetários (mantém só descrição)
- **TRIBUTARIO:** economia_anual (já calculado em analise_tributaria) + ganho_avaliacao

## Custo estimado

- Skill: 2-3h (expor campos que já são calculados internamente)
- Laudo-pago: 1h (consumir os novos campos no card colapsável)
- Laudo-admin: 0.5h (mostrar breakdown também na auditoria)
- Validação Forste + 2-3 negócios: 1h
- Total: 4.5-5.5h

## Quando atacar

- Atacar em sessão fresca (não no fim do dia)
- Atacar após Fase 3 (laudo-gratuito + negocio.html v3) estar fechada
- Pode entrar como evolução pra spec rev3 ou diretamente como melhoria pós-merge

## Decisão temporária (28/04 → 29/04)

Manter cards do laudo-pago e laudo-admin como estão hoje:
- R$ em destaque (ganho de avaliação)
- Pill da categoria
- Notinha "↑ ganho estimado no valor de venda do negócio se a ação for executada"
- Sem breakdown

Quando o Caminho A for implementado, expandir os cards com `<details>` colapsável "▸ Como chegamos nesse valor".

## Referências

- Sessão de 28/04 a 29/04 → discussão completa
- Spec rev2 não cobre breakdown
- 5 evoluções aprovadas pra spec rev3 estão em `relatorios/2026-04-28-handoff-fim-de-sessao.md`
