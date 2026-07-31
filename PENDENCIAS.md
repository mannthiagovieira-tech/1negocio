# Pendências · Modo Autônomo · 2026-07-30 → 07-31

Rodando slices A/B/C/D em sequência. Bloqueios anotados aqui, prossigo pro próximo.

---

## SLICE A · Parceiros

- **UI admin (card gerenciar parceiros + envio + prompt seleção):** feito apenas backend + página pública `/parceiro.html`. Card interno em `/projetos.html` pra listar `va_parceiros_match`, escolher percentual e enviar convite **NÃO FOI IMPLEMENTADO** (conservador — evita gastar contexto e chance de quebrar UI existente). O que fazer: adicionar card na aba Atendimento (`cardAtParceiros`) que chama RPC `va_parceiros_match(projeto_id)`, mostra lista, botão "enviar convite" chama `va_parceiro_enviar` e copia link `/parceiro/:token`. Estimativa: 100-150 linhas de JS.
- **Custo interno de prospecção de parceiros via Kipflow:** não criei item específico em `va_precos`. Sem UI de busca Kipflow pra parceiro ainda. Fica pendente até definir se é lançamento contábil separado ou item em `va_precos` sem `projeto_id`.

## SLICE B · Landing pública

- **Editor da landing na tela do projeto:** só backend + página `/lp.html`. Não criei UI admin pra criar/aprovar/publicar landing. Precisa card na etapa Teaser ou Atendimento com: derivar do teaser aprovado, editar título/subtítulo/destaques/imagens, marcar `aprovada_admin` e `ativa`, mostrar link `/lp/:slug`.
- **`va_zapi_telefones` referenciada em `va_landing_publica`:** existe (usado em outras funções). Se falhar, `wpp_link` vem `null` — aceito.

## SLICE C · Cockpit

- **Ordenação/filtros** (por urgência/comissão/dia/nome, filtro por proposta em aberto): não adicionei controles UI. Hoje a lista já está ordenada por urgência (do slice UI ondas). Adicionar dropdown de ordenação é curto (30 min).

## SLICE D · Revisão D+60

- **UI da tela de revisão** (5 eixos com evidência e botões manter/ajustar/refazer): apenas backend + cron. Sem tela pra rever/decidir. `va_projeto_revisoes.payload` fica congelado, mas ninguém pode preencher `decisao_*` via UI. Precisa card `cardRevisoes` em algum lugar (Contrato?). **RESOLVIDO em slice UI 2/4.**
- **Aviso "preço acima da faixa"** no eixo preço: incluído no payload (`payload.preco.acima_faixa boolean`) mas UI que consome ainda não existe. **RESOLVIDO em slice UI 2/4.**

## SLICE MODALIDADES · Motor de upsell no relatório cliente

- View `va_upsell_metrica_assessorada` (média alcançados/ciclo dos assessorados, base_projetos) está pronta pra consumo.
- **Bloco NÃO adicionado ao /meu-projeto.html.** Regra: só mostrar se `base_projetos >= 3` (senão número inventado destrói credibilidade). Precisa inserir em `abaInvestimento` ou aba dedicada de Relatório. Estimado 30 linhas JS.
- **Motivo:** escopo grande do slice; motor upsell é factual mas não bloqueia operação, dá pra fazer no próximo turno junto com o Slice 13 do Relatório Congelado (que também está backend-only).

