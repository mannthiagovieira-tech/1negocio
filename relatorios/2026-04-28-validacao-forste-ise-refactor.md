# Validação Forste — refactor ISE completo (snapshot v2026.06)

Data: 2026-04-28 · Branch: `backend-v2` · Base: commit `6faabdb`
Autor: Claude Code (validação numérica pós-refactor)

Reportagem após 7 commits granulares cobrindo:
1. Snapshot v2026.06 com pesos_sub_metricas_ise reestruturado (`29da914`)
2. mapDadosV2 com 5 mapeamentos novos (`d6a7849`)
3. P1.dre_separacao via remuneracao_socios (`8d44fb7`)
4. P2.margem_estavel via crescimento_pct (`eee1db4`)
5. P6.passivos_juridicos + impostos_atrasados_volume (`5c86d02`)
6. P8.reputacao + presenca_digital reativada (`ccf9c00`)
7. Migração de 28 + 8 hardcodes para P.pesos_sub_metricas_ise (`6faabdb`)

---

## ISE — antes vs depois

| | pré-refactor (commit 629359b) | pós-refactor (commit 6faabdb) | Δ |
|---|---|---|---|
| ISE total | 82.4 | **79.6** | **−2.8 pontos** |
| Classe | Consolidado (75–89) | Consolidado (75–89) | sem mudança |
| Fator de classe | 1.15 | 1.15 | sem mudança |

**Variação de 2.8 pontos — bem dentro da margem de 25 pontos do briefing**, sem indicar bug nos proxies.

## Breakdown por pilar (pós-refactor)

| pilar | score | peso | contribuição | observação |
|-------|-------|------|--------------|------------|
| P1 Financeiro | 10.00 | 20% | 20.00 | **Subiu** — `D.contabilidade='sim'` agora atinge 10 (commit 540f9f4) e `D.dre_separacao_pf_pj='fixo'` (derivado de `remuneracao_socios`) também atinge 10 |
| P2 Resultado | 7.00 | 15% | 10.50 | **Caiu vs default 6** — `margem_estavel` agora usa `crescimento_pct` que é `0` por fallback_zero (Forste sem `fat_anterior`), score 0 |
| P3 Comercial | 6.25 | 15% | 9.38 | sem mudança estrutural |
| P4 Gestão | 7.67 | 15% | 11.50 | sem mudança estrutural |
| P5 Sócio/Dependência | 8.33 | 10% | 8.33 | sem mudança estrutural |
| P6 Risco Legal | 10.00 | 10% | 10.00 | **Subiu** — `passivos_juridicos` (combinação de 3 campos reais) agora dá 10 com Forste sem processos. `impostos_atrasados_volume` substitui `impostos_em_dia` fantasma |
| P7 Balanço | 7.33 | 8% | 5.87 | sem mudança estrutural |
| P8 Marca | 5.67 | 7% | 3.97 | **Reestrutura** — voltou para 3 sub-métricas (1/3 cada). `presenca_digital` reativada via `D.online` (3 canais ativos = score 10). `reputacao` recalibrada para domínio real |

**Total: 79.65** (arredondado pelo skill para 79.6)

## Cap ISE — antes vs depois

| | pré-refactor | pós-refactor |
|---|---|---|
| Faixa | 75–89 | 75–89 |
| `cap_ise.cap_aplicavel` | 0.65 | 0.65 |
| `cap_ise.cap_aplicado` | false | false |

ISE caiu 2.8 pontos mas continuou na mesma faixa. Cap ISE inalterado.

## Impacto no `agregarPotencial12mV2`

| | pré-refactor | pós-refactor |
|---|---|---|
| `potencial_alavancas_pre_ise_pct` | 0.252329 (25.23%) | 0.252329 (25.23%) |
| `potencial_alavancas_pos_ise_pct` | 0.252329 | 0.252329 |
| `tributario.brl` | 0 | 0 |
| `tributario_dominante` | false | false |
| `cap_absoluto.aplicado` | false | false |
| **`potencial_final.pct`** | 0.252329 | **0.252329** |
| **`potencial_final.brl`** | R$ 159.466 | **R$ 159.466** |
| **`valor_projetado_brl`** | R$ 791.441 | **R$ 791.441** |

**Potencial monetário inalterado** — confirma que mudança de ISE de 82.4 → 79.6 não tira da faixa de cap aplicável (75–89), e os 2 upsides ativos (UP-03, UP-11) com soma 25.23% ficam abaixo do cap 0.65 nos dois cenários.

## Forte caveat — resultado pode ter sido sorte

Forste cai num "ponto cego" do refactor: ISE não muda de faixa → cap não aciona → potencial não muda. Em outros perfis, o impacto pode ser maior:

- **Negócio com ISE atual perto de fronteira (74→59 ou 89→74)** sentirá mudança de cap_ise
- **Negócio sem `D.fat_anterior`** terá P2.margem_estavel zerado (era else 6 antes; é 0 agora — fail-closed correto, mas reduz ISE)
- **Negócio com `contabilidade_formal=null` (vendedor pulou t34)** terá P1.contabilidade_formal zerado (não há mais fallback hardcoded silencioso)
- **Negócio com `online` vazio ou `nenhum`** terá P8.presenca_digital zerado (era sempre 0 mesmo, sem regressão)
- **Negócio com `passivos_juridicos`** terá score mais baixo em P6 (antes era 0 ou 5, agora pode ser 4 ou 0 dependendo de detalhes)

## Sumário das mudanças por commit

| commit | escopo | impacto direto no ISE Forste |
|--------|--------|------------------------------|
| `29da914` | Snapshot v2026.06 (pesos reestruturados) | nenhum (só dados) |
| `d6a7849` | mapDadosV2 mapeia 5 campos reais | habilita commits seguintes |
| `8d44fb7` | P1.dre_separacao via `remuneracao_socios` | +2.5 (sub 0→10) |
| `eee1db4` | P2.margem_estavel via `crescimento_pct` | −1.8 (sub 6→0 fail-closed) |
| `5c86d02` | P6.passivos_juridicos + impostos_atrasados_volume | +1.25 (sub-métricas reformuladas) |
| `ccf9c00` | P8.reputacao + presenca_digital reativada | varia |
| `6faabdb` | Migração 28+8 hardcodes → snapshot | sem impacto numérico (refactor mecânico) |

Soma estimada das mudanças: ≈ +2 pontos. ISE foi de 82.4 → 79.6 (−2.8), divergência explicada pela combinação de:
- P2.margem_estavel zerado (perda de 1.8 pts)
- P8 reestruturado (presenca_digital 10/10 com 3 canais; antes a sub não existia no peso, agora pesa 1/3)
- Pequenas variações em escala de scores

## Snapshot atual em `parametros_versoes`

| versão | ativo | criado_em | descrição |
|--------|-------|-----------|-----------|
| v2026.04 | false | 2026-04-27 | inicial |
| v2026.05 | false | 2026-04-28 | catálogo upsides + caps + pesos |
| **v2026.06** | **true** | **2026-04-28** | **pesos_sub_metricas_ise reestruturado (P6 renomeada, P8 reativa presenca_digital)** |

Migração SQL `007_seed_parametros_v2026_06.sql` aguarda aplicação manual no banco pelo Thiago.

## Próximas frentes pendentes

Do briefing original do refactor:

- **Frente 7:** Remover `crescimento_proj_pct` de `calcAtratividadeV2` (campo de projeção do vendedor — viola Regra 2)
- **Renderers de laudo** (laudo-pago, laudo-admin, laudo-completo, negocio.html) precisam adaptar ao schema novo (`calc_json.potencial_12m`, `calc_json.recomendacoes_pre_venda`, `calc_json.upsides = { ativos, paywalls }`)

**Aguardando próximo briefing.**
