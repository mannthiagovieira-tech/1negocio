# 1Negócio · Espec do Processo Atual de Avaliação

> Documento gerado em 03/05/2026 lendo `main` (commit 05c98c4).
> Foco: skill **v2** (skill-avaliadora-v2.js) — a skill v1 está deprecada.
> Tudo aqui é o que está rodando hoje em produção. Nada inventado.

---

## 0. Mapa do Fluxo (caminho da informação)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                COLETA                                        │
│                                                                              │
│  diagnostico.html  (61 telas, multi-step com chat-style)                    │
│      ├── window.D = {} ........ acumulador in-memory das respostas          │
│      ├── salvarSessao() ....... persiste D em localStorage e em             │
│      │                          tabela diagnostico_sessoes (continuar       │
│      │                          depois)                                     │
│      └── salvarDiagnosticoFinal() (linha 7672)                              │
│              │                                                              │
│              ▼                                                              │
│        salvarNegocioDB() (linha 7689)                                       │
│              │ POST /rest/v1/negocios                                       │
│              │ body: { slug, codigo_diagnostico, nome, setor, categoria,   │
│              │         cidade, estado, faturamento_anual, vendedor_id,     │
│              │         dados_json: D ← TODO o D vai aqui }                 │
│              ▼                                                              │
│        ┌──── tabela negocios (295 colunas, mas core é dados_json jsonb)    │
└────────│────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              PROCESSAMENTO                                   │
│                                                                              │
│  AVALIADORA_V2.avaliar(dadosBrutos, 'commit')                               │
│       skill-avaliadora-v2.js:2892 (avaliarV2)                               │
│       │                                                                      │
│       ├── carregarParametrosV2() ─────► parametros_versoes (ativo=true)     │
│       │                                  hoje: 'v2026.11-pool-9-categorias'│
│       │                                                                      │
│       ├── mapDadosV2(dados) ........... normaliza nomes (linha 618)         │
│       │                                                                      │
│       ├── calcDREv2(D, P) ............. 5 blocos (linha 963)                │
│       │     │   1. Receita líquida (impostos+taxas+comissões+royalty)       │
│       │     │   2. CMV → Lucro Bruto                                        │
│       │     │   3. Despesas op (folha+ocupação+sistemas+mkt) → RO           │
│       │     │   4. IRPJ/CSLL → Lucro Líquido                                │
│       │     │   5. Pró-labore + parcelas + investimentos → potencial caixa  │
│       │     │                                                                │
│       │     ├── calcImpostoSobreFaturamento (linha 263)                     │
│       │     │     Simples I-V (tabelas 2025) | Presumido | Real | MEI       │
│       │     │                                                                │
│       │     ├── calcEncargosCLT (linha 563)                                 │
│       │     │     Simples-anexo IV ou Presumido/Real: 37.5% + RAT           │
│       │     │     Demais Simples: 8% (FGTS only — INSS embutido no DAS)     │
│       │     │     MEI: 8% + INSS 3% (1 empregado)                           │
│       │     │                                                                │
│       │     └── calcImpostosSobreLucro (linha 521)                          │
│       │           IRPJ/CSLL conforme regime (Bloco 4)                       │
│       │                                                                      │
│       ├── calcBalancoV2(D, P) ......... ativos + passivos + PL + NCG        │
│       │                                  (linha 1166)                       │
│       │                                                                      │
│       ├── calcISEv2(D, dre, balanco, P) → 8 pilares (linha 1578)            │
│       │     calcPilar1Financeiro (1307) ─ peso 20%                          │
│       │     calcPilar2Resultado  (1346) ─ peso 15%                          │
│       │     calcPilar3Comercial  (1373) ─ peso 15%                          │
│       │     calcPilar4Gestao     (1415) ─ peso 15%                          │
│       │     calcPilar5SocioDep   (1436) ─ peso 10%                          │
│       │     calcPilar6RiscoLegal (1458) ─ peso 10%                          │
│       │     calcPilar7Balanco    (1505) ─ peso  8%                          │
│       │     calcPilar8Marca      (1539) ─ peso  7%                          │
│       │                                                                      │
│       ├── calcValuationV2 (1666) ........ valor_venda (RO+>0) ou PL (RO<=0) │
│       │     valor_op = ro_anual × (mult_setor + ajuste_forma) × fator_ise   │
│       │     valor_venda = valor_op + patrimonio_liquido                     │
│       │                                                                      │
│       ├── calcAtratividadeV2 (1770) ..... 50%ISE + 25%setor + 25%cresc      │
│       ├── calcAnaliseTributariaV2 (1909)  testa Simples/Presumido/Real     │
│       ├── calcIndicadoresV2 (2087) ...... vs benchmarks setoriais          │
│       ├── calcICDv2 (2261) .............. ICD = índice de confiança dado    │
│       ├── gerarUpsidesV2 (2677) ......... 20 upsides catálogo c/ gates      │
│       ├── agregarPotencial12mV2 (2341) .. soma upsides com 3 caps          │
│       └── montarCalcJsonV2 (2741) ....... shape final do calc_json          │
│                                                                              │
│  salvarCalcJsonV2 (2825):                                                    │
│       1. busca max(versao) atual do negocio                                 │
│       2. PATCH ativo=false em laudos anteriores                             │
│       3. INSERT novo laudo com versao=N+1, ativo=true                       │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            ARMAZENAMENTO                                     │
│  laudos_v2 (id, negocio_id, versao, ativo, calc_json jsonb, criado_em,      │
│             parametros_versao_id)                                            │
│  Sempre 1 laudo ativo=true por negocio_id (lei garantida pela skill).       │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         │  edge function gerar_textos_laudo (paralela, 9 textos):
         │  texto_resumo_executivo_completo, texto_contexto_negocio,
         │  texto_parecer_tecnico, texto_riscos_atencao, texto_diferenciais,
         │  texto_publico_alvo_comprador, descricoes_polidas_upsides,
         │  sugestoes_titulo_anuncio, texto_consideracoes_valor
         │  (cada uma chama Anthropic API e salva em
         │   calc_json.textos_ia.<chave>.conteudo)
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                                EXIBIÇÃO                                      │
│                                                                              │
│  Diagnóstico encerra em /laudo-completo.html?id=<negocio_uuid>              │
│       (laudo gratuito, único laudo entregue ao usuário sem pagamento)        │
│                                                                              │
│  /laudo-pago.html?id=...   ── laudo R$ 99 (mais profundo, paywalls          │
│                                desbloqueados)                                │
│                                                                              │
│  /laudo-admin-v2.html?id=... ── visão admin completa, 15 seções +           │
│                                 JSON bruto                                   │
│                                                                              │
│  /negocio.html?codigo=... ── view pública do anúncio (camada 1 do dossiê)   │
│                                                                              │
│  Todos os laudos LEEM calc_json — NENHUM recalcula.                         │
│  diagnostico.html linha 242: "skill-avaliadora removida — laudo-completo    │
│  SÓ LÊ calc_json, não calcula"                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Diagnóstico — telas, perguntas, validações, persistência

Arquivo: **`diagnostico.html`** (8.115 linhas).
Variável global: **`window.D`** (acumulador dos campos preenchidos).
Função core de navegação: `ir(idTela)` / `irAuto(idTela)`.
Salva sessão a cada turno em `localStorage` (chave `n1_diag_state`) e em `diagnostico_sessoes` (Supabase) via `salvarSessao()` (linha 5719).

### 1.1 Lista completa das 61 telas (id · seção · número · pergunta · tipo)

| ID | Seç | Nº | Pergunta | Tipo |
|---|---|---|---|---|
| `t00` | Acesso | 0 | (capta WhatsApp + nome + OTP via `otp-send`/`otp-verify`) | tel + nome + 6 dígitos |
| `t-cnpj` | Identidade | 1 | "Se tiver o CNPJ na mão, informe aqui" (opcional) | máscara CNPJ |
| `t01` | Início | 1 | "O que te trouxe até aqui?" | escolha-única (curiosidade · vender · sócio · planejamento · sucessão) |
| `t02` | Identidade | 2 | "Como se chama o negócio?" + "Como se referir?" | texto + texto |
| `t03` | Identidade | 3 | "Onde o negócio está localizado?" | dropdown estado/cidade ou texto livre · bairro opcional |
| `t04` | Identidade | 4 | "Qual o setor do negócio?" | escolha-única (12 setores fixos + outro) |
| `t05` | Identidade | 5 | "Como funciona a operação por dentro?" | escolha-única (fabrica · distribui · revende · híbrido) |
| `t04a` | Identidade | 4a | "Como você descreveria seu negócio em poucas palavras?" | texto livre 60 chars |
| `t04b` | Identidade | 4b | "De que forma o negócio gera receita?" | **multi**, gera `D.modelo_atuacao_multi` (8 opções: presta_servico · produz_revende · fabricacao · revenda · distribuicao · vende_governo · saas · assinatura) |
| `ic01` | Pronto | 7 | (interlúdio "DIAGNÓSTICO INICIADO" — boas-vindas) | display only |
| `t07` | Operação | 8 | "O negócio é uma franquia?" | sim/não · se sim: taxa, contrato_anos, restante, royalty %, royalty fixo, fundo mkt %, mkt fixo |
| `t08a` | Operação | 9 | "Onde a operação funciona no dia a dia?" | escolha-única (`local_tipo`: ponto físico · home · digital · galpão) |
| `t08b` | Operação | 9b | "Sobre o espaço físico" — aluguel, IPTU, condo, m² | valores R$ |
| `t09` | Operação | 10 | "Há quanto tempo o negócio está operando?" | número (anos) |
| `t10` | Operação | 11 | "Quem são os donos e como participam?" | escolha-única + multi (papel: sozinho · sócios passivos · sócios ativos) |
| `t11` | Operação | 12 | "Se você tirasse 30 dias de férias amanhã, o que aconteceria?" | escolha-única → mapa pra `gestor_autonomo` / `opera_sem_dono` |
| `t12` | Operação | 13 | "Em qual regime tributário o negócio opera?" | escolha-única (simples · presumido · real · mei) + anexo Simples |
| `t12b` | Operação | 13b | "Aproximadamente, quanto sai de imposto sobre vendas por mês?" | R$ — cria `D.impostos_precalc` (declarado) |
| `t13` | Operação | 14 | "Sobre a marca e a reputação" — `marca_inpi` + `reputacao` | escolha + multi |
| `t14` | Operação | 15 | "O negócio tem presença digital?" | multi (`D.online`: site · ecommerce · instagram · gmaps · marketplace · nenhum) |
| `t15` | Faturamento | 16 | "Quanto o negócio fatura?" | R$ mensal **ou** anual (toggle) → `D.fat_mensal`/`D.fat_anual` |
| `t16` | Faturamento | 17 | "Comparando com o ano passado, o faturamento está..." | slider/selecionar pct → `D.crescimento_pct` |
| `t18` | Faturamento | 19 | "O negócio tem receita recorrente?" | escolha-única (sim%/não) → `D.recorrencia_pct` |
| `t19` | Comercial | 20 | "Por quais canais o negócio vende?" | multi |
| `t19b` | Comercial | 20b | "O negócio paga comissão sobre vendas?" | sim/não + % |
| `t20` | Comercial | 21 | "Investe em mídia paga?" | sim/não + R$/mês |
| `t21` | Comercial | 22 | "Como o dinheiro entra?" | multi (PIX · débito · crédito · boleto · espécie · transf) |
| `t21b` | Comercial | 22b | "Qual a proporção de cada meio?" | grid % |
| `t21c` | Comercial | 22c | "Taxas e prazos de cada meio de recebimento" | grid % + dias |
| `t22` | Comercial | 23 | "Quais as taxas de cartão?" | %s |
| `t23` | Comercial | 24 | "Antecipa recebíveis?" | sim/não + % |
| `t23b` | Comercial | 24b | (sub-bloco da antecipação) | num |
| `t24` | Comercial | 25 | "Quais as taxas dos seus canais de venda?" | multi + % |
| `t26` | Comercial | 27 | "Hoje, quanto o negócio tem a receber?" | R$ + estoque + outros |
| `t27` | Comercial | 28 | "Os 3 maiores clientes representam quanto do faturamento?" | % → `D.concentracao_pct` |
| `t28` | Comercial | 29 | "O negócio tem uma base de clientes organizada?" | escolha + número clientes ativos |
| `t28b` | Comercial | 29b | "O negócio tem estoque parado hoje?" | sim/não · R$ a preço de custo · "não sei" |
| `t29` | Custos | 30 | "O negócio é mais serviço ou mais revenda de produto?" | slider 0-100 → `D.pct_produto` + CMV |
| `t30` | Custos | 31 | "Qual o tamanho da equipe?" | número CLT + número PJ + R$ folha |
| `t30b` | Custos | 31b | "Quais os outros custos fixos mensais?" | R$ sistemas + R$ outros + R$ marketing |
| `t30c` | Custos | 31c | "Deve alguma coisa a fornecedores hoje?" | sim/não + R$ a vencer + R$ atrasadas |
| `t31` | Custos | 32 | "Como os sócios são remunerados hoje?" | escolha-única (`remuneracao_socios`: fixo · sobra · não) → derivado para `dre_separacao_pf_pj` |
| `t32` | Gestão | 32 | "Os processos do dia a dia estão documentados?" | escolha (sim · parcial · não) |
| `t33` | Gestão | 33 | "Tem alguém na equipe que tocaria o negócio sem você?" | escolha → `gestor_autonomo` (mapeia 2 campos: `tem_gestor` + `opera_sem_dono`) |
| `t34` | Gestão | 34 | "O negócio usa algum sistema de gestão?" | multi + texto sistemas + R$ custo_sistemas + escolha contabilidade_formal |
| `t35` | Gestão | 35 | "Como você enxerga o faturamento dos próximos 12 meses?" | multi → `D.crescimento_proj_pct` |
| `t36` | Gestão | 36 | "Sem contratar nem investir, quanto o faturamento ainda poderia crescer?" | escolha + multi |
| `t37` | Balanço | 37 | "Qual o saldo em caixa da empresa hoje?" | R$ caixa + multi (onde aplicado) + R$ contas a receber |
| `t38` | Balanço | 38 | "Quais os ativos do negócio?" | R$ equipamentos + R$ imóvel + R$ outros |
| `t39a` | Balanço | 39 | "Quanto deve a fornecedores hoje?" | R$ a vencer + R$ atrasadas |
| `t39b` | Balanço | 39b | "Tem financiamentos, empréstimos ou parcelamentos ativos?" | multi tipos + R$ saldo + R$ parcela mensal |
| `t39c` | Balanço | 39c | "Qual o prazo médio que seus fornecedores dão?" | número dias (PMP) + dias PMR |
| `t-revisao-passivos` | Balanço | 39d | (revisão dos passivos antes de seguir) | confirmação |
| `t40` | Risco | 40 | "O negócio está envolvido em algum processo judicial?" | sim/não + multi tipo (trabalhista · fiscal · civil · outro) + R$ passivo + R$ ativo (autor) + escolha `passivo_trabalhista` + escolha `impostos_dia` (em dia · parcelamento · atrasado) |
| `t41` | Perspectiva | 41 | "O que você planeja para os próximos 12 meses?" | multi + textarea |
| `t42` | Perspectiva | 42 | "Na sua cabeça, quanto vale esse negócio?" | R$ → `D.expectativa_valor_dono` |
| `t43` | Perspectiva | 43 | "Tem algo que a gente não perguntou e deveria saber?" | multi + textarea |
| `t43b` | Confirmação | 43b | (gate visual antes da revisão) | display |
| `t44` | Revisão | 44 | "Geramos um texto baseado nas suas respostas. Revise e ajuste" | textarea — `D.descricao_final` (descrição final do negócio) |
| `t-fim` | Concluído | 47 | "Seu laudo está pronto" + código + botão "VER MEU LAUDO" | display, redireciona pra `/laudo-completo.html?id=<uuid>` |
| `t-ro-negativo` | Resultado | 48 | (tela de fallback se RO calculado for negativo — não impede laudo) | display |

### 1.2 Persistência

```js
// diagnostico.html:7700
const negocio = {
  slug: codigo_diagnostico,        // 1N-XXXXX
  codigo_diagnostico,
  nome: D.nome_negocio,
  setor: D.setor || 'Outros',
  categoria: D.categoria || D.setor,
  cidade, estado, bairro,
  descricao: D.descricao_final,
  faturamento_anual: D.fat_mensal * 12,
  tipo_negocio: D.tipo_negocio,
  status: 'em_avaliacao',
  plano: 'gratuito',
  vendedor_id: D.google_user_id || null,  // se logado
  dados_json: D                            // ← TUDO o D vai aqui (jsonb)
};
// POST /rest/v1/negocios
```

**A tabela `negocios` tem 295 colunas**, mas o pipeline da skill v2 lê tudo do **`dados_json`** (jsonb). As outras 294 colunas são metadados de status, métricas, snapshots, vendedor, etc.

Imediatamente após o INSERT na `negocios`, o diagnóstico chama (linha 7879):
```js
const calcJsonV2 = await AVALIADORA_V2.avaliar(dadosParaAvaliar, 'commit');
```
Isso roda a skill v2 e grava em `laudos_v2` (versionado, sempre 1 ativo por negocio).

---

## 2. mapDadosV2 — normalização dos inputs

Arquivo: `skill-avaliadora-v2.js:618`

A função recebe o objeto do banco (`negocios.dados_json`) e produz `D` — um objeto plano com nomes canônicos. Tudo que a skill consome depois lê de `D`.

Campos críticos derivados (com tag de origem `informado` vs `fallback_zero`):

| Campo D | Origem (dados_json) | Default |
|---|---|---|
| `fat_mensal` | `fat_mensal` ou `faturamento_anual/12` | 0 |
| `fat_anual` | `fat_anual` ou `fat_mensal × 12` | 0 |
| `crescimento_pct` | `crescimento_pct` (slider t16) | 0 (com flag `crescimento_respondido`) |
| `crescimento_proj_pct` | `crescimento_proj_pct` (t35) | 0 |
| `regime` | normaliza p/ `simples`/`presumido`/`real`/`mei` | `simples` |
| `setor_code` | `mapSetor(setor_raw)` — 12 códigos canônicos | `servicos_locais` |
| `anexo` | declarado pelo diag, ou `inferirAnexoSimples(setor_code)` | III |
| `modelo_atuacao_multi` | array (t04b) | `[]` |
| `modelo_code` | `mapModelo(multi)` — primeiro de [`saas`, `assinatura`, `vende_governo`, `distribuicao`, `presta_servico`, `fabricacao`, `produz_revende`, `revenda`] | `presta_servico` |
| `pct_produto` | t29 slider | 0 |
| `cmv_mensal` | `cmv_valor` ou `fat_mensal × cmv_pct/100` | 0 |
| `taxas_recebimento` | hierarquia `custo_taxas_recebimento` → `custo_cartoes` → `custo_recebimento` → derivado de `_total - antecipacao - comissoes` | 0 |
| `comissoes` | `custo_comissoes` | 0 |
| `franquia` | string `'sim'`/`'nao'` | `'nao'` |
| `royalty_pct`, `royalty_fixo`, `mkt_franquia_pct`, `mkt_franquia_fixo` | só aplicam se `franquia === 'sim'` | 0 |
| `clt_folha`, `clt_qtd`, `pj_custo`, `pj_qtd` | t30 | 0 |
| `aluguel` | t08b — origem pode ser `informado_zero` se `local_tipo ∈ {home, digital}` | 0 |
| `custo_utilities`, `custo_terceiros`, `custo_sistemas`, `custo_outros`, `mkt_valor` | vários campos t30b | 0 |
| `prolabore`, `parcelas` (mensais), `antecipacao_caixa`, `investimentos` (mensais) | bloco "abaixo do RO" | 0 |
| **Balanço — ativos** | `caixa`, `contas_receber`, `estoque`, `equipamentos`, `imovel`, `ativo_franquia` (recalculado se vazio mas tem taxa+contrato), `outros_ativos` | 0 |
| **Balanço — passivos** | `fornec_a_vencer`, `fornec_atrasadas`, `impostos_atrasados`, `folha_pagar`, `saldo_devedor`, `outros_passivos` | 0 |
| `pmr`, `pmp` | dias | 0 |
| **Qualitativo (ISE)** | `processos`, `gestor_autonomo` (vira `tem_gestor` E `opera_sem_dono`), `equipe_permanece`, `dre_separacao_pf_pj` (derivado de `remuneracao_socios`), `contabilidade` (derivado de `contabilidade_formal`), `marca_inpi`, `reputacao`, `online` (multi), `juridico_tipo`, `passivo_juridico`, `ativo_juridico`, `passivo_trabalhista`, `impostos_dia` | string defaults |
| `recorrencia_pct` | trata `'sim'`→100 / `'nao'`→0 / número | 0 |
| `concentracao_pct` | `concentracao_pct` ou `maior_cliente_pct` | 0 |
| `clientes`, `ticket` | `cli_1m`/`clientes_ativos` e `ticket_medio` | 0 |
| `parceiro_origem_id`, `parceiro_destino_id`, `tese_id` | hooks rede | null |

### 2.1 Setores reconhecidos (12 códigos canônicos)

`mapSetor()` em `skill-avaliadora-v2.js:121` mapeia variações para:

```
saude · varejo · educacao · bem_estar · industria · logistica
construcao · hospedagem · alimentacao · beleza_estetica
servicos_locais · servicos_empresas
```

### 2.2 Modelos de atuação (8 códigos)

`mapModelo()` em `skill-avaliadora-v2.js:153`. Multi-select reduzido pela ordem de prioridade:

```js
const ordem = ['saas','assinatura','vende_governo','distribuicao',
               'presta_servico','fabricacao','produz_revende','revenda'];
```

Ou seja: se a pessoa marca `['revenda','saas']`, o `modelo_code` (principal) vira `saas` (mais raro = mais importante). Mas o `modelo_atuacao_multi` array completo é preservado e usado em `calcAjusteFormaMultiSelect`.

---

## 3. Cálculo da DRE — `calcDREv2`

Arquivo: `skill-avaliadora-v2.js:963`. Estrutura em **5 blocos**.

### Bloco 1 — Receita líquida

```
fat_mensal = D.fat_mensal
calcReal = calcImpostoSobreFaturamento(fat_anual, regime, anexo, P, ctx)
impostos_mensal = calcReal.decomposicao.fat_total_anual / 12
                  (só PIS/COFINS/ISS/ICMS — IRPJ/CSLL não entra aqui)
royalty_pct_aplicado     = is_franquia ? fat_mensal × D.royalty_pct/100 : 0
mkt_franquia_pct_aplicado = is_franquia ? fat_mensal × D.mkt_franquia_pct/100 : 0
total_deducoes = impostos_mensal + taxas_recebimento + comissoes
               + royalty_pct_aplicado + mkt_franquia_pct_aplicado
               + antecipacao_caixa
rec_liquida = fat_mensal − total_deducoes
```

### Bloco 2 — CMV → Lucro Bruto

```
cmv = D.cmv_mensal
lucro_bruto = rec_liquida − cmv
margem_bruta_pct = lucro_bruto / fat_mensal × 100
```

### Bloco 3 — Despesas Operacionais → RO

```
enc = calcEncargosCLT(clt_folha, regime, anexo, setor_code, P)
folha_total = clt_folha + enc.encargos + pj_custo
            + (is_franquia ? royalty_fixo : 0)
            + (is_franquia ? mkt_franquia_fixo : 0)
ocupacao_total = aluguel + custo_utilities + custo_terceiros
operacional_outros_total = custo_sistemas + custo_outros + mkt_valor

ro_mensal = lucro_bruto − folha_total − ocupacao_total − operacional_outros_total
ro_anual  = ro_mensal × 12
margem_operacional_pct = ro_mensal / fat_mensal × 100
```

### Bloco 4 — Resultado financeiro + impostos sobre lucro

```
resultado_financeiro = { despesas: 0, receitas: 0, saldo: 0 }   // hoje sempre zero
impostos_sobre_lucro = calcImpostosSobreLucro(D, ro_mensal)
lucro_liquido_mensal = ro_mensal − resultado_financeiro.saldo
                                 − impostos_sobre_lucro.total
```

### Bloco 5 — Desembolsos do sócio

```
potencial_caixa_mensal = lucro_liquido_mensal − prolabore − parcelas − investimentos
```

> ⚠️ Pró-labore, parcelas de empréstimo e investimentos **NÃO entram no RO**.
> Eles são desembolsos do dono, ficam abaixo do lucro líquido. Isso é decisão consciente da Decisão #14 (DRE oficial vs. declarado).

### 3.1 Tabelas Simples Nacional (em uso — `skill-avaliadora-v2.js:308-348`)

Anexo I (Comércio):
| RBT12 ≤ | Alíq | Deduzir |
|---|---|---|
| 180k | 4,00% | 0 |
| 360k | 7,30% | 5.940 |
| 720k | 9,50% | 13.860 |
| 1,8M | 10,70% | 22.500 |
| 3,6M | 14,30% | 87.300 |
| 4,8M | 19,00% | 378.000 |

Anexo II (Indústria) · III (Serviços com Fator R) · IV (Serviços específicos) · V (Serviços sem Fator R) — todos com a mesma estrutura, valores diferentes (referência: linhas 308-348 de `skill-avaliadora-v2.js`).

Fórmula efetiva: `aliq_efetiva = ((RBT12 × aliq_nominal) − parcela_dedutivel) / RBT12`.

**Fator R**: linhas 351-368.
- Calculado sempre se `folha_anual_total > 0`.
- Aplicado **apenas para setores `[servicos_empresas, educacao, saude, servicos_locais]` ou `forma_principal === 'saas'`** (linha 361).
- Se `fator_r < 0.28` → forçar Anexo V (mais caro).
- Se `fator_r ≥ 0.28` → permitir Anexo III.

Decomposição (linhas 380-510): a alíquota efetiva é decomposta em PIS/COFINS/ISS/ICMS/IRPJ/CSLL conforme a regra de cada anexo. **Bloco 1 da DRE só pega `fat_total_anual` (PIS+COFINS+ISS+ICMS)** — IRPJ+CSLL fica para o Bloco 4 evitar duplo-count.

### 3.2 Lucro Presumido (linhas 233-243 + 410-460 da skill)

`determinarPresuncoesPresumido(setor_code, forma_principal)`:
- **`servicos_locais` ou forma `saas`/`assinatura`** → `irpj=8%, csll=12%` (presunções "comércio")
- **Demais serviços (`servicos_empresas`, `educacao`, `saude`, etc)** → `irpj=32%, csll=32%`
- **Comércio** (`varejo`, `alimentacao`, etc) → `irpj=8%, csll=12%`

Alíquotas finais (Bloco 1 da DRE, sobre fat):
- PIS 0,65% + COFINS 3% + ISS/ICMS conforme setor (5% ISS ou 18% ICMS) — `determinarRegimeMunicipalEstadual` (linha 204).

IRPJ/CSLL ficam no Bloco 4 (`calcImpostosSobreLucro`):
- `irpj_anual = fat_anual × presuncao_irpj × 15%` + adicional 10% sobre (`base − 240k/ano`).
- `csll_anual = fat_anual × presuncao_csll × 9%`.

### 3.3 Lucro Real (linhas 463-505 da skill)

- PIS 1,65% + COFINS 7,6% (não-cumulativo) + ISS/ICMS.
- IRPJ 15% sobre RO + adicional 10% sobre (RO_anual − 240k).
- CSLL 9% sobre RO.

### 3.4 MEI (linhas 268-303)

- `fat_anual > 81k` → retorna `viabilidade='inviavel'` com razão `fat_acima_limite_mei`.
- Caso contrário: `fixoMensal = (anexo I/II ? 75,90 : 80,90)`.

### 3.5 Encargos CLT — `calcEncargosCLT` (linha 563)

```
fgts = 8%
inss_patronal = 20%
terceiros = 5,8% (INCRA, SESI/SESC, SEBRAE, salário-educação)
rat_pct = P.rat_por_setor[setor_code]    // ver tabela em §6
```

Aplicação por regime:
- **MEI**: `pct_total = 8% (FGTS) + 3% INSS` → 11%
- **Simples não-IV**: `pct_total = 8% (FGTS only)` — INSS+terceiros+RAT incluídos no DAS
- **Simples-IV** OU **Presumido** OU **Real**: `pct_total = 37,5% + RAT_setor`
  - Detalhamento: 8% FGTS + 20% INSS + 5,8% terceiros + 3,7% outros + RAT (1-3% por setor)

### 3.6 Provisão CLT no Balanço (Decisão #20 — linha 1180)

```
provisao_clt = clt_folha × 0.13 × 6 × fator_encargo
fator_encargo = calcFatorEncargoProvisao(regime, anexo, setor_code, P)   // §3.5
```

Significado: aprovisiona **6 meses** de obrigações trabalhistas (13º, férias, FGTS, multa rescisória) com encargos. Vai pro passivo do balanço.

---

## 4. Balanço — `calcBalancoV2` (linha 1166)

```
ATIVOS = caixa + contas_receber + estoque + equipamentos + imovel
       + ativo_franquia + outros_ativos
imobilizado_total = equipamentos + imovel + ativo_franquia

PROVISÃO_CLT = clt_folha × 0.13 × 6 × fator_encargo

PASSIVOS = fornec_a_vencer + fornec_atrasadas + impostos_atrasados
         + saldo_devedor + provisao_clt + outros_passivos

PATRIMÔNIO_LÍQUIDO = total_ativos − total_passivos      # PODE SER NEGATIVO
NCG = contas_receber + estoque − fornec_a_vencer − fornec_atrasadas
ciclo_dias = pmr − pmp                                  # pode ser negativo
```

---

## 5. ISE (Score de Saúde) — 8 pilares

Arquivo: `skill-avaliadora-v2.js:1578` (calcISEv2 agrega).

### 5.1 Pesos dos pilares (do snapshot ativo `parametros_versoes.snapshot.pesos_ise`)

| ID | Pilar | Peso | Função na skill |
|---|---|---|---|
| `p1_financeiro` | Financeiro | **20%** | linha 1307 |
| `p2_resultado` | Resultado | 15% | linha 1346 |
| `p3_comercial` | Comercial | 15% | linha 1373 |
| `p4_gestao` | Gestão | 15% | linha 1415 |
| `p5_socio_dependencia` | Sócio / Dependência | 10% | linha 1436 |
| `p6_risco_legal` | Risco Legal | 10% | linha 1458 |
| `p7_balanco` | Balanço | 8% | linha 1505 |
| `p8_marca` | Marca / Reputação | 7% | linha 1539 |

Soma: **100%**. Total ISE = 0-100.

### 5.2 Sub-métricas e seus pesos (`pesos_sub_metricas_ise` — todos somam 1.0)

| Pilar | Sub-métricas (cada uma com peso indicado) |
|---|---|
| **P1 Financeiro** (4) | `margem_op_pct` (0,25) · `dre_separacao` (0,25) · `fluxo_caixa_positivo` (0,25) · `contabilidade_formal` (0,25) |
| **P2 Resultado** (2) | `ebitda_real` (0,5) · `rentabilidade_imobilizado` (0,5) |
| **P3 Comercial** (4) | `num_clientes` (0,25) · `recorrencia_pct` (0,25) · `concentracao_pct` (0,25) · `base_clientes_documentada` (0,25) |
| **P4 Gestão** (3) | `processos_documentados` (0,333) · `tem_gestor` (0,333) · `sistemas_implantados` (0,333) |
| **P5 Sócio-dep** (3) | `opera_sem_dono` (0,333) · `equipe_permanece` (0,333) · `prolabore_documentado` (0,333) |
| **P6 Risco Legal** (4) | `passivos_juridicos` (0,25) · `sem_acao_judicial` (0,25) · `impostos_atrasados_volume` (0,25) · `sem_impostos_atrasados` (0,25) |
| **P7 Balanço** (3) | `patrimonio_positivo` (0,333) · `liquidez` (0,333) · `ncg_saudavel` (0,333) |
| **P8 Marca** (3) | `marca_inpi` (0,333) · `reputacao` (0,333) · `presenca_digital` (0,333) |

### 5.3 Como cada pilar é calculado (resumo das regras, paths exatos)

**P1 Financeiro** (`calcPilar1Financeiro` — linha 1307):
- `margem_op_pct`: vs `benchmarks_dre[setor].margem_op` (com `getBenchmarkAjustado` aplicando `modificadores_forma_atuacao_dre`); score = `min(10, valor/benchmark × 10)` capped.
- `dre_separacao`: `dre_separacao_pf_pj === 'sim'` (de `remuneracao_socios === 'fixo'`) → 10, senão 0.
- `fluxo_caixa_positivo`: `dre.potencial_caixa_mensal > 0` → 10 (e valor exibido em R$); senão 0.
- `contabilidade_formal`: `D.contabilidade === 'sim'` → 10, `'interno'` → 5, else 0.

**P2 Resultado** (`calcPilar2Resultado` — linha 1346):
- `ebitda_real`: `dre.ro_anual > 0` → 10; senão 0. (Valor anual exibido.)
- `rentabilidade_imobilizado`: `dre.ro_anual / balanco.ativos.imobilizado_total × 100` vs **`P.selic_anual` (= 14% atualmente)**. Score = `min(10, rentabilidade / selic × 10)`.

**P3 Comercial** (`calcPilar3Comercial` — linha 1373):
- `num_clientes`: faixas (0/<10/<50/<200/<500/<1000/+1000) → 0/2/4/6/8/9/10.
- `recorrencia_pct`: vs `benchmarks_indicadores[setor].recorrencia_tipica`; score = `valor/benchmark × 10` capped a 10.
- `concentracao_pct`: vs `benchmarks_indicadores[setor].concentracao_max`; quanto **maior** que o benchmark, **pior**. score = `max(0, 10 − ((valor − bench) / bench × 10))`.
- `base_clientes_documentada`: `D.base_clientes === 'sim'` → 10.

**P4 Gestão** (`calcPilar4Gestao` — linha 1415):
- `processos_documentados`: `'sim'`→10 · `'parcial'`→6 · `'nao'`→0.
- `tem_gestor`: `'sim'`→10 · `'parcial'`→6 · `'nao'`→0 (vem de `gestor_autonomo`).
- `sistemas_implantados`: score por `D.custo_sistemas` (>0 → 7, capa em 10).

**P5 Sócio/dep** (`calcPilar5SocioDependencia` — linha 1436):
- `opera_sem_dono`: `'sim'`→10 · `'parcial'`→5 · `'nao'`→0.
- `equipe_permanece`: `'sim'`→10 · `'parcial'`→5 · `'nao'`/'nao_sei'→0.
- `prolabore_documentado`: pró-labore > 0 → 8 (proxy de formalização); 0 → 0.

**P6 Risco Legal** (`calcPilar6RiscoLegal` — linha 1458):
- `passivos_juridicos`: combina 3 inputs do t40:
  - `tem_processo` (`processos_juridicos === 'sim'`)
  - `tem_trabalhista` (`passivo_trabalhista === 'sim'`)
  - `passivo_juridico` em R$
  - score = 10 se sem processos & sem passivo, 7 se 1 indicador, 4 se 2, 0 se 3.
- `sem_acao_judicial`: `processos_juridicos === 'nao'` → 10, 'sim' → 0.
- `impostos_atrasados_volume`: `D.impostos_atrasados / fat_anual` — score 10 se 0, decrescente até 0 se >12% do fat.
- `sem_impostos_atrasados`: `impostos_dia === 'sim'` → 10, `'parcelamento'` → 5, `'atrasado'` → 0.

**P7 Balanço** (`calcPilar7Balanco` — linha 1505):
- `patrimonio_positivo`: `PL > 0` → 10, valor exibido.
- `liquidez`: `total_ativos / total_passivos`. Score: ≥2,0→10, ≥1,5→8, ≥1,0→5, <1→0.
- `ncg_saudavel`: `NCG / fat_mensal` (em meses). Score: ≤1→10, ≤2→7, ≤3→5, >4→0.

**P8 Marca** (`calcPilar8Marca` — linha 1539):
- `marca_inpi`: `'registrada'`/`'sim'` → 10, `'em_andamento'` → 5, `'sem_registro'`/`'nao'` → 0.
- `reputacao`: `'excelente'` → 10, `'boa'` → 7, `'neutra'` → 4, `'problemas'` → 0.
- `presenca_digital`: contagem de canais ativos em `D.online`. score = `min(10, qtd × 2.5)` (4+ canais → 10).

### 5.4 Agregação ISE (linha 1578)

```js
contribuicao_no_total = (score_0_10 × peso_pct) / 10
ise_total = round( sum(contribuicoes) )    // 0-100
```

Classe e fator (de `parametros_versoes.snapshot.fator_ise`):

| ISE | Classe | Fator (multiplica o múltiplo) |
|---|---|---|
| 85-100 | Estruturado | 1,30 |
| 70-84 | Consolidado | 1,15 |
| 50-69 | Operacional | 1,00 |
| 35-49 | Dependente | 0,85 |
| 0-34 | Embrionário | 0,70 |

---

## 6. Tabelas em uso (snapshot ativo `v2026.11-pool-9-categorias`)

Lidas do `parametros_versoes.snapshot` (active=true).

### 6.1 Múltiplos por setor — `multiplos_setor`

```
educacao       2,18
saude          2,12
servicos_empresas 2,06
bem_estar      1,87
beleza_estetica 1,76
industria      1,72
hospedagem     1,69
logistica      1,67
alimentacao    1,58
servicos_locais 1,58
varejo         1,52
construcao     1,46
```

### 6.2 Ajuste por forma de atuação — `ajuste_forma_atuacao`

```
saas            +0,82
assinatura      +0,46
vende_governo   +0,28
distribuicao    +0,12
presta_servico  +0,06
produz_revende  −0,08
fabricacao      −0,18
revenda         −0,32
```

Aplicação (`calcAjusteFormaMultiSelect` — linha 1629): se múltiplas formas, **a maior vence (principal)** e cada outra contribui com `0,30 × (extra − principal)` (sempre ≤ 0). Resultado: principal cheio + atenuações pelas outras.

### 6.3 Modificadores DRE por forma — `modificadores_forma_atuacao_dre`

Ajusta os **benchmarks** de DRE conforme a forma (lido por `getBenchmarkAjustado` linha 1257):

| Forma | cmv | folha | aluguel | mkt | margem_op | outros_cf |
|---|---|---|---|---|---|---|
| saas | -8 | +5 | -4 | +3 | +8 | 0 |
| assinatura | -3 | +1 | -1 | +2 | +4 | 0 |
| presta_servico | -3 | +5 | -1 | 0 | +3 | 0 |
| vende_governo | +2 | +2 | -1 | -2 | -3 | 0 |
| produz_revende | +3 | -3 | +2 | 0 | -2 | 0 |
| distribuicao | +5 | -3 | -2 | -1 | -2 | 0 |
| fabricacao | +5 | -3 | +2 | -1 | -3 | 0 |
| revenda | +8 | -8 | -1 | +1 | -3 | 0 |

### 6.4 Benchmarks DRE por setor — `benchmarks_dre` (em % do fat)

| Setor | cmv | folha | aluguel | mkt | margem_op | outros_cf | deducoes |
|---|---|---|---|---|---|---|---|
| saude | 12 | 32 | 8 | 3 | 25 | 8 | 12 |
| varejo | 48 | 14 | 5 | 3 | 10 | 6 | 22 |
| educacao | 5 | 38 | 8 | 4 | 28 | 8 | 12 |
| bem_estar | 5 | 30 | 12 | 4 | 22 | 8 | 13 |
| industria | 45 | 18 | 5 | 2 | 12 | 8 | 18 |
| logistica | 22 | 32 | 5 | 2 | 12 | 10 | 14 |
| construcao | 38 | 22 | 4 | 2 | 10 | 8 | 14 |
| hospedagem | 18 | 25 | 12 | 4 | 18 | 10 | 14 |
| alimentacao | 32 | 22 | 9 | 3 | 15 | 8 | 14 |
| beleza_estetica | 10 | 30 | 10 | 3 | 22 | 8 | 13 |
| servicos_locais | 12 | 28 | 8 | 2 | 18 | 8 | 12 |
| servicos_empresas | 5 | 35 | 5 | 3 | 30 | 8 | 12 |

`fator_max_sobre_benchmark = 1,3` — limite usado em P1 e nos gates de upsides.

### 6.5 Benchmarks indicadores — `benchmarks_indicadores`

| Setor | pmr (dias) | pmp (dias) | margem_bruta (%) | concentracao_max (%) | recorrencia_tipica (%) |
|---|---|---|---|---|---|
| saude | 25 | 30 | 60 | 12 | 50 |
| varejo | 25 | 40 | 38 | 5 | 5 |
| educacao | 10 | 30 | 70 | 6 | 90 |
| bem_estar | 0 | 30 | 75 | 2 | 95 |
| industria | 40 | 35 | 32 | 25 | 30 |
| logistica | 30 | 30 | 28 | 20 | 50 |
| construcao | 55 | 40 | 22 | 35 | 0 |
| hospedagem | 0 | 30 | 55 | 8 | 0 |
| alimentacao | 0 | 25 | 58 | 8 | 5 |
| beleza_estetica | 0 | 30 | 60 | 8 | 40 |
| servicos_locais | 12 | 30 | 55 | 12 | 30 |
| servicos_empresas | 28 | 30 | 65 | 18 | 60 |

### 6.6 RAT por setor — `rat_por_setor` (% sobre folha CLT)

```
construcao      3,0 (mais alto — risco maior)
industria        2,0
logistica        2,0
alimentacao      2,0
bem_estar        1,5
beleza_estetica  1,5
hospedagem       1,5
saude            1,0
varejo           1,0
educacao         1,0
servicos_locais  1,0
servicos_empresas 1,0
```

### 6.7 Atratividade — `pesos_atratividade` + `score_setor_atratividade` + `faixas_*`

Pesos: `ise=0,5 · setor=0,25 · crescimento=0,25`.

Score por setor (1-10):
```
servicos_empresas 9 · saude 8 · educacao 8 · bem_estar 7 · beleza 7
varejo 6 · alimentacao 6 · hospedagem 6 · logistica 6 · industria 5
servicos_locais 5 · construcao 4
```

Faixas crescimento → score:
| % | label | score |
|---|---|---|
| ≥30 | Crescimento forte | 10 |
| 20-29,9 | Crescimento sólido | 9 |
| 10-19,9 | Crescimento moderado | 7 |
| 5-9,9 | Crescimento leve | 5 |
| -5 a 4,9 | Estável | 4 |
| -15 a -5,1 | Em queda | 2 |
| ≤-15,1 | Queda forte | 0 |

Faixas atratividade total → label:
| Score | Label |
|---|---|
| 90-100 | Alta |
| 75-89 | Atrativa |
| 60-74 | Padrão |
| 45-59 | Limitada |
| 0-44 | Baixa |

### 6.8 Outras constantes

```
selic_anual = 14            (% — usado em P2.rentabilidade_imobilizado)
fator_max_sobre_benchmark = 1,3  (limite "X é alto")
cap_absoluto = 0,8          (cap dos upsides agregados — §8.4)
tributario_dominante_threshold = 0,4
```

---

## 7. Valuation — `calcValuationV2` (linha 1666)

### 7.1 RO > 0 (caminho padrão)

```
multiplo_setor.valor   = P.multiplos_setor[setor]                              (§6.1)
ajuste_forma.total     = calcAjusteFormaMultiSelect(formas, P.ajuste_forma_atuacao)  (§6.2)
multiplo_base          = multiplo_setor.valor + ajuste_forma.total
fator_ise.valor        = P.fator_ise[classe].fator                             (§5.4)
fator_final            = multiplo_base × fator_ise.valor

valor_operacao = ro_anual × fator_final
valor_venda    = valor_operacao + patrimonio_liquido     # PL pode ser negativo
```

**Alertas automáticos**:
- `valor_venda < 0` → alerta `valor_negativo` (dívidas excedem operação).
- `valor_venda < valor_operacao × 0,30` & `PL < 0` → alerta `divida_engole_valor`.

### 7.2 RO ≤ 0 (Decisão #19 — linha 1694)

```
valor_operacao = 0
valor_venda    = patrimonio_liquido         (avalia só pelo balanço)
ro_negativo    = true
cta_especialista = { ativo: true, label: 'Agendar conversa com especialista', url: ... }
```

---

## 8. Atratividade · Análise Tributária · Indicadores · ICD · Upsides

### 8.1 Atratividade — `calcAtratividadeV2` (linha 1770)

```
componente_ise        = ise.ise_total / 10                          (peso 50%)
componente_setor      = P.score_setor_atratividade[setor_code]      (peso 25%)
componente_cresc      = score_da_faixa(crescimento_pct)             (peso 25%)
contribuicoes         = score × peso_pct / 10
total                 = round(sum(contribuicoes))    # 0-100
classe                = label_de_faixa(total)        (Alta / Atrativa / Padrão / Limitada / Baixa)
```

> Se `crescimento_pct` não foi respondido (flag `crescimento_respondido = false`), usa `crescimento_proj_pct` com penalidade `−2` (otimismo do vendedor).

### 8.2 Análise Tributária — `calcAnaliseTributariaV2` (linha 1909)

Testa os 3 regimes (Simples/Presumido/Real) e o atual; para cada um:
- Calcula imposto total anual (`calcImpostoCompleto` linha 1884).
- Calcula elegibilidade (Simples só se `fat_anual ≤ 4,8M`; Real é sempre elegível; etc).
- Compara com regime atual → mostra ganho potencial (em R$/ano).
- Marca `gera_upside_obrigatorio = true` se houver regime alternativo com economia significativa OU impostos atrasados → ativa o upside `tr_otimizar_tributario`.

### 8.3 Indicadores vs Benchmark — `calcIndicadoresV2` (linha 2087)

Lista de indicadores no laudo (cada um com `valor`, `benchmark` ajustado, `status` ✓/!/✗):
- `margem_bruta`, `margem_operacional_pct`
- `cmv_pct`, `folha_pct`, `aluguel_pct`, `mkt_pct`, `outros_cf_pct`
- `deducoes_pct`
- `recorrencia_pct`, `concentracao_pct`
- `pmr_dias`, `pmp_dias`, `ciclo_dias`
- `liquidez_geral`, `ncg_meses`
- `ticket_medio`, `ro_por_funcionario`, `ro_por_cliente`

Função `calcStatusIndicador(valor, benchmark, sentido)` (linha 2064): retorna `'verde'`/`'amarelo'`/`'vermelho'` conforme proximidade do benchmark.

### 8.4 Upsides — `gerarUpsidesV2` (linha 2677) + `agregarPotencial12mV2` (linha 2341)

**Catálogo de 20 upsides** (do snapshot `upsides_catalogo`). Cada um tem:
- `id`, `label`, `descricao`, `categoria` (`tributario`/`ro`/`passivo`/`multiplo`/`qualitativo`/`paywall`)
- `gate.expressao` (string JS avaliada com `lerCaminho` — linha 2315)
- `formula_calculo.tipo` (`ro_via_margem`/`ro_direto`/`passivo_direto`/`passivo_estimado`/`tributario_calculado`/`multiplo_aumento`/`qualitativo_sem_calculo`/`paywall_display`)
- `parametros` específicos da fórmula

Categorias e exemplos do que ativa:
| Categoria | Upside | Quando ativa | Como calcula |
|---|---|---|---|
| **tributario** | `tr_otimizar_tributario` | `analise_tributaria.gera_upside_obrigatorio === true` | economia tributária real anual + redução passivo |
| **ro** | `ro_otimizar_custos` | `margem_op` < (benchmark − 10pp) | recupera 50% do gap |
| **ro** | `ro_renegociar_custos_fixos` | aluguel ou outros_cf > benchmark × 1,3 | 15% economia em outros_cf+sistemas |
| **ro** | `ro_otimizar_precificacao` | margem_bruta < bench − 8 & recorrência < 50% | +3% sobre fat_anual |
| **ro** | `ro_reduzir_custo_folha` | folha_pct > bench × 1,3 | 40% do gap |
| **ro** | `ro_recuperar_inativos` | recorrência ≥ 30% & clientes ≥ 100 | +5% sobre fat_anual |
| **passivo** | `pa_regularizar_fornecedores` | fornec_atrasados > fat_mensal | reduz exato esse passivo |
| **passivo** | `pa_resolver_passivos_trabalhistas` | `passivo_trabalhista === 'sim'` | proxy: 3 meses de folha |
| **multiplo** | `mu_aumentar_recorrencia` | recorrência < bench × 0,5 | +1× no múltiplo |
| **multiplo** | `mu_diversificar_clientes` | concentração > bench_max | +0,5× no múltiplo |
| **multiplo** | `mu_reduzir_socio_dependencia` | tem_gestor ≠ sim & opera_sem_dono ≠ sim | +0,7× no múltiplo |
| **qualitativo** | `rec_formalizar_contabilidade` etc | gates simples | sem cálculo monetário |
| **paywall** | `pw_funil_vendas` etc | `true` (sempre) | display fixo do laudo-pago |

Caps na agregação (linha 2341, `caps_categoria` + `caps_ise`):
- Cada categoria tem **cap por categoria**: ro=0,3 · passivo=0,25 · multiplo=0,25 (% do valuation atual).
- ISE também limita: ISE 0-39 cap 0,2 / 40-59 cap 0,35 / 60-74 cap 0,5 / 75-89 cap 0,65 / 90+ cap 0,8.
- **Tributário não tem cap** (sai do tributario_calculado direto).
- `cap_absoluto = 0,8` impede potencial > 80% do valor atual.

Resultado em `calc_json.potencial_12m`:
- `valor_total_upside_anual_brl`
- `valor_total_upside_anual_brl_capped`
- `por_categoria` ({`ro`: {`bruto`, `cap`, `capped`}, ...})
- `valuation_atual`, `valuation_potencial_12m_capped`

### 8.5 ICD — `calcICDv2` (linha 2261)

ICD = **Índice de Confiança do Diagnóstico**. Soma de tags `informado` em `_origem_campos`, ponderada. Resultado 0-100:
- 85+ : "Diagnóstico Pleno"
- 70-84: "Diagnóstico Robusto"
- 50-69: "Diagnóstico Operacional"
- 30-49: "Diagnóstico Indicativo"
- 0-29: "Diagnóstico Preliminar"

Mostrado no laudo-completo e no admin como medidor da confiança nas conclusões.

---

## 9. Shape do `calc_json` — `montarCalcJsonV2` (linha 2741)

Esse é o contrato com TODOS os consumidores (laudo-completo, laudo-pago, laudo-admin, negocio.html, painel-admin, gerar_textos_laudo).

```jsonc
{
  "_versao_calc_json": "2.0",
  "_versao_parametros": "v2026.11-pool-9-categorias",
  "_data_avaliacao": "2026-05-03",
  "_skill_versao": "2.0.0-etapa2.9",
  "_modo": "commit",                     // ou "preview"
  "_laudo_v2_id": "<uuid>",
  "_versao_laudo": 1,

  "identificacao": {
    "id", "codigo_diagnostico", "slug", "nome", "nome_responsavel",
    "tipo_negocio_breve", "subcategoria",
    "setor": { "code", "label" },
    "modelo_atuacao": { "selecionados": [...], "principal": "..." },
    "regime_tributario_declarado": {
      "code", "label", "anexo_simples",
      "fator_r_calculado", "observacao_fator_r"
    },
    "localizacao": { "cidade", "estado", "bairro" },
    "tempo_operacao_anos", "expectativa_valor_dono", "pct_produto"
  },

  "inputs_origem": { "fat_mensal": "informado", "crescimento_pct": "fallback_zero", ... },

  "dre": {
    "fat_mensal", "fat_anual",
    "deducoes": { "impostos": {...}, "taxas_recebimento", "comissoes",
                  "royalty_pct_aplicado", "mkt_franquia_pct_aplicado",
                  "antecipacao_recebiveis", "total_deducoes",
                  "impostos_calculados_mensal", "impostos_declarados_pelo_vendedor_mensal",
                  "diferenca_potencial_passivo_mensal" },
    "rec_liquida", "cmv", "lucro_bruto", "margem_bruta_pct",
    "pessoal":  { "clt_folha_bruta", "clt_encargos", "clt_encargos_detalhes",
                  "pj_custo", "royalty_fixo", "mkt_franquia_fixo",
                  "folha_total", "folha_total_mensal" },
    "ocupacao": { "aluguel", "facilities", "terceirizados", "total" },
    "operacional_outros": { "sistemas", "outros_cf", "mkt_pago", "total" },
    "ro_mensal", "ro_anual", "margem_operacional_pct",
    "resultado_financeiro", "impostos_sobre_lucro",
    "lucro_liquido_mensal",
    "prolabore", "parcelas_dividas", "investimentos",
    "potencial_caixa_mensal",
    "blocos": { ... mesma info estruturada por bloco ... }
  },

  "balanco": {
    "ativos":  { "caixa","contas_receber","estoque","equipamentos","imovel",
                 "ativo_franquia","outros","total","imobilizado_total" },
    "passivos":{ "fornecedores_a_vencer","fornecedores_atrasados",
                 "impostos_atrasados_sem_parcelamento","saldo_devedor_emprestimos",
                 "provisao_clt_calculada":{valor,formula,fator_encargo_aplicado,regime_referencia},
                 "outros_passivos","total" },
    "patrimonio_liquido", "ncg":{valor,calculo}, "ciclo_financeiro":{pmr_dias,pmp_dias,ciclo_dias}
  },

  "ise": {
    "classe", "ise_total", "fator_classe",
    "pilares": [ { "id", "label", "peso_pct", "score_0_10", "contribuicao_no_total",
                   "sub_metricas": [ { "id","label","valor","benchmark","score_0_10","peso_decimal" } ] }, ... ]
  },

  "valuation": {
    "multiplo_setor":{ "codigo","label","valor" },
    "ajuste_forma_atuacao":{ "principal","outras","total_ajuste" },
    "multiplo_base", "fator_ise":{classe,valor,faixa}, "fator_final",
    "ro_anual", "valor_operacao", "patrimonio_liquido", "valor_venda",
    "ro_negativo", "ro_negativo_msg", "cta_especialista", "alerta_pl_negativo"
  },

  "atratividade": {
    "componentes": [ {id:"ise",...}, {id:"setor",...}, {id:"crescimento",...} ],
    "total", "classe"
  },

  "operacional": {
    "num_funcionarios", "num_clientes", "tempo_operacao_anos",
    "fat_mensal", "fat_anual", "num_socios", "prolabore_mensal_total",
    "concentracao_status"
  },

  "icd": { "score","classe","tags_informado","tags_fallback" },

  "indicadores_vs_benchmark": {  // ~17 indicadores
    "margem_bruta": {valor, benchmark, status},
    "margem_operacional_pct", "cmv_pct", "folha_pct", "aluguel_pct",
    "mkt_pct", "outros_cf_pct", "deducoes_pct",
    "recorrencia_pct", "concentracao_pct",
    "pmr_dias", "pmp_dias", "ciclo_dias",
    "liquidez_geral", "ncg_meses",
    "ticket_medio", "ro_por_funcionario", "ro_por_cliente"
  },

  "analise_tributaria": {
    "regime_atual": {...},
    "regimes_testados": [ {regime, anexo, imposto_anual, elegivel}, ... ],
    "regime_otimo": {...},
    "ganho_anual_brl",
    "fator_r_calculado", "fator_r_observacao",
    "gera_upside_obrigatorio"
  },

  "upsides": {
    "ativos": [ {id,label,descricao,categoria,contribuicao_brl,...}, ... ],
    "paywalls": [ {id,label,descricao}, ... ]
  },

  "potencial_12m": {
    "valor_total_upside_anual_brl",
    "valor_total_upside_anual_brl_capped",
    "valuation_atual", "valuation_potencial_12m_capped",
    "por_categoria": { ro:{bruto,cap,capped}, passivo:{...}, multiplo:{...} }
  },

  "recomendacoes_pre_venda": [ ... ],

  "textos_ia": {
    "_gerados_em", "_modelos_usados", "status",
    "texto_resumo_executivo_completo": {modelo,conteudo},
    "texto_contexto_negocio": {...},
    "texto_parecer_tecnico": {...},
    "texto_riscos_atencao": {...},
    "texto_diferenciais": {...},
    "texto_publico_alvo_comprador": {...},
    "descricoes_polidas_upsides": []
  },

  "textos_anuncio": {
    "texto_resumo_executivo_anonimo": {...},
    "sugestoes_titulo_anuncio": {modelo:"haiku",conteudo:[]},
    "texto_consideracoes_valor": {...}
  }
}
```

---

## 10. Laudos entregues — o que tem em cada um

### 10.1 Laudo gratuito — `laudo-completo.html` (1.530 linhas)

URL: `/laudo-completo.html?id=<negocio_uuid>` (ou `?c=<codigo>`).
Linha 242: **"skill-avaliadora removida — laudo-completo SÓ LÊ calc_json, não calcula"**.

Carrega `laudos_v2.calc_json` (`ativo=true`) por `negocio_id`. Render direto a partir do calc_json com retry caso a skill ainda não tenha terminado de gravar.

Seções principais (renderizadas a partir das chaves do calc_json):
1. **Folha de rosto** — nome do negócio, código, setor, cidade, data
2. **ISE — 8 pilares** — itera `calc_json.ise.pilares[]` (linha 1165) com sub-métricas e scores
3. **DRE resumida** — fat, deduções, lucro bruto, RO, margem
4. **Balanço** — ativos, passivos, PL, NCG
5. **Avaliação 1N** — valor central + faixa (uso de `valuation.valor_venda`)
6. **Atratividade** — score + classe
7. **Indicadores vs benchmark setorial** — verde/amarelo/vermelho de `indicadores_vs_benchmark`
8. **Análise tributária** — regime atual vs ótimo
9. **Upsides ativos** — soma agregada (`potencial_12m`)
10. **Recomendações pré-venda** — `recomendacoes_pre_venda[]`
11. **Textos editoriais** — `textos_ia.texto_resumo_executivo_completo`, `texto_contexto_negocio`, etc

**Nada hardcoded** — qualquer mudança no snapshot ativo aparece automaticamente no laudo.

### 10.2 Laudo pago R$ 99 — `laudo-pago.html` (2.178 linhas)

URL: `/laudo-pago.html?id=<negocio_uuid>`.

Carrega o mesmo `calc_json`. Difere do gratuito principalmente porque:
- **Desbloqueia** os upsides categoria `paywall` (funil de vendas, mapeamento competitivo, plano de transição) — esses ficam visíveis em vez de teaser.
- Conteúdo editorial mais profundo (usa `texto_parecer_tecnico` e `texto_publico_alvo_comprador` que no gratuito ficam parciais).
- Layout em PDF print-ready (linha 947+: capas, sumário, page-breaks).

Seções do `<section class="sec">` (linhas 947-2166):
1. Capa
2. Sumário
3. Folha de rosto + identificação
4. ISE 8 pilares (detalhado com explicações)
5. DRE completa (5 blocos)
6. Balanço completo
7. Análise tributária (com tabela dos 3 regimes)
8. Avaliação 1N (com explicação do múltiplo)
9. Atratividade
10. Indicadores
11. Operacional
12. Apresentação editorial
13. Upsides ativos detalhados
14. ICD
15. Tributária extra
16. Fechamento

### 10.3 Laudo admin — `laudo-admin-v2.html` (3.507 linhas)

URL: `/laudo-admin-v2.html?id=<negocio_uuid>`.

Visão completa de auditoria. **15 seções** (todas referenciam o calc_json):

| ID seção | O que mostra |
|---|---|
| `sec-metadata` | versão calc_json, parâmetros, data, modo, skill versão |
| `sec-identificacao` | identificação completa |
| `sec-inputs-origem` | tags `informado`/`fallback_zero` por campo |
| `sec-dre` | DRE 5 blocos com decomposição completa |
| `sec-balanco` | ativos+passivos+PL+NCG |
| `sec-ise` | 8 pilares com sub-métricas, scores e contribuições |
| `sec-valuation` | múltiplo+ajuste+fator+valor |
| `sec-atratividade` | 3 componentes |
| `sec-tributaria` | regimes testados + Fator R |
| `sec-upsides` | catálogo aplicado (gates ativados/inativos) |
| `sec-potencial-12m` | agregação com caps por categoria + ISE |
| `sec-operacional` | dados crus |
| `sec-indicadores` | indicadores vs benchmarks |
| `sec-textos-ia` | conteúdos gerados pela edge function |
| `sec-raw` | calc_json bruto (debug) |

Cada seção tem botão `[ JSON ]` que mostra o pedaço bruto do calc_json correspondente.

---

## 11. Pendências e ⚠️ encontrados

### 11.1 Inputs do diagnóstico que viram "fallback_zero" mesmo o vendedor respondendo

- **`gestor_autonomo`** (t33): mapeia para 2 campos diferentes (`tem_gestor` E `opera_sem_dono`) — aproximação consciente documentada, mas é uma simplificação. Quem tem gestor autônomo **automaticamente** é considerado "opera sem dono" — pode haver casos divergentes (skill-avaliadora-v2.js:822).
- **`crescimento_pct`**: distingue 0 deliberado de 0 ausente via flag `crescimento_respondido`. Bug B documentado em b174152: o ramo de fallback via `fat_anterior` foi removido (não havia campo `fat_anterior` no diag).

### 11.2 Acoplamento legado (skill v1)

- Linha 7870 do diagnostico.html ainda chama `AVALIADORA.avaliar(dadosParaAvaliar)` (skill v1) **antes** de chamar a v2. A v1 grava em outras tabelas (`laudos`/`avaliacoes` ⚠️ a confirmar) e o redirect final usa o resultado da v1, não da v2. A v2 roda em paralelo "fire-and-forget".
- ⚠️ **A v1 ainda é a fonte da resposta visual final do diagnóstico** — embora a v2 grave em `laudos_v2` e os laudos (`laudo-completo`, `laudo-pago`, `laudo-admin-v2`) leiam de lá. Há um descompasso conceitual: cliente fecha o diag com avaliação v1; ao abrir o laudo, vê a v2.

### 11.3 Pró-labore não entra no RO (decisão consciente)

A função `calcDREv2` põe pró-labore só no Bloco 5 (desembolsos do sócio). Isso significa que **margem operacional** publicada no laudo ignora pró-labore. ⚠️ Decisão arquitetural — não é bug, mas é importante destacar para quem lê o laudo achar a "margem real".

### 11.4 Tabelas legadas suspeitas

A query nos schemas mostrou:
- `laudos`, `laudos_completos`, `diagnosticos_1n`, `negocios_1n`, `pedidos_avaliacao`, `avaliacoes`, `negocios_publicados` (291 colunas) — ⚠️ não foi confirmado se ainda são usadas, ou se são fixtures/legado.
- `negocio_dre`, `negocio_pilares`, `negocio_socios`, `negocio_fontes`, `negocio_colaboradores`, `negocio_eventos`, `negocio_views`, `negocio_cliques` — ⚠️ tabelas de evento/desnormalização, fora do core de cálculo.

### 11.5 Provisão CLT só com 6 meses

`balanco.passivos.provisao_clt_calculada` aprovisiona 6 meses (`× 0.13 × 6`). Comentário diz "fórmula: clt_folha × 0.13 × 6 × fator_encargo". Isso é **proxy** de 13º + férias + multa rescisória + FGTS — calibração do "0.13" (= 13%) é uma média prática, não uma derivação contábil exata. ⚠️ Documentar e revisar com contabilidade quando for o caso.

### 11.6 ICD ainda em refinamento

`calcICDv2` (linha 2261) usa contagem de tags `informado`/`fallback_zero` em `_origem_campos`. Não há ponderação por importância do campo (CMV deveria pesar mais que `outros_passivos` no índice de confiança). ⚠️ Calibração futura.

### 11.7 Hardcoded ainda presentes

- **SETOR_LABELS** (mapa code→label) está no JS, não no snapshot. Adicionar setor exigiria edit no skill. ⚠️
- **`presunções` Lucro Presumido** (`determinarPresuncoesPresumido` linha 231) estão hardcoded (`{irpj:0.08, csll:0.12}` vs `{irpj:0.32, csll:0.32}`). Não há controle por snapshot. ⚠️
- **ISS/ICMS por setor** em `determinarRegimeMunicipalEstadual` (linha 204) também hardcoded. ⚠️
- **Anexos Simples (tabelas 2025)** hardcoded em `calcImpostoSobreFaturamento`. Quando vier reforma tributária ou mudança de tabela, exige edit no skill. ⚠️

### 11.8 Laudo gratuito (`laudo-completo.html`) ≠ laudo R$ 99 (`laudo-pago.html`)

Hoje **dois arquivos diferentes**, com algum HTML duplicado. Ambos leem mesmo `calc_json`. ⚠️ Provavelmente vai para um único arquivo no futuro, com flag de plano/desbloqueio.

---

## 12. Resumo executivo

```
DIAGNÓSTICO (61 telas)
    ↓ POST negocios.dados_json
    ↓ AVALIADORA_V2.avaliar(D, 'commit')
        ├─ mapDadosV2 (normaliza)
        ├─ calcDREv2 (5 blocos com regime+anexo+forma)
        ├─ calcBalancoV2 (ativos/passivos/PL/NCG)
        ├─ calcISEv2 (8 pilares · pesos: 20/15/15/15/10/10/8/7)
        ├─ calcValuationV2 (RO_anual × multiplo_setor + ajuste_forma × fator_ISE + PL)
        ├─ calcAtratividadeV2 (50% ISE + 25% setor + 25% crescimento)
        ├─ calcAnaliseTributariaV2 (testa Simples/Presumido/Real)
        ├─ calcIndicadoresV2 (vs benchmarks setoriais)
        ├─ calcICDv2 (Índice de Confiança Diagnóstico)
        ├─ gerarUpsidesV2 (20 upsides com gates)
        ├─ agregarPotencial12mV2 (com 3 caps por categoria + cap ISE + cap absoluto 0,8)
        └─ montarCalcJsonV2 (shape final)
    ↓ INSERT laudos_v2 (versionado, ativo=true)
    ↓ edge function gerar_textos_laudo (9 textos paralelos via Anthropic)
    ↓ redireciona para /laudo-completo.html?id=<uuid>
LAUDOS (apenas leem calc_json — zero cálculo no front)
    ├─ laudo-completo.html (gratuito, 11 seções)
    ├─ laudo-pago.html (R$99, ~16 seções, paywalls desbloqueados)
    └─ laudo-admin-v2.html (admin, 15 seções + JSON bruto)
```

Tudo o que muda no snapshot ativo (`parametros_versoes`) reflete imediatamente em laudos novos. Snapshot atual: **`v2026.11-pool-9-categorias`**.
