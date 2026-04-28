# Fixtures de validação da skill

Scripts ad-hoc que provaram valor durante o refactor do ISE (commits `312e3f2`–`5c938df`).
Não são testes automatizados — não tem runner, não tem CI, não tem coverage. São
fixtures de validação manual que rodaram em pontos-chave do refactor pra confirmar
correções e detectar regressões.

## Como rodar

Cada fixture é stand-alone. A partir da raiz do repo:

```
node validacao/skill-fixtures/<arquivo>.js
```

Os fixtures montam o snapshot esperado em runtime parseando as migrations SQL
(`migrations/002`, `005`, `006`, `007`, `008`), mockam `window.fetch` para devolver
o snapshot, requerem `skill-avaliadora-v2.js` e rodam contra fixture Forste sintética.

## Mapa dos fixtures

| arquivo | propósito | bugs / decisões que ajudou a flagar |
|---------|-----------|-------------------------------------|
| `test-mapdados.js` | smoke test de `mapDadosV2` — confirma que os 5 mapeamentos novos (commit `d6a7849`) derivam corretamente para os nomes legados (`dre_separacao_pf_pj`, `reputacao_online`, `presenca_digital`, `juridico_tipo`, `passivo_juridico`) | confirmou que `gestor_autonomo` deriva tem_gestor + opera_sem_dono |
| `test-gerar-upsides-v2.js` | rodava `gerarUpsidesV2` com snapshot `v2026.05` mockado contra Forste — listava ativos/paywalls e confirmava 5 upsides ativos | flagou bug do `mu_reduzir_socio_dependencia` disparando 100% (campos fantasma) |
| `test-agregar-potencial.js` | 16 asserções numéricas sobre `agregarPotencial12mV2` — confirma float pleno, caps por categoria, cap ISE, cap absoluto | flagou discrepância R$ 159.464 vs 159.466 (commit `629359b` — Thiago reconheceu erro de manual calc) |
| `test-v06.js` | smoke completo: roda `avaliarV2` contra Forste com snapshot `v2026.06`, dumpa breakdown ISE por pilar e potencial 12m | confirmou ISE 79.6 pós-refactor (`6faabdb`) e flagou P2.margem_estavel zerando |
| `forste-completo.js` | dump amplo dos números Forste pós-validação (valor_venda, ro_anual, multiplo_setor, ise_total, indicadores chave) | usado pra construir tabela de validação no commit `0c67dab` |

## Convenções

- **Nada de fail-silent.** Cada script faz `process.exit(1)` em qualquer asserção falha.
- **Sem hardcode de snapshot.** Os snapshots são construídos em runtime parseando os arquivos SQL — se a migration mudar, os fixtures pegam a mudança automaticamente.
- **Forste é o vendedor de referência.** Todos os fixtures usam o mesmo perfil sintético (servicos_empresas, fat 65k/mês, ISE alto, regime ótimo).

## Limitação conhecida

Os fixtures parseiam migrations SQL diretamente (regex em `$json$...$json$`). Cada
nova migration aplicada (`v2026.0X`) exige atualização manual do parsing nos 5
fixtures. Roadmap futuro: refatorar pra carregar o snapshot ativo do banco em
vez de parsing local — isso elimina a dependência sintática do formato SQL e
mantém os fixtures alinhados ao snapshot real automaticamente.

## Quando atualizar

Atualize o fixture **apenas se:**

- Houver mudança no contrato de saída da skill que afete o que o fixture valida
- Aparecer um novo bug que não tem fixture cobrindo
- Houver mudança de calibração que torne uma asserção desatualizada

Nunca silencie uma asserção pra "passar" — investigar a origem do desvio primeiro.
