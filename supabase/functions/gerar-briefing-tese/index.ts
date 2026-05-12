// gerar-briefing-tese · v9.31
// Pré-preenche briefing estruturado do negócio a partir de negocios + laudos_v2 + diagnosticos.
// Output salvo em projetos_originacao.briefing_jsonb (estrutura 8 seções).
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

  const systemPrompt = `Você é consultor sênior em M&A. Sua tarefa: extrair um BRIEFING ESTRUTURADO do negócio à venda, usando todos os dados disponíveis (laudo · diagnóstico · campos do banco).

Retorne EXCLUSIVAMENTE um JSON com a estrutura abaixo. Não escreva texto fora do JSON. Não invente dados que não foram fornecidos · use null ou string vazia quando não tiver info.

ESTRUTURA OBRIGATÓRIA:

{
  "identidade": {
    "nome": "<nome do negócio>",
    "setor": "<setor amplo>",
    "sub_setor": "<sub-setor específico se identificável>",
    "cidade": "<cidade>",
    "estado": "<UF>",
    "tempo_operacao_anos": <number ou null>,
    "funcionarios": <number ou null>,
    "fonte_confianca": "alta|media|baixa"
  },
  "economics": {
    "faturamento_anual": <number ou null>,
    "ebitda_mensal": <number ou null>,
    "margem_percentual": <number 0-100 ou null>,
    "crescimento_3a_percentual": <number ou null>,
    "recorrencia": "alta|media|baixa",
    "fonte_confianca": "alta|media|baixa"
  },
  "diferenciais": ["<bullet 1>", "<bullet 2>", "<bullet 3>"],
  "riscos": ["<risco 1>", "<risco 2>"],
  "momento_mercado": "<2-3 frases sobre por que AGORA é momento favorável>",
  "motivo_venda": "<aposentadoria|sucessao|cash_out|conflito_socios|pivo|saude|outro>",
  "motivo_venda_obs": "<string opcional explicando>",
  "alcance_geografico": "<cidade|raio_30km|raio_100km|estado|regiao|brasil|internacional>",
  "alcance_geografico_justificativa": "<por que esse raio · concreto>",
  "observacoes_livres": ""
}

REGRAS:
- diferenciais: 3-5 bullets · cada um defensável (não 'temos bom atendimento')
- riscos: 2-3 bullets · honestos (mercado · operacional · sucessão · etc)
- momento_mercado: deve ter ângulo concreto (Reforma Tributária · consolidação setorial · escassez de oferta · etc)
- motivo_venda: infere se possível · senão usa 'outro' e explica em obs
- alcance_geografico: pensa no tipo de comprador que faz sentido
  · negócio físico local → cidade ou raio_30km
  · SaaS/digital → brasil ou internacional
  · indústria → estado ou regiao
  · franquia/rede → regiao ou brasil
- fonte_confianca: 'alta' se dados vieram do laudo · 'media' se inferiu · 'baixa' se chutou

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
        alcance_geografico: briefing.alcance_geografico || null,
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
