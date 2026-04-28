# Auditoria 1.1 — campos do D, benchmarks setoriais e mismatches

Data: 2026-04-28 · Branch: `backend-v2` · Base: commit `7598299`
Autor: Claude Code (somente leitura)

Pré-requisito do refactor de `gerarUpsidesV2` para consumir catálogo. Antes de migrar, validar que os campos exigidos pelos gates dos 23 upsides realmente existem na skill e/ou no diagnóstico.

---

## 1. Os 3 campos `⚠️` da auditoria oficial

### `D.aluguel_pct_fat` — ❌ não existe como campo, mas é derivável

- **Em `mapDadosV2`:** o campo coletado é `D.aluguel` (valor absoluto mensal em R$, linha 695). Não há percentual armazenado.
- **No diagnóstico (`diagnostico.html`):** input `i-aluguel` em `t08b` (label "ALUGUEL + CONDOMÍNIO + IPTU / MÊS"). Captura valor absoluto.
- **Já existe pronto na skill:** `calcJson.indicadores_vs_benchmark.aluguel_pct.valor` é calculado por `calcIndicadoresV2` (linha 1988) como `dre.ocupacao.aluguel / dre.fat_mensal × 100`. Valor formatado em pontos percentuais.
- **Recomendação:** o gate de **UP-03 `ro_renegociar_custos_fixos`** deve ler **`indicadores.aluguel_pct.valor`** ou recalcular `dre.ocupacao.aluguel / dre.fat_mensal × 100` localmente. Não inventar campo `D.aluguel_pct_fat`.

### `D.folha_pct_fat` — ❌ não existe como campo, mas é derivável

- **Em `mapDadosV2`:** os campos coletados são `D.clt_folha` (folha CLT bruta R$/mês), `D.pj_custo` (custo PJ R$/mês), `D.prolabore`. Não há percentual.
- **No diagnóstico:** inputs `i-clt-folha` e `i-pj-custo` em `t30` capturam valores absolutos. Folha total é calculada via `calcFolha()`.
- **Já existe pronto na skill:** `calcJson.indicadores_vs_benchmark.folha_pct.valor` (linha 1980), derivado de `dre.pessoal.folha_total / dre.fat_mensal × 100`.
- **Recomendação:** o gate de **UP-05 `ro_reduzir_custo_folha`** deve ler **`indicadores.folha_pct.valor`** ou recalcular `dre.pessoal.folha_total / dre.fat_mensal × 100`.

### `D.canal_principal_pct` — ❌ não existe e não é usado

- **Em `mapDadosV2`:** nenhum campo `canal_*`.
- **No diagnóstico:** zero ocorrências de `canal` como variável no `D` (ver `grep -n "D\.canal" diagnostico.html` → nada).
- **Em qual upside seria usado?** Re-li o briefing inteiro. **Nenhum dos 23 UPs propostos usa `D.canal_principal_pct` no gate.** O campo aparece apenas na lista de auditoria 1.1, mas não tem consumidor.
- **Recomendação:** remover do escopo da auditoria 1.1 (não há ação necessária, pois nenhum upside depende dele). Se Thiago quer reservar pra futuro, ok — mas nenhum upside hoje precisa.

---

## 2. Campos adicionais descobertos durante a leitura dos 23 gates

Encontrei outros 4 campos exigidos pelos UPs propostos que não estão na lista oficial das 1.1, mas precisam de validação antes da migração.

### `D.custos_fixos_pct_fat` — ❌ não existe; semântica precisa ser definida

Citado no gate de **UP-03 `ro_renegociar_custos_fixos`**:
> Gate: `D.aluguel_pct_fat > ... OU D.custos_fixos_pct_fat > P.benchmarks_setor[setor].custos_fixos_max`

- **Em `mapDadosV2`:** existem `D.custo_sistemas`, `D.custo_outros`, `D.custo_utilities`, `D.custo_terceiros`, `D.aluguel`. Não há agregado `custos_fixos_pct_fat`.
- **No DRE calculado:** `dre.ocupacao.total_mensal` (aluguel+facilities+terceirizados) e `dre.operacional_outros.total_mensal` (sistemas+outros_cf+mkt_pago).
- **Decisão pendente:** o que conta como "custos fixos" pra esse upside?
  - (a) Apenas `outros_cf` (`dre.operacional_outros.outros_cf`)?
  - (b) Toda a ocupação + operacional outros (excluindo MKT pago)?
  - (c) Todo o "fixo" do DRE (excluindo CMV)?

  Sugiro **(b) `dre.ocupacao.total_mensal + dre.operacional_outros.outros_cf + dre.operacional_outros.sistemas`** (o que "renegociar custos fixos" tipicamente endereça: aluguel, utilities, sistemas, outros).

  **Aguardo decisão do Thiago.**

### `D.sistemas` (valor `'sim'/'não'`) — ❌ não existe na semântica do briefing

Citado no gate de **UP-16 `rec_implementar_sistemas`**:
> Gate: `D.sistemas !== 'sim'`

- **Em `mapDadosV2`:** existe `D.custo_sistemas` (valor R$/mês de gastos com sistemas — linha 706). Não existe `D.sistemas` como string `'sim'/'não'`.
- **No diagnóstico:** input `i-custo-sistemas` em t30 (label "SISTEMAS / SOFTWARES / SEGUROS") captura valor absoluto. Em `t-sistemas-lista` (linha 2515) há também "QUAIS SISTEMAS?" mas não pude rastrear o nome final do campo no `D`.
- **Recomendação:** o gate deve ser **`n(D.custo_sistemas) === 0`** (negócio não investe em sistemas) em vez de `D.sistemas !== 'sim'`. Mantém a semântica do upside ("recomenda implementar sistemas") sem inventar campo novo.

  **Aguardo decisão do Thiago.**

### `D.presenca_digital` — ⚠️ skill lê, mas diagnóstico nunca salva

- **Em `skill-avaliadora-v2.js:756`:** `const presenca_digital = d.presenca_digital || dados.presenca_digital || null;`
- **Em `skill-avaliadora-v2.js:1398–1399`:** P8 sub-métrica usa valores `'forte'/'media'/'fraca'`.
- **No diagnóstico:** **zero ocorrências** de `presenca_digital`. O campo nunca é populado.
- **Implicação:** P8.presenca_digital sempre cai em score 0 (linha 1399: `pd === 'forte' ? 10 : pd === 'media' ? 6 : pd === 'fraca' ? 3 : 0`). Bug latente já hoje.
- **UP-18 `rec_estruturar_presenca_digital` gate:** `D.presenca_digital === 'fraca' OU D.presenca_digital === 'inexistente'`. Como o campo é sempre `null`, **gate nunca dispara**.
- **Recomendação:** ou (a) adicionar pergunta no diagnóstico, ou (b) remover UP-18, ou (c) fazer gate disparar sempre que `D.presenca_digital == null` (proxy: presença não declarada = não estruturada).

  **Aguardo decisão do Thiago.**

### `D.reputacao_online` — ⚠️ mismatch entre skill e diagnóstico

- **Em `skill-avaliadora-v2.js:755`:** `const reputacao_online = d.reputacao_online || dados.reputacao_online || null;`
- **Em `skill-avaliadora-v2.js:1395–1396`:** P8 sub-métrica usa valores `'positiva'/'neutra'/'negativa'`.
- **No diagnóstico (linhas 1591–1594):** `D.reputacao` (não `reputacao_online`) com valores `'excelente'/'boa'/'neutra'/'problemas'`.
- **Implicação:** mismatch duplo — nome do campo (`reputacao` vs `reputacao_online`) e domínio dos valores (`excelente/boa/problemas` vs `positiva/negativa`). P8.reputacao_online sempre cai em score 5 (default `else 5` na linha 1396). Bug latente.
- **UP-19 `rec_construir_reputacao_online` gate:** `D.reputacao_online === 'fraca' OU D.reputacao_online === 'inexistente'`. **Gate nunca dispara** porque domínio de valores não bate.
- **Recomendação:** durante a migração para o catálogo, padronizar pro nome `D.reputacao` e domínio `'excelente/boa/neutra/problemas'`. Gate pode ser `D.reputacao === 'problemas' || D.reputacao == null`. Skill atualiza P8 para o domínio correto.

  **Aguardo decisão do Thiago.**

---

## 3. Benchmarks setoriais — auditoria do snapshot `v2026.04`

### Estrutura atual no snapshot

O snapshot tem **dois objetos separados** por setor (não um `benchmarks_setor` unificado como o briefing sugere):

**`benchmarks_dre[setor]`** (12 setores) — chaves disponíveis:
- `cmv`, `folha`, `aluguel`, `outros_cf`, `mkt`, `margem_op`, `deducoes`

**`benchmarks_indicadores[setor]`** (12 setores) — chaves disponíveis:
- `margem_bruta`, `concentracao_max`, `pmr`, `pmp`, `recorrencia_tipica`

### Mapeamento entre nomes do briefing e nomes do snapshot

| nome no briefing | localização no snapshot | status |
|------------------|-------------------------|--------|
| `margem_op_benchmark` | `benchmarks_dre[setor].margem_op` | ✅ existe (renomear em código) |
| `margem_bruta_benchmark` | `benchmarks_indicadores[setor].margem_bruta` | ✅ existe (renomear em código) |
| `recorrencia_tipica` | `benchmarks_indicadores[setor].recorrencia_tipica` | ✅ existe |
| `concentracao_max` | `benchmarks_indicadores[setor].concentracao_max` | ✅ existe |
| `aluguel_max` | `benchmarks_dre[setor].aluguel` | ⚠ existe, mas semântica é "valor benchmark", não "máximo tolerável" — vide nota abaixo |
| `folha_max` | `benchmarks_dre[setor].folha` | ⚠ idem |
| `custos_fixos_max` | ❌ não existe | precisa criar |

### Nota sobre `_max` vs benchmark

Os campos `benchmarks_dre[setor].aluguel`, `.folha`, `.outros_cf` etc. são **valores de referência setorial** (o que o setor tipicamente gasta), não "máximos toleráveis".

Forste setor `servicos_empresas` tem `benchmarks_dre.servicos_empresas.aluguel = 5` (5%). Isso é o **alvo** do setor. O gate dos UPs `_max` quer disparar **acima** do alvo.

**Decisão pendente:**
1. **Reusar os benchmarks como `_max`** (gate dispara quando `valor > benchmark`). Simples, mas conceitualmente impreciso ("o benchmark é alvo, não teto").
2. **Adicionar `aluguel_max`, `folha_max`, `custos_fixos_max` ao snapshot** com valores ligeiramente acima do benchmark (ex: benchmark + 30%). Mais preciso, mas exige calibração de 12 setores × 3 campos = 36 valores novos.
3. **Usar fórmula no código:** `gate: D.aluguel_pct_fat > P.benchmarks_dre[setor].aluguel × 1.3` (ex: dispara quando 30% acima do alvo). Sem dados novos no snapshot, mas hardcoda o `1.3`.

**Sugestão minha (que pode ser sobreposta pelo Thiago):** opção 2. Adicionar os 3 campos `_max` por setor com calibração dada pelo Thiago. **NÃO inventar valores** — listar os 12 setores e aguardar Thiago preencher.

### Setores que precisam de calibração (caso opção 2)

```
servicos_empresas  · educacao        · saude          · bem_estar
beleza_estetica    · industria       · hospedagem     · logistica
alimentacao        · servicos_locais · varejo         · construcao
```

Para cada um, Thiago precisa fornecer:
- `aluguel_max` (% do faturamento — acima desse valor o gate dispara)
- `folha_max` (idem)
- `custos_fixos_max` (idem — depende da decisão sobre o que conta como "custos fixos" — vide ponto 2 acima)

---

## 4. Resumo executivo + decisões pendentes pra Thiago

### Campos `⚠️` da auditoria oficial 1.1
| campo | existe? | derivável? | recomendação |
|-------|---------|------------|--------------|
| `D.aluguel_pct_fat` | ❌ | ✅ via `dre.ocupacao.aluguel / dre.fat_mensal` ou `indicadores.aluguel_pct.valor` | usar derivado, não inventar campo |
| `D.folha_pct_fat` | ❌ | ✅ via `dre.pessoal.folha_total / dre.fat_mensal` ou `indicadores.folha_pct.valor` | usar derivado |
| `D.canal_principal_pct` | ❌ | ❌ | nenhum upside da lista usa — remover do escopo da auditoria |

### Campos adicionais
| campo | situação | recomendação |
|-------|----------|--------------|
| `D.custos_fixos_pct_fat` | não existe; semântica indefinida | definir composição (sugiro ocupação + sistemas + outros_cf) |
| `D.sistemas` (`'sim'/'não'`) | não existe; só existe `D.custo_sistemas` (R$) | usar `n(D.custo_sistemas) === 0` |
| `D.presenca_digital` | skill lê mas diagnóstico nunca salva | adicionar pergunta no diagnóstico, ou remover UP-18, ou tratar `null` como "não estruturada" |
| `D.reputacao_online` | mismatch com `D.reputacao` no diagnóstico | padronizar nome e domínio de valores |

### Benchmarks setoriais
| campo | localização atual | ação |
|-------|-------------------|------|
| `margem_op_benchmark` | `benchmarks_dre[setor].margem_op` | renomear no código |
| `margem_bruta_benchmark` | `benchmarks_indicadores[setor].margem_bruta` | renomear no código |
| `recorrencia_tipica` | `benchmarks_indicadores[setor].recorrencia_tipica` | sem mudança |
| `concentracao_max` | `benchmarks_indicadores[setor].concentracao_max` | sem mudança |
| `aluguel_max` | não existe (existe `aluguel` como benchmark) | decidir entre 3 opções acima |
| `folha_max` | não existe (existe `folha` como benchmark) | idem |
| `custos_fixos_max` | não existe | depende da decisão sobre composição |

### Bugs latentes encontrados durante a auditoria

1. **P8.presenca_digital** sempre cai em score 0 (campo nunca é populado pelo diagnóstico).
2. **P8.reputacao_online** sempre cai em score 5 (mismatch de nome/valores entre skill e diagnóstico).

Esses são bugs **pré-existentes** no ISE atual, não criados por este refactor. Estão fora do escopo do briefing mas vale Thiago saber.

### Impacto na contagem do catálogo

Sem decisões adicionais, o catálogo vai entre **17 e 22** upsides:

- 23 propostos
- −1 se removermos `D.canal_principal_pct` do escopo (sem impacto, ninguém usa)
- −2 se removermos UP-18 (`rec_estruturar_presenca_digital`) e UP-19 (`rec_construir_reputacao_online`) por não-coletados
- −1 se removermos UP-16 (`rec_implementar_sistemas`) caso Thiago não queira aceitar a substituição `D.custo_sistemas === 0`
- −1 se removermos UP-03 (`ro_renegociar_custos_fixos`) caso Thiago não queira definir composição de custos_fixos
- −1 se removermos UP-05 (`ro_reduzir_custo_folha`) sem `folha_max` calibrado por setor
- −1 se removermos UP-03 sem `aluguel_max`/`custos_fixos_max` calibrados

**Caminho mais conservador (menos novos benchmarks):** opção 3 dos benchmarks (`× 1.3` no código) + tratamentos sugeridos pra mismatches → catálogo final de **22 upsides** (só `canal_principal_pct` cai).

**Caminho mais correto (snapshot calibrado):** opção 2 dos benchmarks + Thiago preenche 36 valores novos → catálogo final de **22 upsides**.

**Caminho mais rigoroso (sem mismatches):** opção 2 dos benchmarks + remover UP-18, UP-19, UP-16, UP-03, UP-05 → catálogo final de **17 upsides**.

---

## 5. Decisões pedidas explicitamente

1. `D.canal_principal_pct` — confirmar remoção do escopo (nenhum upside usa)?
2. `D.custos_fixos_pct_fat` — qual composição?
3. `D.sistemas` — aceitar `n(D.custo_sistemas) === 0` como gate?
4. `D.presenca_digital` — adicionar pergunta no diagnóstico, remover UP-18, ou tratar `null` como "não estruturada"?
5. `D.reputacao_online` — padronizar para `D.reputacao` com domínio do diagnóstico?
6. `aluguel_max` / `folha_max` / `custos_fixos_max` — opção 1 (reusar benchmark), 2 (snapshot calibrado), ou 3 (× fator no código)?
7. Bugs latentes do P8 (presenca_digital sempre 0, reputacao_online sempre 5) — endereçar neste refactor ou commit separado?

**Não vou avançar pro snapshot novo (commit 2 da sequência) sem essas decisões.**
