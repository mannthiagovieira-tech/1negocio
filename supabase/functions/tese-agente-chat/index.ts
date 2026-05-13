// tese-agente-chat · v9.34.3 · Sprint 4 · Motor V3
// Chat conversacional · agente sênior M&A · constrói tese iterativamente.
// Salva histórico em projetos_originacao.tese_chat_historico (jsonb array).
// Quando agente detecta TESE_COMPLETA: extrai JSON dos 5 componentes · marca tese_jsonb.
//
// POST body: { originacao_id: uuid, mensagem?: string, reiniciar?: boolean }
// Output: { ok, resposta, tese_completa, tese_proposta?, historico, custo_brl }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const MAX_TOKENS = 1500;
const CUSTO_POR_TURNO_BRL = 0.04;

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

function resumirBriefing(briefing: any): string {
  if (!briefing) return "(briefing não preenchido)";
  const n = briefing.negocio || {};
  const t = briefing.tamanho || {};
  const s = briefing.sinergia || {};
  const partes: string[] = [];
  if (n.setor) partes.push(`Setor: ${n.setor}${n.sub_setor ? " / " + n.sub_setor : ""}`);
  if (n.cidade) partes.push(`Cidade: ${n.cidade}${n.estado ? "/" + n.estado : ""}`);
  if (t.faturamento_bruto_anual) partes.push(`Faturamento anual: R$ ${t.faturamento_bruto_anual}`);
  if (t.margem_operacional_pct != null) partes.push(`Margem operacional: ${t.margem_operacional_pct}%`);
  if (t.valor_venda_pedido) partes.push(`Valor venda pedido: R$ ${t.valor_venda_pedido}`);
  if (Array.isArray(briefing.diferenciais_ativos) && briefing.diferenciais_ativos.length > 0) {
    partes.push(`Diferenciais: ${briefing.diferenciais_ativos.slice(0, 3).map((d: any) => typeof d === "string" ? d : d?.texto || "").filter(Boolean).join(" · ")}`);
  }
  if (s.ganho_consolidador) partes.push(`Sinergia: ${s.ganho_consolidador}`);
  if (Array.isArray(briefing.tipos_comprador_buscar) && briefing.tipos_comprador_buscar.length > 0) {
    partes.push(`Tipos comprador alvo: ${briefing.tipos_comprador_buscar.join(", ")}`);
  }
  if (briefing.alcance_geografico_comprador) partes.push(`Alcance: ${briefing.alcance_geografico_comprador}`);
  return partes.join("\n");
}

function montarSystemPrompt(briefing: any, teseAtual: any): string {
  const briefingResumido = resumirBriefing(briefing);
  const teseAtualStr = teseAtual && Object.keys(teseAtual).length > 0
    ? `\nTESE ATUAL (rascunho versão ${teseAtual?._versao || 1}):\n${JSON.stringify(teseAtual, null, 2)}`
    : "";

  return `Você é um analista sênior de M&A especializado em pequenas e médias empresas brasileiras.
Seu trabalho é ajudar o consultor a construir uma TESE DE INVESTIMENTO sólida para este negócio.

DADOS DO NEGÓCIO (já disponíveis):
${briefingResumido}
${teseAtualStr}

REGRAS DE INTERAÇÃO:
1. Faça UMA pergunta de cada vez · curta e específica
2. Use os dados que já tem · NÃO peça o que já sabe
3. Seja direto e factual · NÃO seja vendedor
4. Tom: relatório de due diligence · não pitch comercial
5. Português brasileiro · respeitoso · primeira pessoa
6. NÃO use emojis · NÃO use "claro" / "perfeito" / "ótimo" no início de respostas

OS 5 COMPONENTES DA TESE:
1. diferencial_competitivo · O que faz este negócio único? Defensibilidade.
2. dependencia_dono · A operação funciona sem o dono? Por quanto tempo?
3. perfil_comprador_ideal · Quem se beneficiaria mais? Razão racional · não emocional.
4. riscos_principais · 2-3 riscos relevantes que comprador vai questionar.
5. justificativa_preco · Por que o valor pedido faz sentido? Múltiplos · benchmarks.

QUANDO TIVER INFO SUFICIENTE PROS 5 COMPONENTES:
Proponha a tese completa em formato natural · depois inclua bloco com este formato EXATO no final:

TESE_COMPLETA:
\`\`\`json
{
  "diferencial_competitivo": "...",
  "dependencia_dono": "...",
  "perfil_comprador_ideal": "...",
  "riscos_principais": ["...", "...", "..."],
  "justificativa_preco": "..."
}
\`\`\`

Antes disso · só faça perguntas e construa entendimento. Não force a tese.`;
}

function extrairTeseCompleta(texto: string): any | null {
  const marcador = texto.indexOf("TESE_COMPLETA:");
  if (marcador === -1) return null;
  const depois = texto.slice(marcador);
  // Tenta extrair bloco ```json ... ```
  const m1 = depois.match(/```json\s*([\s\S]*?)\s*```/);
  if (m1) {
    try { return JSON.parse(m1[1]); } catch {}
  }
  // Fallback · busca primeiro { ... }
  const m2 = depois.match(/\{[\s\S]*\}/);
  if (m2) {
    try { return JSON.parse(m2[0]); } catch {}
  }
  return null;
}

function limparTextoTese(texto: string): string {
  // Remove o bloco TESE_COMPLETA: do texto exibido (mantém só a parte conversacional + bloco JSON formatado)
  return texto;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return resp(405, { ok: false, erro: "metodo" });

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

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
  const { originacao_id, mensagem, reiniciar } = body || {};
  if (!originacao_id) return resp(400, { ok: false, erro: "originacao_id_obrigatorio" });

  try {
    const { data: orig } = await adminClient
      .from("projetos_originacao")
      .select("id, briefing_jsonb, tese_jsonb, tese_versao, tese_chat_historico, gasto_anthropic_mes")
      .eq("id", originacao_id).maybeSingle();
    if (!orig) return resp(404, { ok: false, erro: "originacao_nao_encontrada" });
    if (!orig.briefing_jsonb) return resp(400, { ok: false, erro: "briefing_obrigatorio_antes_da_tese" });

    let historico: any[] = Array.isArray(orig.tese_chat_historico) ? orig.tese_chat_historico : [];
    if (reiniciar) historico = [];

    // Adiciona mensagem do user (se houver) · senão é abertura
    if (mensagem && typeof mensagem === "string" && mensagem.trim()) {
      historico.push({ role: "user", content: mensagem.trim(), ts: new Date().toISOString() });
    }

    // Pega últimas 20 mensagens pra contexto (controle de tokens)
    const ultimas = historico.slice(-20).map((m) => ({ role: m.role, content: m.content }));
    // Se ainda não tem nada no histórico (1ª chamada) · força user "vamos começar"
    const messagesParaApi = ultimas.length > 0 ? ultimas : [{ role: "user", content: "Vamos começar. Analise os dados que tem e me pergunte o que precisa pra construir a tese." }];

    const systemPrompt = montarSystemPrompt(orig.briefing_jsonb, orig.tese_jsonb);

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: messagesParaApi,
      }),
    });
    if (!claudeResp.ok) {
      const errTxt = await claudeResp.text();
      return resp(500, { ok: false, erro: `claude_status_${claudeResp.status}`, detalhe: errTxt.slice(0, 300) });
    }
    const claudeData = await claudeResp.json();
    const textBlocks = (claudeData.content || []).filter((b: any) => b.type === "text");
    const respostaAgente = textBlocks.map((b: any) => b.text).join("\n");

    // Adiciona resposta do agente ao histórico
    historico.push({ role: "assistant", content: respostaAgente, ts: new Date().toISOString() });

    // Detecta se agente propôs tese completa
    const tesePropostaJson = extrairTeseCompleta(respostaAgente);
    const teseCompleta = !!tesePropostaJson;

    // Atualiza histórico + gasto (não salva tese_jsonb ainda · só com botão "Salvar tese")
    await adminClient
      .from("projetos_originacao")
      .update({
        tese_chat_historico: historico,
        gasto_anthropic_mes: Number(orig.gasto_anthropic_mes || 0) + CUSTO_POR_TURNO_BRL,
        updated_at: new Date().toISOString(),
      })
      .eq("id", originacao_id);

    return resp(200, {
      ok: true,
      resposta: limparTextoTese(respostaAgente),
      tese_completa: teseCompleta,
      tese_proposta: tesePropostaJson || null,
      historico_count: historico.length,
      historico,
      custo_brl: CUSTO_POR_TURNO_BRL,
      tokens_in: claudeData?.usage?.input_tokens ?? 0,
      tokens_out: claudeData?.usage?.output_tokens ?? 0,
    });
  } catch (e: any) {
    console.error("[tese-agente-chat] exception raiz", e);
    return resp(500, { ok: false, erro: "exception_raiz", erro_debug: e?.message, stack: e?.stack?.slice(0, 1000) });
  }
});
