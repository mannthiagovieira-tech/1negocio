# Maquininha de testes — diagnóstico automatizado

Script Node pra criar negócio teste end-to-end sem precisar cadastrar manualmente em produção.

## Uso

```bash
node scripts/testar-diagnostico.js scripts/perfis-teste/01-padaria-saudavel.json
```

Sem dependências externas (usa `fetch` nativo do Node 18+).

## Fluxo executado

1. **INSERT em `negocios`** — usa role anon (RLS permite)
2. **Carrega `skill-avaliadora-v2.js`** num `vm.Context` com `window` mockado
3. **Roda `AVALIADORA_V2.avaliar(row, 'commit')`** — skill v2 calcula calc_json e persiste em `laudos_v2` (graças ao modo commit)
4. **Dispara 9 fetches paralelos** pra Edge Function `gerar_textos_laudo`
5. **Reporta** UUID + URLs do laudo + query SQL de validação

## Perfis disponíveis

| Arquivo | Cenário | Exercita |
|---------|---------|----------|
| `01-padaria-saudavel.json` | Padaria com antecipação R$ 5k/mês e dívida R$ 200k | S2.2 (antecipação em bloco_1) e S2.4 (endividamento) |
| `02-saas-recorrente.json` | SaaS B2B com 70% recorrência, sem dívidas | Pilar de recorrência |
| `03-negocio-em-risco.json` | Vários campos vazios, passivo trabalhista, impostos atrasados | S2.3 (flags `dre_estimados=true`) |

## Adicionar novo perfil

Copia um existente, ajusta valores, roda. Os JSONs têm 2 raízes:

- **`negocio`** — campos top-level pra `INSERT INTO negocios` (nome, setor, cidade, estado, etc.)
- **`dados_json`** — payload do diagnóstico que vai pra `negocios.dados_json` e é lido pela skill via `dados.dados_json || dados`

Os nomes de campo dentro de `dados_json` são os mesmos que `mapDadosV2` (skill-avaliadora-v2.js linha ~601) lê.

## Cleanup

Negócios criados pela maquininha ficam com `origem='maquininha_teste'`. Pra limpar:

```sql
DELETE FROM laudos_v2 WHERE negocio_id IN (
  SELECT id FROM negocios WHERE origem = 'maquininha_teste'
);
DELETE FROM negocios WHERE origem = 'maquininha_teste';
```

## Visão de longo prazo

Este script será adaptado pra rodar em batch (lendo pasta inteira) e povoar a home com anúncios de propriedade. Hoje é ferramenta de teste, amanhã é seed da home.
