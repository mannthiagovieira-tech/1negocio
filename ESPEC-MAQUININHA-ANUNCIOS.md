# 1Negócio · Espec da "Maquininha" de Geração de Anúncios

> Documento gerado em 03/05/2026 lendo `main` (commit pós 7bd4ed3).
> Cobre: scripts, fluxo, formatos JSON, calibragem matemática,
> persistência, comandos, integração admin.
> Tudo aqui é o que está rodando hoje. Nada inventado.

---

## 0. O que é a maquininha

Sistema **CLI Node.js** que automatiza a criação de anúncios de teste no marketplace 1Negócio. Recebe perfis de negócio em JSON, executa o **mesmo pipeline real** de avaliação que o `diagnostico.html` (skill v2 + edge functions de texto IA), e publica anúncios direto em produção (com `origem='maquininha_teste'` pra distinguir de cadastros reais de vendedor).

**Casos de uso atuais:**
- Popular o marketplace pra testes de UX e demonstração comercial
- Validar mudanças no skill v2, em prompts ou em snapshots de parâmetros (lote 50/200/500)
- Testar variantes de geração de título/descrição (pool 8 → pool 9 categorias)

**Estado atual da base (em 03/05/2026):**
- 558 anúncios `status='publicado' AND origem='maquininha_teste'`
- 100 em `rascunho` (89 fallback genérico aguardando remediação + 11 antigos)

---

## 1. Arquivos e localização

```
/Users/premium/1negocio/
│
├── scripts/
│   ├── criar-anuncio-completo.js .................... 606 linhas (orquestrador)
│   │   ├── backup-pre-lote-02mai2026 ............... versão pre-lote 200
│   │   └── backup-pre-lote500-02mai2026 ............ versão pre-lote 500
│   │
│   └── perfis-teste/                                  828 arquivos JSON
│       ├── 01-padaria-saudavel.json                   manuais (formato v1
│       ├── 02-saas-recorrente.json                    "negocio + dados_json")
│       ├── 03-negocio-em-risco.json                   ⚠ legados, ainda funcionam
│       ├── 04-restaurante-franquia-curitiba.json
│       ├── 05-clinica-odontologica-sp.json
│       ├── 06-pet-shop-bh.json
│       ├── 07-oficina-mecanica-poa.json
│       ├── 08-padaria-salvador.json
│       ├── 09-loja-roupas-recife.json
│       ├── 10-empresa-limpeza-goiania.json
│       │
│       ├── seed-piloto-001.json a seed-piloto-010.json    ← 10 perfis pilot inicial
│       ├── seed-200-001.json a seed-200-200.json          ← lote 200 (procedural v1)
│       ├── seed-pilotov2-001.json a seed-pilotov2-050.json ← piloto 50 (procedural v2)
│       ├── seed-test-pool9-001.json a -005.json           ← teste 5 pool 9
│       └── seed-500-001.json a seed-500-500.json          ← lote 500 (procedural v2 escalado)
│
├── skill-avaliadora-v2.js .......................... 3.002 linhas (skill core, executada em sandbox vm)
│
└── supabase/functions/
    ├── gerar_textos_laudo/index.ts ................. edge function (9 textos via Anthropic)
    └── gerar_textos_anuncio/index.ts ............... edge function (textos pós-card do anúncio)
```

### 1.1 Geradores Python (perfis procedurais)

Os scripts que **GERAM** os arquivos `seed-*.json` ficavam em `/tmp/`:

```
/tmp/gerar_perfis_lote_v2.py ........... gerador piloto 50 (5/setor)
/tmp/gerar_perfis_lote_500.py .......... gerador lote 500 (escalado 10×)
/tmp/gerar_piloto_10.py ................ piloto 10
/tmp/gerar_perfis_lote_200.py .......... lote 200 (versão v1, com bugs)
```

⚠️ **Esses arquivos foram apagados na limpeza de 02/05/2026.** Apenas os JSONs gerados ficaram. Pra regerar, é preciso recriar o script Python. A lógica está documentada em §6.

---

## 2. Fluxo end-to-end (1 perfil JSON → 1 anúncio publicado)

```
┌──────────────────────────────────────────────────────────────────────┐
│  ENTRADA: 1 arquivo JSON em scripts/perfis-teste/                    │
│  Formato: identificacao + dre + balanco_patrimonial + comercial +    │
│           gestao + legal (formato v2 procedural)                     │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
       processarPerfil(perfilPath)  — criar-anuncio-completo.js:387
                              │
   ┌──────────────────────────┼──────────────────────────────────┐
   │                                                              │
   ▼                                                              │
┌──────────────────────────────────────────────────────────────┐  │
│ Passo 1 · mapPerfilParaDadosJson(perfil) — linha 90          │  │
│    Converte o formato "perfil teste" pro formato flat        │  │
│    que a tabela negocios.dados_json espera                   │  │
│    + hardcodes:                                              │  │
│      - clt_folha = clt_qtd × R$ 4.500                        │  │
│      - pj_custo  = pj_qtd × R$ 8.000                         │  │
│      - anexo_simples = 'I' (HARDCODED ⚠️)                    │  │
│      - taxas_recebimento = fat × 1,8%                        │  │
│      - mkt_valor   = outros_custos_fixos × 0,2               │  │
│      - utilities   = outros_custos_fixos × 0,2               │  │
│      - sistemas    = outros_custos_fixos × 0,1               │  │
│      - custo_outros = outros_custos_fixos × 0,5              │  │
└──────────────────────────────────────────────────────────────┘  │
   │                                                              │
   ▼                                                              │
┌──────────────────────────────────────────────────────────────┐  │
│ Passo 2 · INSERT em negocios — linha 416                     │  │
│    POST /rest/v1/negocios                                     │  │
│    body: {                                                    │  │
│      nome, setor, categoria, cidade, estado,                 │  │
│      tempo_operacao_anos, modelo_negocio,                    │  │
│      slug = '1N-T' + Date.now().toString(36)                 │  │
│      codigo_diagnostico = mesmo,                             │  │
│      faturamento_anual,                                       │  │
│      status = 'em_avaliacao',                                 │  │
│      plano = 'gratuito',                                      │  │
│      origem = 'maquininha_teste',     ← marca pra distinguir │  │
│      vendedor_id = aaaaaaaa-0000-0000-0000-000000000001       │  │
│                    (seed user fixo)                          │  │
│      dados_json: { fat_mensal, regime, anexo, ... }          │  │
│    }                                                          │  │
│    → retorna negocioId (UUID)                                │  │
└──────────────────────────────────────────────────────────────┘  │
   │                                                              │
   ▼                                                              │
┌──────────────────────────────────────────────────────────────┐  │
│ Passo 3 · Carrega skill-avaliadora-v2.js em sandbox vm       │  │
│    Linhas 426-431:                                            │  │
│      const skillCode = fs.readFileSync('skill-avaliadora-v2.js')│
│      vm.createContext(sandbox)                                │  │
│      vm.runInContext(skillCode, sandbox)                      │  │
│      AVALIADORA_V2 = sandbox.window.AVALIADORA_V2             │  │
│    (mesma skill que o diagnostico.html roda no browser,      │  │
│     mas executada em Node.js via vm — sandbox isolado)       │  │
└──────────────────────────────────────────────────────────────┘  │
   │                                                              │
   ▼                                                              │
┌──────────────────────────────────────────────────────────────┐  │
│ Passo 4 · AVALIADORA_V2.avaliar(rowData, 'commit')           │  │
│    Pipeline completo da skill v2:                             │  │
│      mapDadosV2 → calcDREv2 → calcBalancoV2 → calcISEv2     │  │
│      → calcValuationV2 → calcAtratividadeV2                  │  │
│      → calcAnaliseTributariaV2 → calcIndicadoresV2           │  │
│      → calcICDv2 → gerarUpsidesV2 → agregarPotencial12mV2    │  │
│      → montarCalcJsonV2                                       │  │
│    → 'commit' faz INSERT em laudos_v2 (versionado, ativo=true)│  │
└──────────────────────────────────────────────────────────────┘  │
   │                                                              │
   ▼                                                              │
┌──────────────────────────────────────────────────────────────┐  │
│ Passo 5 · GUARD RO<0 — linha 442                             │  │
│    Se calcJson.dre.ro_anual < 0:                             │  │
│      • Log "⊘ pulado · resultado anual negativo"             │  │
│      • Tenta DELETE laudos_v2 + negocios (best-effort —      │  │
│        anon pode falhar; serve apenas como sinalização)      │  │
│      • return { pulado: true, motivo, perfil, negocio_id }   │  │
│      • Próximo perfil do batch                                │  │
└──────────────────────────────────────────────────────────────┘  │
   │                                                              │
   ▼                                                              │
┌──────────────────────────────────────────────────────────────┐  │
│ Passo 6 · Dispara 9 textos IA em paralelo — linha 467        │  │
│    Promise.all:                                               │  │
│      POST /functions/v1/gerar_textos_laudo                    │  │
│      body: { negocio_id, texto_a_gerar: <chave> }            │  │
│    Para cada uma das 9 chaves (TEXTOS, linha 26):            │  │
│      texto_resumo_executivo_completo                          │  │
│      texto_contexto_negocio                                   │  │
│      texto_parecer_tecnico                                    │  │
│      texto_riscos_atencao                                     │  │
│      texto_diferenciais                                       │  │
│      texto_publico_alvo_comprador                             │  │
│      descricoes_polidas_upsides                               │  │
│      sugestoes_titulo_anuncio   ← gera 3 sugestões           │  │
│      texto_consideracoes_valor                                │  │
│    Cada chamada usa snapshot ativo de parametros_versoes     │  │
│    (v2026.11) e atualiza calc_json.textos_anuncio.<chave>    │  │
└──────────────────────────────────────────────────────────────┘  │
   │                                                              │
   ▼                                                              │
┌──────────────────────────────────────────────────────────────┐  │
│ Passo 7 · INSERT termos_adesao — linha 488                   │  │
│    POST /rest/v1/termos_adesao                                │  │
│    valor_pedido = valuation.valor_venda × _preco_modificador  │  │
│      • _preco_modificador no perfil (1.0 default,             │  │
│        1.10-1.30 sobrepreco, 0.75-0.90 oportunidade)         │  │
│    plano = 'gratuito', comissao_pct = 10, exige_nda = false  │  │
│    razao_social, cnpj, cpf, endereço — DUMMIES (Thiago)       │  │
│    status = 'assinado'                                        │  │
│    → retorna termoId                                          │  │
└──────────────────────────────────────────────────────────────┘  │
   │                                                              │
   ▼                                                              │
┌──────────────────────────────────────────────────────────────┐  │
│ Passo 8 · montarTitulo + montarDescricaoCard — linhas 359/232│  │
│    titulo = sorteia ALEATORIAMENTE entre as 3 sugestões IA   │  │
│             do calc_json.textos_anuncio.sugestoes_titulo_     │  │
│             anuncio.conteudo[]                                │  │
│             • Filtra palavras proibidas (linha 38)            │  │
│             • Trunca em 60 chars                              │  │
│             • Fallback: "{Setor} em {Cidade}" se IA falhou    │  │
│                                                                │  │
│    descricao_card = monta ~200 chars com:                    │  │
│             tipo de negócio + setor específico (subcat)      │  │
│             + diferenciais elegíveis (margem, recor, anos)   │  │
│             + chamada CTA                                     │  │
└──────────────────────────────────────────────────────────────┘  │
   │                                                              │
   ▼                                                              │
┌──────────────────────────────────────────────────────────────┐  │
│ Passo 9 · INSERT anuncios_v2 — linha 531                     │  │
│    POST /rest/v1/anuncios_v2                                  │  │
│    body: {                                                    │  │
│      negocio_id, laudo_v2_id, vendedor_id,                   │  │
│      titulo, descricao_card,                                  │  │
│      valor_pedido,                                            │  │
│      termo_adesao_id, termo_assinado_em,                     │  │
│      status = 'publicado',          ← direto, não rascunho   │  │
│      publicado_em = NOW(),                                    │  │
│      origem = 'maquininha_teste'                              │  │
│    }                                                          │  │
│    Codigo (1N-AN-XXXXX) gerado por trigger no banco.         │  │
└──────────────────────────────────────────────────────────────┘  │
                              │
                              ▼
        ANÚNCIO publicado em https://1negocio.com.br/
        (aparece na home, listado em /negocio.html?codigo=...)
```

---

## 3. Comandos atuais

### 3.1 Rodar 1 perfil específico

```bash
cd /Users/premium/1negocio
node scripts/criar-anuncio-completo.js scripts/perfis-teste/01-padaria-saudavel.json
```

### 3.2 Rodar batch (todos os perfis que casam com regex)

```bash
cd /Users/premium/1negocio
node scripts/criar-anuncio-completo.js --batch
```

A regex está em `criar-anuncio-completo.js:551`:
```js
.filter(f => /^seed-500-\d{3}\.json$/.test(f))
```

⚠️ Atualmente fixa em `seed-500-`. Pra rodar outro lote, **edita essa regex manualmente** antes de rodar.

Histórico de regex usadas:
- `/^seed-piloto-\d{2}\.json$/` (piloto 10)
- `/^seed-200-\d{3}\.json$/` (lote 200)
- `/^seed-pilotov2-\d{3}\.json$/` (piloto 50)
- `/^seed-test-pool9-\d{3}\.json$/` (teste 5 do pool 9 categorias)
- `/^seed-500-\d{3}\.json$/` (atual — lote 500)

### 3.3 Rodar em background (lote longo)

```bash
node scripts/criar-anuncio-completo.js --batch > /tmp/lote500-output.log 2>&1 &
```

Tempo estimado: **~3h pra 500 perfis** (taxa observada 2-3 perfis/min).

### 3.4 Validar via SQL após batch

```sql
SELECT 
  COUNT(*) FILTER (WHERE a.status='publicado') AS publicado,
  COUNT(*) FILTER (WHERE a.status='rascunho')  AS rascunho,
  ROUND(AVG((l.calc_json->'dre'->>'margem_operacional_pct')::numeric),1) AS margem_media
FROM anuncios_v2 a
JOIN laudos_v2 l ON l.negocio_id = a.negocio_id AND l.ativo
WHERE a.origem = 'maquininha_teste'
  AND a.publicado_em > NOW() - INTERVAL '4 hours';
```

---

## 4. Formatos de perfil JSON (2 versões em uso)

### 4.1 Formato v1 — manual (10 arquivos `01-` a `10-`)

Estrutura "negocio + dados_json achatado":
```jsonc
{
  "_descricao": "...",
  "_perfil_esperado": "...",
  "negocio": {
    "nome": "Padaria do Teste 01",
    "setor": "alimentacao",
    "categoria": "padaria",
    "cidade": "Florianopolis",
    "estado": "SC",
    "tempo_operacao_anos": 10,
    "modelo_negocio": "b2c"
  },
  "dados_json": {
    "fat_mensal": 500000,
    "fat_anterior": 480000,
    "crescimento_pct": 4.2,
    "regime": "simples",
    "anexo_simples": "I",
    "setor": "alimentacao",
    "modelo_atuacao_multi": ["produto_proprio"],
    "cmv_valor": 175000,
    "clt_folha": 45000,
    "clt_qtd": 5,
    "aluguel": 15000,
    "custo_sistemas": 2000,
    "custo_outros": 5000,
    "mkt_valor": 8000,
    "prolabore": 25000,
    "parcelas_mensais": 5000,
    /* + ~30 outros campos esperados pela skill v2 */
  }
}
```

⚠️ Esses 10 são legados. **Funcionam**, mas o `mapPerfilParaDadosJson` precisa ler tanto `perfil.identificacao` (formato v2) quanto `perfil.negocio` (formato v1) — e a função atualmente tem ramos pra ambos.

### 4.2 Formato v2 — procedural (815 arquivos seed-*)

Estrutura nova, gerada por scripts Python:

```jsonc
{
  "_descricao": "Piloto v2 — Alimentação/lanchonete em Campo Grande/MS — fat alto 3a target 9.2% calc 14.16% recor 8% — no_preco",
  "_preco_modificador": 1.003,
  "_distribuicao_tags": {
    "geo": "Campo Grande/MS",
    "setor_label": "Alimentação",
    "subcategoria": "lanchonete",
    "fat_bucket": "alto",
    "tempo_bucket": "novo",
    "preco_bucket": "no_preco",
    "margem_target_pct": 9.2,
    "margem_calc_pct": 14.16,
    "regime": "simples",
    "aliq_efetiva_pct": 11.06,
    "tentativas": 1
  },
  "tipo_caso": "piloto_v2",

  "identificacao": {
    "nome": "Padaria Vovó Dora Campo",
    "setor": "alimentacao",
    "subcategoria": "lanchonete",
    "cidade": "Campo Grande",
    "estado": "MS",
    "tempo_operacao_anos": 3,
    "modelo_negocio": "b2c",
    "regime_tributario": "simples",
    "funcionarios_clt": 12,
    "funcionarios_pj": 2
  },

  "dre": {
    "faturamento_anual": 2695000,
    "faturamento_anterior": 2564012,
    "cmv_pct": 32,
    "margem_operacional_pct": 9.2,
    "prolabore_mensal": 18977,
    "aluguel_mensal": 12318,
    "outros_custos_fixos": 5393
  },

  "balanco_patrimonial": {
    "ativo_imobilizado": 640458,
    "ativo_estoque": 135744,
    "ativo_caixa": 275016,
    "passivo_dividas": 186345,
    "passivo_fornecedores": 65494
  },

  "comercial": {
    "tem_recorrencia": false,
    "recorrencia_pct": 8,
    "concentracao_cliente": false,
    "num_clientes_ativos": 800,
    "ticket_medio": 280
  },

  "gestao": {
    "processos_documentados": "parcial",
    "opera_sem_dono_15dias": true,
    "tem_gerente": true,
    "equipe_permanece_apos_venda": "provavelmente"
  },

  "legal": {
    "passivo_trabalhista": false,
    "acao_judicial": false,
    "impostos_dia": "sim",
    "contabilidade_formal": true,
    "marca_registrada": false
  }
}
```

**Diferenças do formato v1:**
- `_distribuicao_tags` com metadados pra balanceamento estatístico do batch
- `_preco_modificador` (1.0 = no preço; 1.10-1.30 = sobrepreço; 0.75-0.90 = oportunidade)
- Estrutura achatada por seção (DRE / balanço / comercial / gestão / legal)
- `tipo_caso` identifica o tipo de batch (`piloto_v2` / `lote_500` / `lote_200`)

---

## 5. mapPerfilParaDadosJson — derivações automáticas

Função `mapPerfilParaDadosJson` (linha 90, ~115 linhas). Converte perfil → `dados_json` flat que skill v2 consome.

### 5.1 Hardcodes importantes

| Campo gerado | Fórmula |
|---|---|
| `clt_folha` | `funcs_clt × R$ 4.500` |
| `pj_custo` | `funcs_pj × R$ 8.000` |
| `cmv_valor` | `fat_mensal × cmv_pct / 100` |
| `taxas_recebimento` | `fat_mensal × 1.8%` |
| `aluguel` | `dre.aluguel_mensal` |
| `custo_utilities` | `outros_custos_fixos × 0.2` |
| `custo_terceiros` | `0` |
| `custo_sistemas` | `outros_custos_fixos × 0.1` |
| `custo_outros` | `outros_custos_fixos × 0.5` |
| `mkt_valor` | `outros_custos_fixos × 0.2` |
| **`anexo_simples`** | **`'I'` HARDCODED ⚠️** |
| `prolabore` | `dre.prolabore_mensal` |
| `parcelas_mensais` | `passivo_dividas / 36` (assume 36 meses) |
| `at_imovel` | `0` |
| `outro_passivo_val` | `0` |

### 5.2 Mapeamento categórico

| Perfil → | dados_json |
|---|---|
| `gestao.opera_sem_dono_15dias === true` | `'sim'` |
| `gestao.tem_gerente === true` | `'sim'` |
| `gestao.equipe_permanece_apos_venda === 'provavelmente'` | `'parcial'` |
| `legal.marca_registrada === true` | `'registrada'` |
| `comercial.concentracao_cliente === true` | `35` (% — assume 35) |

### 5.3 Trabalho do mapper de setor

```js
let setorMap = id.setor;
if (id.setor === 'servicos') {
  setorMap = id.modelo_negocio === 'b2b'
           ? 'servicos_empresas'
           : 'servicos_locais';
}
```

### 5.4 ⚠️ Implicação crítica do hardcode `anexo_simples='I'`

A skill v2 calcula imposto Simples baseado no anexo. Como o mapper força sempre `'I'` (Comércio), todos os perfis pagam alíquota de Anexo I — mesmo serviços que deveriam pagar Anexo III (ou IV/V).

Isso **subestima o imposto** pra serviços (Simples I é mais barato que III). Pra comércio/alimentação/varejo é correto.

A calibragem do gerador v2 (§6.3) compensa isso usando alíquotas reais — mas o `mapPerfilParaDadosJson` é o que gera os números finais que vão pro banco. Há uma divergência: gerador calcula com Anexo certo, mapper força Anexo I.

---

## 6. Geradores Python (apagados, mas lógica documentada)

⚠️ Os scripts `.py` foram apagados em 02/05/2026. Documento aqui a lógica deles pra reconstrução.

### 6.1 Distribuições do lote 500 (`gerar_perfis_lote_500.py`)

**GEO — 34 cidades** (capitais grandes 60% / médias 30% / interior 10%):
```
SP=60, RJ=45, BH=35, Curitiba=30, POA=25, Recife=25, Brasília=25,
Salvador=20, Fortaleza=20, Florianópolis=15
+ 14 capitais médias (Goiânia 15, Manaus 12, Belém 12, ... = 150)
+ 10 cidades interior (5 cada = 50)
```

**SETORES — 18 categorias:**
```
Varejo=60, Alimentação=55, Serviços B2B=50, Saúde=45, Beleza=40,
Pet=30, Educação=30, Tecnologia=25, Academia=25, Hospedagem=20,
Indústria=20, Construção=20, Logística=20, Farmácia=15,
Imobiliário=15, Automotivo=15, Eventos=10, Cultura=5
```

**FATURAMENTO — 5 buckets:**
```
micro    R$ 200-500k  →  75 (15%)
baixo    R$ 500k-1M   → 125 (25%)
medio    R$ 1-2M      → 150 (30%)
alto     R$ 2-5M      → 100 (20%)
topo     R$ 5-10M     →  50 (10%)
```

**TEMPO:**
```
novo          3-5 anos   → 150 (30%)
estabelecido  5-10 anos  → 200 (40%)
maduro        10-20 anos → 125 (25%)
legado        20-35 anos →  25 (5%)
```

**REGIME (60/30/10):** Simples 60% · Presumido 30% · Real 10% (Real só fat ≥ 3M)

**MARGEM alvo:** uniforme 3%-25%, mas com calibragem matemática que clamp pra máximo viável dado fat × cmv × folha (§6.3).

**PREÇO vs DCF:**
```
no_preco     × 0.95-1.05 → 250 (50%)
sobrepreco   × 1.10-1.30 → 100 (20%)
oportunidade × 0.75-0.90 → 150 (30%)
```

### 6.2 Calibragem matemática — 12 passos sequenciais

Pra garantir RO > 0 em todos os perfis (e evitar guard skip), o gerador procedural v2 faz:

```
1. Sortear inputs (cidade, setor, fat, regime, margem alvo, anos, recor, ...)

2. Calcular alíquota efetiva real:
   • Simples Anexo I: tabela RFB 2025 (4-19% nominal, parcela dedutiva)
   • Lucro Presumido: 16,33% médio (PIS+COFINS+ISS+IRPJ+CSLL)
   • Lucro Real: 14% médio

3. Receita líquida = fat - impostos - taxas_receb (1,8%)

4. CMV = fat × cmv_pct%

5. Lucro bruto = rec_liq - CMV

6. Folha total por regime:
   • Simples não-IV:  clt × 4500 × (1 + 8%) + pj × 8000  (só FGTS)
   • Presumido/Real/Anexo IV: clt × 4500 × (1 + 40%) + pj × 8000  (37,5% + RAT)

7. Aluguel = fat_mensal × random(4-7%)

8. OCF mínimo = max(800, fat_mensal × 1,2%)

9. Margem viável MAX = (lucro_bruto - folha - aluguel - OCF_min) / fat_mensal × 100 - buffer

10. Clamp margem alvo:
    margem_efetiva = max(3, min(margem_alvo, margem_viavel_max))
    ro_target = fat_mensal × (margem_efetiva + buffer_pp) / 100

11. DERIVAR custo_outros como RESÍDUO (garante RO target):
    OCF = lucro_bruto - folha - aluguel - ro_target
    
    Se OCF < OCF_minimo: tenta de novo com fat × 1.10-1.20 e/ou
                          buffer reduzido (5pp → 3pp → 1pp → 0pp).
                          Após 10 tentativas, descarta perfil.

12. Pró-labore SEPARADO (não afeta RO — Bloco 5 da skill):
    R$ 8k-12k se fat<800k
    R$ 12k-18k se fat<2M
    R$ 15k-25k se fat<5M
    R$ 20k-35k se fat≥5M
```

**Resultado típico (lote 500):**
- 500/500 gerados
- 1 descarte recuperado por slot extra
- Margem calculada média: 16,35% (range 0,5%-36,8%)
- 82% dentro de margem 3-25% (alvo briefing)
- 8 pulados por RO<0 no skill v2 (1,6%) — calibragem boa mas não perfeita

### 6.3 Por que a divergência entre `margem_target_pct` e `margem_calc_pct`

`margem_target_pct` = margem que o briefing pediu (sorteada uniforme 3-25%)
`margem_calc_pct` = margem que a skill v2 efetivamente calculou (geralmente 5pp acima por causa do buffer de segurança)

O buffer existe porque o gerador faz cálculo simplificado. A skill v2, com Anexo I hardcoded mas tabelas reais + encargos exatos, geralmente devolve margem um pouco diferente. Buffer de +3-5pp absorve essa variação.

---

## 7. Persistência — tabelas tocadas

| Ordem | Tabela | Operação | O que vai |
|---|---|---|---|
| 1 | `negocios` | INSERT | nome, setor, cidade, fat, dados_json (jsonb), origem='maquininha_teste', vendedor_id=Thiago seed |
| 2 | `laudos_v2` | INSERT (via skill v2) | negocio_id, versao=1, ativo=true, calc_json (jsonb), parametros_versao_id |
| 3 | `gerar_textos_laudo` | atualiza `laudos_v2.calc_json.textos_anuncio.<chave>` | 9 textos paralelos via Anthropic |
| 4 | `termos_adesao` | INSERT | dummies do Thiago, valor_pretendido = valuation × _preco_modificador |
| 5 | `anuncios_v2` | INSERT | negocio_id, laudo_v2_id, titulo (sorteio aleatório das 3 sugestões IA), descricao_card, valor_pedido, status='publicado', origem='maquininha_teste'. Codigo 1N-AN-XXXXX gerado por trigger. |

**vendedor_id fixo** = `aaaaaaaa-0000-0000-0000-000000000001` (linha 24, `VENDEDOR_ID_THIAGO`). Esse user existe no auth.users e foi criado pra rotular leads de teste.

---

## 8. Histórico de execuções recentes

| Data | Lote | Perfis | Sucesso | Pulados RO<0 | Falhas | Snapshot |
|---|---|---|---|---|---|---|
| 02/05 | piloto-10 | 10 | 5 | 5 | 0 | v2026.07 |
| 02/05 | seed-200 | 200 | 87 | 108 | 5 | v2026.09 → v2026.10 |
| 02/05 | piloto v2 (50) | 50 | **50** | 0 | 0 | v2026.10 |
| 03/05 | test-pool9 (5) | 5 | 5 | 0 | 0 | v2026.11 |
| 03/05 | seed-500 | 500 | 471 | 8 | 21 | v2026.11 (pool 9) |

**Causa típica das falhas do lote 500:** rate limit Anthropic API + créditos esgotados nos últimos 88 perfis (que ficaram com título fallback "Setor em Cidade" e foram movidos pra rascunho).

---

## 9. Pendências / ⚠️

### 9.1 Hardcode de `anexo_simples='I'` no mapper

`mapPerfilParaDadosJson` força Anexo I sempre. Distorce alíquota pra serviços. Documentado em §5.4. **Maquininha hoje não respeita o Anexo do perfil.**

### 9.2 Geradores Python apagados

Pra rodar lote novo precisa:
- Recriar o script Python (lógica em §6.2-6.3)
- OU adaptar o último que existia no histórico do shell

Sugestão futura: **mover gerador procedural pra dentro do criar-anuncio-completo.js** (Node nativo) ou pra edge function — eliminar dependência de script transitório em /tmp.

### 9.3 Regex `--batch` hardcoded

Linha 551: `/^seed-500-\d{3}\.json$/`. Pra rodar outro lote, precisa **editar manualmente**. Sugestão: receber regex como argumento (`--batch=seed-piloto-`).

### 9.4 Codigo do anúncio não retornado no INSERT

Linhas 532-535 usam `Prefer: 'return=minimal'` porque PostgREST tem RLS bloqueando SELECT pra anon em alguns casos. Resultado: o script não loga o `1N-AN-XXXXX` final. Admin precisa puxar via SQL depois.

Sugestão admin: usar service_role no script pra evitar isso (e poder fazer DELETE rollback no guard RO<0).

### 9.5 Termos de adesão dummy

Todos os anúncios da maquininha têm:
```
representante_nome = 'Thiago Mann'
cnpj = '00000000000000' (zeros)
cpf  = '00000000000'   (zeros)
email = 'thiago@1negocio.com.br'
whatsapp = '5511952136406'
```

⚠️ Se admin quiser **converter** maquininha pra ferramenta interna de "fastrack vendedor real" (não só teste), o termo de adesão precisa receber dados reais.

### 9.6 Gestão dos 89 anúncios em rascunho

Após o lote 500, 89 anúncios ficaram com fallback "Setor em Cidade" (créditos Anthropic esgotaram). Foram movidos pra rascunho. Pra remediar:
1. Adicionar créditos Anthropic
2. Re-rodar `gerar_textos_laudo` action `sugestoes_titulo_anuncio` pros 89
3. Re-publicar (mover `status` rascunho → publicado)

Backup com IDs: `/tmp/anuncios-despublicados-fallback.txt`.

### 9.7 Vendedor seed compartilhado

Todos os 558 anúncios maquininha têm `vendedor_id = aaaaaaaa-...`. No painel admin do vendedor, aparece como 558 anúncios "do Thiago seed". Filtros admin precisam considerar `origem='maquininha_teste'` pra distinguir.

### 9.8 Não há rollback automático em falha

Se o INSERT em `anuncios_v2` falhar (passo 9), o que ficou em `negocios` + `laudos_v2` + `termos_adesao` permanece. Acumula órfãos.

Sugestão: implementar rollback em try/catch no script. Ou adotar transação via RPC Supabase (PostgreSQL function que faz tudo atomicamente).

---

## 10. Como integrar no painel admin (sugestões)

### 10.1 UI mínima

Tela `/admin-maquininha.html` com:

1. **Upload de perfil JSON** (drag-and-drop ou textarea)
   - Preview do que vai virar antes de submeter
   - Validação de campos obrigatórios

2. **Geração procedural inline** (substituir Python):
   ```
   Quantidade:   [50/100/200/500]
   Distribuição: [piloto / lote balanceado / customizado]
   Snapshot:     [v2026.11 (ativo) / específica]
   Preview:      "Vai gerar 500 perfis: 60 SP, 45 RJ, ..."
   [Gerar]
   ```

3. **Batch viewer**:
   - Lista de perfis ainda não processados
   - Status de cada um (em fila / processando / sucesso / pulado / falha)
   - Log streaming em tempo real

4. **Resumo final**:
   - X publicados, Y pulados RO<0, Z falhas
   - Margem média, ISE médio, valor médio
   - Diff de distribuições alvo vs realizadas

### 10.2 Backend mínimo

**Edge function nova:** `criar-anuncio-batch`
- Recebe `{ profiles: [{...}], options: {...} }`
- Roda o pipeline em fila (1 por vez ou parallelism configurável)
- Streamia logs via SSE pro admin
- Service_role faz INSERT/DELETE com permissão completa (resolve §9.4 e §9.8)

**Edge function nova:** `gerar-perfis-procedural`
- Recebe `{ N, distribuicoes, calibragem, seed }`
- Retorna array de N perfis JSON
- Substitui os scripts Python apagados
- Pode ser chamada antes de `criar-anuncio-batch`

### 10.3 Arquivos a tocar pra primeira versão

1. **Criar:** `admin-maquininha.html` (UI)
2. **Criar:** `supabase/functions/criar-anuncio-batch/index.ts` (port do criar-anuncio-completo.js pra edge function com service_role)
3. **Criar:** `supabase/functions/gerar-perfis-procedural/index.ts` (port da lógica Python)
4. **Manter:** `scripts/criar-anuncio-completo.js` como CLI legado pra dev/debug
5. **Adicionar tabela:** `maquininha_batches` (id, status, criado_em, total_perfis, sucessos, pulados, falhas, log)

---

## 11. Resumo executivo

```
ENTRADA: arquivo JSON em scripts/perfis-teste/seed-XXX-NNN.json
   │
   ▼ node scripts/criar-anuncio-completo.js --batch
   │
   ├─ mapPerfilParaDadosJson → schema flat (anexo_simples HARDCODED='I' ⚠️)
   ├─ INSERT negocios (origem='maquininha_teste', vendedor_id=Thiago seed)
   ├─ vm.runInContext(skill-avaliadora-v2.js) → AVALIADORA_V2.avaliar('commit')
   │     → INSERT laudos_v2 (versao=1, ativo=true, calc_json)
   ├─ GUARD: se ro_anual<0 → pula (best-effort DELETE)
   ├─ Promise.all 9× POST /functions/v1/gerar_textos_laudo
   │     → preenche calc_json.textos_anuncio
   ├─ INSERT termos_adesao (dummies do Thiago, valor × _preco_modificador)
   ├─ montarTitulo: sorteia 1 das 3 sugestões IA (fallback "Setor em Cidade")
   ├─ montarDescricaoCard: ~200 chars com diferenciais
   └─ INSERT anuncios_v2 (status='publicado', origem='maquininha_teste')
   │
   ▼
SAÍDA: 1 anúncio em https://1negocio.com.br/negocio.html?codigo=1N-AN-XXXXX
```

**Pontos críticos pra integração no admin:**
- Migrar de CLI/Python pra edge function (ganha service_role + rollback + transação)
- Resolver hardcode de Anexo I no mapper
- Tornar regex `--batch` parametrizável
- Tabela de batches pra histórico/auditoria
- UI streaming de progresso via SSE

A maquininha hoje é **funcional pra gerar volume** mas tem 8 pendências (§9) que importam quando virar produto interno do admin.
