// gerar-briefing-tese · v9.32 (enxuto · vocabulário canônico)
// Pré-preenche briefing focado em identificar ARQUÉTIPOS de comprador.
// Removido em v9.32: tese narrativa · motivo da venda · momento de mercado · riscos
// Adicionado: sinergia (consolidador) · tipos_comprador_buscar · valor_venda_pedido
// Output salvo em projetos_originacao.briefing_jsonb (estrutura V2 · 7 seções).
//
// POST body: { originacao_id?: uuid, projeto_id: uuid }
// Output: { ok, originacao_id, briefing, tokens_in, tokens_out, duracao_ms }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function resp(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function buildDadosNegocio(negocio: any): string {
  if (!negocio) return "(sem dados do negócio)";
  const partes: string[] = [];
  const push = (l: string, v: any) => { if (v != null && v !== "") partes.push(`${l}: ${v}`); };
  push("Nome", negocio.nome_negocio || negocio.nome);
  push("Setor", negocio.setor || negocio.categoria);
  push("Sub-categoria", negocio.subcategoria);
  push("Cidade", negocio.cidade);
  push("Estado", negocio.estado);
  push("Tipo de negócio", negocio.tipo_negocio);
  push("Tipo de venda", negocio.tipo_venda);
  push("Faturamento anual", negocio.faturamento_anual ?? negocio.fat_anual);
  push("EBITDA anual", negocio.ebitda_anual ?? negocio.ebitda);
  push("EBITDA mensal", negocio.ebitda_mensal);
  push("Margem EBITDA (%)", negocio.margem_ebitda);
  push("Margem bruta (%)", negocio.margem_bruta);
  push("Recorrência (%)", negocio.recorrencia_pct);
  push("Crescimento 12m fat (R$)", negocio.crescimento_fat_12m);
  push("Crescimento ritmo", negocio.crescimento_ritmo);
  push("Crescimento perspectiva", negocio.crescimento_perspectiva);
  push("Preço pedido", negocio.preco_pedido ?? negocio.valor_1n);
  push("Funcionários", negocio.funcionarios ?? negocio.num_funcionarios);
  push("Ano fundação", negocio.ano_fundacao);
  push("Anos existência", negocio.anos_existencia ?? negocio.tempo_operacao_anos);
  push("Descrição", negocio.descricao || negocio.descricao_geral);
  push("Diferenciais (laudo)", negocio.diferenciais || negocio.pontos_positivos);
  push("Concorrentes", negocio.concorrentes);
  push("Ameaças competitivas", negocio.ameacas_competitivas);
  push("Motivo venda", negocio.motivo_venda);
  push("Urgência", negocio.urgencia);
  push("Riscos (laudo)", negocio.riscos);
  push("Oportunidade dono", negocio.oportunidade_dono);
  push("Análise 1N", negocio.analise_1n);
  push("Tese (campo)", negocio.tese);
  push("ISE final", negocio.ise_final);
  push("Score saúde", negocio.score_saude);
  return partes.join("\n");
}

function buildLaudoBlock(laudo: any): string {
  if (!laudo) return "(sem laudo)";
  const calc = laudo.calc_json || {};
  if (!calc || Object.keys(calc).length === 0) return "(laudo sem calc_json)";
  // Resumo curto pra não inflar input
  const compactado: Record<string, any> = {};
  for (const k of Object.keys(calc)) {
    const v = calc[k];
    if (v == null) continue;
    if (typeof v === "object" && !Array.isArray(v)) {
      const sub: Record<string, any> = {};
      for (const sk of Object.keys(v).slice(0, 6)) sub[sk] = v[sk];
      compactado[k] = sub;
    } else {
      compactado[k] = v;
    }
  }
  return JSON.stringify(compactado, null, 2).slice(0, 3000);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return resp(405, { ok: false, erro: "metodo" });

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

  // Gate admin
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return resp(401, { ok: false, erro: "sem_jwt" });
  const { data: userData, error: userErr } = await adminClient.auth.getUser(jwt);
  if (userErr || !userData?.user) return resp(401, { ok: false, erro: "jwt_invalido" });
  const { data: admin } = await adminClient
    .from("admins").select("id, ativo")
    .eq("whatsapp", userData.user.phone).eq("ativo", true).maybeSingle();
  if (!admin) return resp(403, { ok: false, erro: "nao_admin" });

  let body: any;
  try { body = await req.json(); } catch { return resp(400, { ok: false, erro: "json_invalido" }); }
  const { originacao_id, projeto_id } = body;
  if (!projeto_id) return resp(400, { ok: false, erro: "projeto_id_obrigatorio" });

  // Busca/cria originacao
  let origRow: any;
  if (originacao_id) {
    const { data } = await adminClient.from("projetos_originacao").select("*").eq("id", originacao_id).maybeSingle();
    if (!data) return resp(404, { ok: false, erro: "originacao_nao_encontrada" });
    origRow = data;
  } else {
    // Busca último por projeto · senão cria
    const { data: existing } = await adminClient
      .from("projetos_originacao").select("*")
      .eq("projeto_id", projeto_id)
      .order("versao", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      origRow = existing;
    } else {
      const { data, error } = await adminClient.from("projetos_originacao")
        .insert({ projeto_id, versao: 1, status: "rascunho", fase_atual: "tese", gerado_por_admin_id: admin.id })
        .select().maybeSingle();
      if (error || !data) return resp(500, { ok: false, erro: "erro_criar_originacao", detalhe: error?.message });
      origRow = data;
    }
  }

  // Busca negocio + laudo
  const { data: pm } = await adminClient.from("projeto_metadata").select("negocio_id").eq("id", origRow.projeto_id).maybeSingle();
  if (!pm?.negocio_id) return resp(404, { ok: false, erro: "negocio_id_nao_encontrado" });
  const { data: negocio } = await adminClient.from("negocios").select("*").eq("id", pm.negocio_id).maybeSingle();
  if (!negocio) return resp(404, { ok: false, erro: "negocio_nao_encontrado" });
  const { data: laudo } = await adminClient
    .from("laudos_v2").select("calc_json")
    .eq("negocio_id", pm.negocio_id).eq("ativo", true)
    .order("versao", { ascending: false }).limit(1).maybeSingle();

  const dadosNegocio = buildDadosNegocio(negocio);
  const laudoBlock = buildLaudoBlock(laudo);

  const systemPrompt = `Você é analista de M&A da 1Negócio · plataforma brasileira de compra e venda de PMEs. Sua tarefa: extrair um BRIEFING ESTRUTURADO do negócio à venda · focado em identificar ARQUÉTIPOS DE COMPRADORES.

OBJETIVO ÚNICO: dar à IA da próxima etapa (geração de arquétipos) os inputs necessários pra identificar quem PODE COMPRAR este negócio · onde encontrar essas pessoas/empresas · e como abordá-las.

NÃO escreva tese narrativa. NÃO descreva momento de mercado abstrato. NÃO discuta motivo da venda (irrelevante pra achar comprador).

Retorne EXCLUSIVAMENTE um JSON com a estrutura abaixo. Use null ou string vazia quando não tiver info. Não invente dados.

VOCABULÁRIO CANÔNICO (use exatamente esses valores):

Setores (escolher 1):
servicos_empresas, varejo, saude, alimentacao, beleza_estetica, educacao, servicos_locais, bem_estar, industria, construcao, hospedagem, logistica

Modelos de operação (escolher 1+):
presta_servico, produz_revende, fabricacao, revenda, distribuicao, vende_governo, saas, assinatura

Alcance da operação (escolher 1):
local · regional · estadual · nacional · digital

Tipos de comprador a buscar (escolher 1+):
concorrente_direto · antes_cadeia · depois_cadeia · adjacente · clientes_atuais · investidor_financeiro

Alcance geográfico do comprador (escolher 1):
cidade · raio_30km · raio_100km · estado · regiao · brasil · internacional

ESTRUTURA OBRIGATÓRIA:

{
  "negocio": {
    "setor": "<setor canônico>",
    "sub_setor": "<nicho específico, ex: 'padaria artesanal' · 'SaaS contábil'>",
    "modelos_operacao": ["<1+ valores canônicos>"],
    "cidade": "<cidade>",
    "estado": "<UF>",
    "alcance_operacao": "<canônico>",
    "fonte_confianca": "alta|media|baixa"
  },
  "tamanho": {
    "faturamento_bruto_anual": <number ou null>,
    "resultado_operacional_anual": <number ou null>,
    "margem_operacional_pct": <number 0-100 ou null>,
    "tempo_operacao_anos": <number ou null>,
    "funcionarios": <number ou null>,
    "valor_venda_pedido": <number ou null>,
    "fonte_confianca": "alta|media|baixa"
  },
  "diferenciais_ativos": [
    "<bullet defensável · concreto · não comercial>",
    "<bullet 2>"
  ],
  "sinergia": {
    "indicadores_acima_media": [
      "<ex: 'Despesa administrativa representa 22% da receita · acima da média do setor (~12%)'>"
    ],
    "ganho_consolidador": "<1-2 frases sobre onde um consolidador ganharia>"
  },
  "tipos_comprador_buscar": ["<canônicos · 1-5 valores>"],
  "alcance_geografico_comprador": "<canônico>",
  "alcance_geografico_justificativa": "<por que esse raio · concreto>",
  "observacao": ""
}

REGRAS POR SEÇÃO:

NEGÓCIO:
- Setor: o canônico mais próximo. NUNCA invente setor fora da lista.
- Sub-setor: específico (ex: 'restaurante japonês' · 'SaaS contábil' · 'distribuidora de bebidas')
- Modelos de operação: pode marcar múltiplos se o negócio combina (ex: indústria que também distribui)

TAMANHO:
- faturamento_bruto_anual: do banco (campo fat_anual ou faturamento_anual)
- resultado_operacional_anual: do laudo (RO ajustado · não EBITDA). Se só tiver EBITDA · use o valor mesmo
- valor_venda_pedido: o preço da venda. ESSE define capacidade do comprador (não confundir com faturamento).

DIFERENCIAIS_ATIVOS (3-5 bullets):
- Concretos · defensáveis · o que esse negócio TEM que outros do setor NÃO têm
- BONS exemplos:
  * 'Contrato exclusivo com 3 fornecedores'
  * 'Base de 400 clientes recorrentes com churn < 5% ao mês'
  * 'Tecnologia proprietária X (registrada)'
  * 'Imóvel próprio em rua comercial premium · avaliação R$ 800k'
  * '18 anos de operação · marca conhecida no nicho'
- RUINS (não use): 'Bom atendimento' · 'Time qualificado' · 'Qualidade superior'

SINERGIA (campo crítico · análise quantitativa):

Compare os indicadores do laudo/dados com as MÉDIAS TÍPICAS do setor canônico abaixo. Para cada indicador que estiver 30% OU MAIS acima da média, gere bullet quantificado em 'indicadores_acima_media'.

BENCHMARKS POR SETOR (% sobre receita bruta · referência):

servicos_empresas: despesa_administrativa 10-12% · despesa_operacional 45-55% · despesa_comercial 12-18%
varejo: despesa_administrativa 5-7% · despesa_operacional 65-75% (CMV alto) · despesa_comercial 10-15%
saude: despesa_administrativa 10-14% · despesa_operacional 50-60% · despesa_comercial 6-10%
alimentacao: despesa_administrativa 6-10% · despesa_operacional 55-65% · despesa_comercial 8-12%
beleza_estetica: despesa_administrativa 8-12% · despesa_operacional 40-55% · despesa_comercial 10-15%
educacao: despesa_administrativa 12-18% · despesa_operacional 50-60% · despesa_comercial 8-12%
servicos_locais: despesa_administrativa 8-12% · despesa_operacional 50-60% · despesa_comercial 10-15%
bem_estar: despesa_administrativa 8-12% · despesa_operacional 45-55% · despesa_comercial 12-18%
industria: despesa_administrativa 6-10% · despesa_operacional 65-75% (CMV alto) · despesa_comercial 8-12%
construcao: despesa_administrativa 8-12% · despesa_operacional 65-75% · despesa_comercial 5-10%
hospedagem: despesa_administrativa 10-14% · despesa_operacional 45-55% · despesa_comercial 8-12%
logistica: despesa_administrativa 8-12% · despesa_operacional 65-75% (combustível · manutenção) · despesa_comercial 6-10%

REGRAS PARA OS BULLETS:

1. Só gera bullet se diferença for ≥30% acima da média do setor
2. Cada bullet deve QUANTIFICAR o ganho potencial em R$/ano:

   BOM: 'Despesa administrativa em 22% da receita · ~10pp acima da média do setor varejo (~6-7%) · potencial de redução estimado em R$ 280k/ano integrando estrutura administrativa de um consolidador'
   RUIM (não gera): 'Despesas administrativas elevadas'

3. Se TODOS os indicadores estiverem dentro das médias, deixe a lista indicadores_acima_media vazia · NÃO invente sinergia.

4. ganho_consolidador: 1-2 frases conectando os indicadores anômalos com o tipo de comprador que mais ganharia integrando.
   Exemplo: 'Margem comercial de 8% (média 12-15%) somada à estrutura administrativa inchada indica que um concorrente_direto com escala maior cortaria custo fixo e levaria margem operacional pra 18-22% no consolidado.'

5. Se o laudo não tiver breakdown de despesas (apenas faturamento e RO), compare RO/faturamento com margem operacional típica do setor:
   - servicos_empresas: 15-25% · varejo: 5-12% · saude: 12-20% · alimentacao: 8-15%
   - beleza_estetica: 18-28% · educacao: 10-20% · servicos_locais: 12-22% · bem_estar: 15-25%
   - industria: 8-15% · construcao: 5-12% · hospedagem: 12-22% · logistica: 6-12%
   Se RO está ABAIXO da média do setor mas faturamento é robusto, isso por si só é sinal de oportunidade pra consolidador.

TIPOS DE COMPRADOR (escolha 1+ a buscar):
- concorrente_direto: outra empresa no mesmo elo da cadeia · mesmo setor · busca consolidação
- antes_cadeia: quem está ANTES (fornecedor · fabricante · distribuidor) querendo descer pro varejo/serviço final
- depois_cadeia: quem está DEPOIS (cliente final · canal de revenda · varejo) querendo subir pra produção/distribuição
- adjacente: atende mesmo cliente com serviço/produto complementar
- clientes_atuais: cliente B2B que JÁ COMPRA do negócio · conhece a operação por dentro · pode comprar para integrar verticalmente (ex: rede de farmácias compra seu fornecedor de embalagens; restaurante compra padaria que já fornece)
- investidor_financeiro: PF ou family office sem operação · busca retorno

Pra negócio B2B com base de clientes recorrentes (fornecedor industrial · SaaS · prestador especializado) → SEMPRE considerar clientes_atuais.

Exemplos de raciocínio:
- padaria → adjacente (cafeteria) · depois_cadeia (distribuidor de panificação) · concorrente_direto (outras padarias)
- SaaS contábil → concorrente_direto · adjacente (sistema fiscal) · clientes_atuais (escritórios contábeis grandes)
- fornecedor industrial → clientes_atuais (montadoras grandes) · concorrente_direto · antes_cadeia

ALCANCE GEOGRÁFICO:
- Negócio físico local (padaria · clínica) → cidade ou raio_30km
- Indústria → estado ou regiao
- SaaS/digital → brasil ou internacional
- Distribuidora → regiao
- Franquia/rede → brasil

fonte_confianca: 'alta' se dados do laudo · 'media' se inferiu · 'baixa' se chutou

DADOS DO NEGÓCIO:
${dadosNegocio}

LAUDO (se disponível):
${laudoBlock}

Retorne APENAS o JSON.`;

  const inicio = Date.now();
  try {
    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 3000,
        system: systemPrompt,
        messages: [{ role: "user", content: "Gere o briefing agora · só JSON válido." }],
      }),
    });
    if (!claudeResp.ok) {
      const errTxt = await claudeResp.text();
      return resp(500, { ok: false, erro: "claude_api_falhou", detalhe: errTxt.slice(0, 500) });
    }
    const claudeData = await claudeResp.json();
    const textBlocks = (claudeData.content || []).filter((b: any) => b.type === "text");
    const fullText = textBlocks.map((b: any) => b.text).join("");

    let briefing: any;
    try {
      const clean = fullText.replace(/```json|```/g, "").trim();
      briefing = JSON.parse(clean);
    } catch (e: any) {
      return resp(500, { ok: false, erro: "json_parse_falhou", detalhe: fullText.slice(0, 500), erro_debug: e.message });
    }

    const usage = claudeData.usage || {};
    const duracao = Date.now() - inicio;

    const { error: errUpd } = await adminClient
      .from("projetos_originacao")
      .update({
        briefing_jsonb: briefing,
        briefing_gerado_em: new Date().toISOString(),
        briefing_versao: "v2_enxuto",
        // v9.32 · alcance_geografico agora vem de alcance_geografico_comprador
        alcance_geografico: briefing.alcance_geografico_comprador || briefing.alcance_geografico || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", origRow.id);
    if (errUpd) return resp(500, { ok: false, erro: "erro_update", detalhe: errUpd.message });

    return resp(200, {
      ok: true,
      originacao_id: origRow.id,
      briefing,
      tokens_in: usage.input_tokens || 0,
      tokens_out: usage.output_tokens || 0,
      duracao_ms: duracao,
    });
  } catch (e: any) {
    return resp(500, { ok: false, erro: "exception", detalhe: e.message });
  }
});
