# Busca de campos no diagnostico.html — perguntas existentes vs fantasmas da skill

Data: 2026-04-28 · Branch: `backend-v2` · Base: commit `629359b`
Autor: Claude Code (somente leitura, sem mudanças)

Quatro buscas específicas pra mapear o que **existe** no diagnóstico antes de decidir como tratar os fantasmas restantes do ISE.

---

## BUSCA 1 — Separação financeira PF/PJ / como o sócio se paga

**Existe pergunta? SIM**, em `diagnostico.html` linha **2444–2463** (tela `t31`):

> **"Como os sócios são remunerados hoje?"**
> Subtexto: "O pró-labore entra no cálculo do EBITDA ajustado. Se os sócios retiram mais (ou menos) do que o mercado pagaria por aquela função, a gente corrige."

**Campo principal:** `D.remuneracao_socios`

**Domínio de valores:**
- `'fixo'` — botão "Pró-labore fixo mensal"
- `'sobra'` — botão "Retiram o que sobra"
- `'nao'` — botão "Ainda não retiram"

**Default fallback:** `'sobra'` (linha 4202, t31 sem resposta cai em `'sobra'`)

**Campo complementar:** `D.prolabore` (input numérico R$, label "TOTAL RETIRADO POR MÊS (TODOS OS SÓCIOS)") — só preenchido quando `remuneracao_socios === 'fixo'`.

**Não há pergunta direta** sobre:
- "Mistura conta pessoal com conta da empresa"
- "Existe conta bancária PJ separada"
- "Separação formal PF/PJ"

A tela t31 aborda **como o sócio se paga**, não **se há separação contábil/bancária**. Conceitos próximos mas distintos. `D.remuneracao_socios === 'fixo'` é o **proxy mais próximo** disponível: pró-labore fixo formalizado é forte indicador de separação PF/PJ; "retiram o que sobra" sugere mistura informal.

---

## BUSCA 2 — Detalhamento de processos jurídicos

**Existe pergunta com detalhamento.** `diagnostico.html` linha **2746–2774** (tela `t40`):

> **"O negócio está envolvido em algum processo judicial?"**
> Subtexto: "Trabalhista, cível, tributário — tanto como ré quanto como autora. Processos como ré são risco, como autora são ativo potencial."

**Campos disponíveis:**

| campo | tipo | linha | gatilho |
|-------|------|-------|---------|
| `D.processos_juridicos` | string `'sim'/'nao'` | 2752–2753 | sempre |
| `D.passivo_juridico` | number (R$) | 2759 | só se `processos_juridicos === 'sim'` — input "COMO RÉU — VALOR EM RISCO" |
| `D.ativo_juridico` | number (R$) | 2764 | só se `'sim'` — input "COMO AUTOR — VALOR A RECEBER" |
| `D.juridico_tipo` | array multi-select | 2767–2772 | só se `'sim'` — natureza |

**Domínio do `juridico_tipo` (multi-select):**
- `'trabalhista'`
- `'fiscal'`
- `'civil'`
- `'outro'`

**Default fallback:** `D.processos_juridicos = 'nao'` (linha 4234).

**Não há pergunta** sobre:
- Quantidade de processos (número de ações)
- Posição específica (réu/autor) por processo individual — só agregado em valor
- Status (em curso / sentenciado / arquivado)

**Disponível e relevante:** o tipo `'trabalhista'` no array `D.juridico_tipo` é proxy direto pra "tem passivo trabalhista". Pra usar precisa ler `Array.isArray(D.juridico_tipo) && D.juridico_tipo.includes('trabalhista')`.

---

## BUSCA 3 — Presença digital

**Existe pergunta.** `diagnostico.html` linha **1599–1613** (tela `t14`):

> **"O negócio tem presença digital?"**
> Subtexto: "Canais digitais ativos são ativos intangíveis — geram tráfego, leads e receita que não dependem do dono."

**Campo:** `D.online` (multi-select array — função `toggleOnline` em linha 6964)

**Domínio de valores possíveis (botões clicáveis):**
- `'site'` — "Site próprio"
- `'ecommerce'` — "E-commerce"
- `'instagram'` — "Instagram / Redes sociais ativas"
- `'gmaps'` — "Google Meu Negócio / Maps"
- `'marketplace'` — "Marketplace (Mercado Livre, iFood, Booking, Airbnb...)"
- `'nenhum'` — "Sem presença digital" (excludente — desmarca os outros)

**Comportamento:** se `'nenhum'` é selecionado, todos os outros são desmarcados. Se outro é selecionado, `'nenhum'` é removido. (Lógica em `toggleOnline`, linhas 6964–6986.)

**Default fallback:** nenhum (campo só preenchido se vendedor responder t14).

**Campos relacionados encontrados na busca:**
- `D.canais` (linha 1715) — multi-select de canais comerciais (`'ecommerce'`, `'marketplace'`, etc.) — sobreposição parcial com `D.online`, mas `canais` é sobre **vendas**, `online` é sobre **presença**
- `D.meios_selecionados`, `D.marketplaces`, `D.ifood`, etc. — sobre meios de pagamento e marketplaces específicos, não presença digital geral

**`D.online` é o campo certo** pra presença digital. **Domínio é array (não string)** — diferente do que a skill atual espera (`D.presenca_digital` como string `'forte/media/fraca'`).

**Proxy possível** (se aceitável): contar tamanho do array `D.online` excluindo `'nenhum'` como métrica de "robustez de presença digital". Mas isso é decisão de produto.

---

## BUSCA 4 — Reputação online (CONFIRMAÇÃO)

**Confirmado.** `diagnostico.html` linha **1588–1596** (tela `t13`, sub-bloco `c-reputacao`):

> **"Como o público avalia o negócio?"**

**Campo:** `D.reputacao`

**Domínio de valores possíveis (4 valores):**
- `'excelente'` — "Excelente — clientes indicam com frequência"
- `'boa'` — "Boa — sem problemas relevantes"
- `'neutra'` — "Neutra — ainda pouco conhecida"
- `'problemas'` — "Já teve problemas — reclamações ou crises de imagem"

**Default fallback:** linha 4157, `D.reputacao = 'boa'` se a tela passar sem resposta.

**Skill atual lê** `D.reputacao_online` (nome diferente) com domínio `'positiva'/'neutra'/'negativa'` (3 valores). **Mismatch nome+domínio confirmado**.

---

## Sumário do que foi encontrado

| busca | campo no diagnóstico | nome | domínio | tipo | linha | match com skill? |
|-------|---------------------|------|---------|------|-------|------------------|
| 1 (separação PF/PJ) | `D.remuneracao_socios` | diferente | `'fixo'/'sobra'/'nao'` | string | 2451–2453 | ❌ skill espera `D.dre_separacao_pf_pj` |
| 1 complementar | `D.prolabore` | igual | numérico | R$ | 2459 | ✓ skill consome |
| 2 (jurídico) | `D.processos_juridicos` | igual | `'sim'/'nao'` | string | 2752–2753 | ✓ skill consome |
| 2 detalhe | `D.passivo_juridico` | diferente | numérico | R$ | 2759 | ❌ skill ignora; espera `D.passivo_trabalhista` boolean |
| 2 detalhe | `D.juridico_tipo` | diferente | array (`'trabalhista'`/etc) | array | 2768 | ❌ skill ignora; tem `'trabalhista'` como proxy possível pra `passivo_trabalhista` |
| 2 detalhe | `D.ativo_juridico` | — | numérico | R$ | 2764 | ❌ skill ignora |
| 3 (presença digital) | `D.online` | diferente | array de strings (5 opções + `'nenhum'`) | array | 1605–1611 | ❌ skill espera `D.presenca_digital` string |
| 4 (reputação) | `D.reputacao` | diferente | 4 valores `'excelente'/'boa'/'neutra'/'problemas'` | string | 1591–1594 | ❌ skill espera `D.reputacao_online` com 3 valores |

---

## Observações finais (sem decisões)

1. **Dois campos QUE EXISTEM** podem servir de mapeamento direto pros fantasmas da skill:
   - `D.reputacao` → cobre reputação (skill espera `D.reputacao_online`) — mismatch nome+domínio
   - `D.online` → cobre presença digital (skill espera `D.presenca_digital`) — mismatch nome+tipo (string vs array)

2. **Um campo que EXISTE como detalhe**, e pode servir de proxy:
   - `D.juridico_tipo` (array) inclui `'trabalhista'` — proxy possível pra `D.passivo_trabalhista`

3. **Nenhum campo equivale diretamente** a:
   - `D.dre_separacao_pf_pj` (skill espera `'sim'/'parcial'`) — `D.remuneracao_socios === 'fixo'` é proxy aproximado
   - `D.margem_estavel` (não há pergunta sobre estabilidade de margem)
   - `D.impostos_dia` (existe `D.sabe_impostos` que é "vendedor sabe quanto paga", semântica diferente)

4. **Bug latente confirmado para presença digital**: a skill v2 já mistura `D.online` (array) com `D.presenca_digital` (string) em contextos diferentes — `D.online` aparece em `t14`, `D.presenca_digital` é fantasma.

**Sem decisão tomada.** Relatório só identifica o terreno. Ações ficam pra Thiago decidir.
