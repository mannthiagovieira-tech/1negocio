// Edge Function: cowork-gerar-plano-diario
// Roda todo dia 5h BRT (8h UTC) via Vercel Cron.
// Coleta sinais do dia (leads quentes · solicitações pendentes · anúncios prontos)
// e gera plano estruturado via Claude Sonnet 4. Salva em cowork_planos_diarios + cowork_tarefas.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const ZAPI_INSTANCE = Deno.env.get("ZAPI_INSTANCE") ?? "";
const ZAPI_TOKEN = Deno.env.get("ZAPI_TOKEN") ?? "";
const ZAPI_CLIENT_TOKEN = Deno.env.get("ZAPI_CLIENT_TOKEN") ?? "";
const ADMIN_WHATSAPP = Deno.env.get("ADMIN_WHATSAPP") ?? ""; // ex: 5548999999999 · opcional

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = `Você é o Cowork da 1Negócio · plataforma colaborativa de compra e venda de empresas.

Sua missão é gerar o PLANO DIÁRIO do CEO/admin todos os dias às 5h. O plano organiza
o dia em uma rolagem só · prioriza o que importa · sem M&A · sem jargão.

GLOSSÁRIO VETADO (use linguagem do povo):
- M&A → "compra e venda de empresas"
- Valuation → "avaliação financeira"
- EBITDA → "lucro real da operação"
- Benchmark → "comparativo com mercado"
- ROI → "retorno do investimento"
- Deal → "negócio"

DISTINÇÃO CRÍTICA · Sócio vs Parceiro:
- SÓCIO institucional · plano trienal R$ 5.346 · auto-serviço portal · comissão 40%
- PARCEIRO pontual · vinculação manual via WhatsApp · sem plano

OUTPUT: APENAS JSON válido (sem markdown, sem backticks):
{
  "contexto": { "data_iso": "YYYY-MM-DD", "dia_semana": "string", "resumo": "1-2 frases sobre o dia" },
  "prioridades": [
    { "categoria": "atendimento|vendas|operacao|conteudo|estrutural", "titulo": "...", "descricao": "...", "link_acao": "/painel-v3.html#..." }
  ],
  "performance_negocio": { "fluxo_caixa_resumo": "...", "alertas_financeiros": ["..."] },
  "estrutural": [ "tarefa estrutural 1", "tarefa estrutural 2" ],
  "alertas": [ "alerta crítico" ],
  "proximos_dias": { "amanha": "foco de amanhã", "depois_amanha": "..." }
}

PRIORIDADES · 5-8 itens · ordenados por importância · cada uma com link_acao apontando pra
seção do painel-v3 (ex: /painel-v3.html#pa-solicitacoes).`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const hoje = new Date();
    const dataISO = hoje.toISOString().slice(0, 10);

    // Verifica se já existe plano pra hoje · respeita idempotência (re-run sobrescreve só se forçado)
    const body = await req.json().catch(() => ({}));
    const forceRegenerate = body?.force === true;
    const { data: existente } = await supabase
      .from("cowork_planos_diarios")
      .select("id, gerado_em")
      .eq("data", dataISO)
      .maybeSingle();
    if (existente && !forceRegenerate) {
      return jsonOk({ ok: true, ja_existia: true, plano_id: existente.id });
    }

    // 1. Coleta sinais do dia (queries paralelas)
    const ontemISO = new Date(hoje.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const [solR, anuR, leadsR, prazosR] = await Promise.allSettled([
      supabase.from("solicitacoes_info").select("id,status,created_at,negocio_id,comprador_id").eq("status", "aguardando").limit(50),
      supabase.from("anuncios_v2").select("id,negocio_id,status,titulo,publicado_em,criado_em").in("status", ["rascunho", "aguardando_aprovacao"]).limit(50),
      supabase.from("leads_google").select("id,nome,origem,classificacao_ia,created_at").gte("created_at", ontemISO).limit(100),
      supabase.from("nda_solicitacoes").select("id,solicitacao_info_id,expira_em,status").eq("status", "pendente").limit(50),
    ]);
    const v = (r: PromiseSettledResult<any>) => (r.status === "fulfilled" ? r.value.data || [] : []);
    const solicitacoes = v(solR);
    const anuncios = v(anuR);
    const leadsRecentes = v(leadsR);
    const ndaPendentes = v(prazosR);

    // 2. Monta contexto de input pro Claude
    const inputContext = {
      data: dataISO,
      dia_semana: hoje.toLocaleDateString("pt-BR", { weekday: "long" }),
      sinais: {
        solicitacoes_aguardando: solicitacoes.length,
        anuncios_em_rascunho: anuncios.length,
        leads_capturados_24h: leadsRecentes.length,
        leads_classificados_quentes: leadsRecentes.filter((l: any) => ["negocio_funcionamento", "ambiguo", "concorrente"].includes(l.classificacao_ia || "")).length,
        nda_pendentes: ndaPendentes.length,
      },
      amostras: {
        solicitacoes_recentes: solicitacoes.slice(0, 5),
        anuncios_em_rascunho: anuncios.slice(0, 5),
      },
    };

    // 3. Chama Claude
    const userPrompt = `Gere o plano diário pra hoje (${dataISO}) com base nesses sinais:

${JSON.stringify(inputContext, null, 2)}

Devolva APENAS o JSON especificado no system prompt.`;

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    if (!claudeRes.ok) throw new Error(`Anthropic ${claudeRes.status}: ${await claudeRes.text()}`);
    const claudeData = await claudeRes.json();
    const rawText = claudeData.content?.[0]?.text || "";
    const tokensUsados = (claudeData.usage?.input_tokens || 0) + (claudeData.usage?.output_tokens || 0);

    // 4. Parse JSON
    let parsed: any;
    try {
      const clean = rawText.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      throw new Error(`Anthropic retornou JSON inválido: ${rawText.slice(0, 300)}`);
    }

    // 5. Salva ou atualiza plano + tarefas
    const planoPayload = {
      data: dataISO,
      contexto: parsed.contexto || null,
      prioridades: parsed.prioridades || [],
      performance_negocio: parsed.performance_negocio || null,
      estrutural: parsed.estrutural || [],
      alertas: parsed.alertas || [],
      proximos_dias: parsed.proximos_dias || null,
      texto_completo: rawText,
      gerado_em: new Date().toISOString(),
      tokens_usados: tokensUsados,
    };

    let planoId: string | null = null;
    if (existente) {
      const { data: upd } = await supabase
        .from("cowork_planos_diarios")
        .update(planoPayload)
        .eq("id", existente.id)
        .select("id")
        .single();
      planoId = upd?.id || existente.id;
      // Limpa tarefas antigas pra reescrever
      await supabase.from("cowork_tarefas").delete().eq("plano_id", planoId);
    } else {
      const { data: ins, error: insErr } = await supabase
        .from("cowork_planos_diarios")
        .insert(planoPayload)
        .select("id")
        .single();
      if (insErr) throw new Error("INSERT falhou: " + insErr.message);
      planoId = ins?.id;
    }

    // 6. Insere tarefas (uma por prioridade)
    if (planoId && Array.isArray(parsed.prioridades)) {
      const tarefas = parsed.prioridades.map((p: any, idx: number) => ({
        plano_id: planoId,
        categoria: p.categoria || "geral",
        titulo: p.titulo || "(sem título)",
        descricao: p.descricao || "",
        link_acao: p.link_acao || null,
        ordem: idx,
      }));
      if (tarefas.length) await supabase.from("cowork_tarefas").insert(tarefas);
    }

    // 7. Notifica admin via WhatsApp (opcional · só se ADMIN_WHATSAPP estiver setado)
    let zapiSent = false;
    if (ADMIN_WHATSAPP && ZAPI_INSTANCE && ZAPI_TOKEN) {
      try {
        // Coleta sinais extras pra enriquecer a mensagem
        const [hot, anuW, anuPub] = await Promise.allSettled([
          supabase.from("leads_google").select("id", { count: "exact", head: true }).eq("classificacao_ia", "negocio_funcionamento").gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
          supabase.from("anuncios_v2").select("id", { count: "exact", head: true }).in("status", ["aguardando_aprovacao", "rascunho"]),
          supabase.from("anuncios_v2").select("valor_pedido").eq("status", "publicado"),
        ]);
        const cQuentes = (hot as any).value?.count ?? 0;
        const cAprov = (anuW as any).value?.count ?? 0;
        const pubData = (anuPub as any).value?.data || [];
        const pipelinePot = pubData.reduce((s: number, a: any) => s + (Number(a.valor_pedido) || 0), 0);
        const fmtBRL = (v: number) => v >= 1e6 ? (v / 1e6).toFixed(1).replace(".", ",") + "M" : v >= 1e3 ? Math.round(v / 1e3) + "k" : String(Math.round(v));

        const ctx = parsed.contexto || {};
        const prior = (parsed.prioridades || []).slice(0, 3);
        const dataPt = new Date(dataISO + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

        const linhasPrior = prior.map((p: any, i: number) => `${i + 1}. ${(p.titulo || "").slice(0, 80)}`).join("\n");

        const msg = [
          `🌅 Plano de hoje · ${dataPt}`,
          ``,
          ctx.resumo ? ctx.resumo.slice(0, 200) : "",
          ``,
          prior.length ? `🎯 PRIORIDADES (top ${prior.length} de ${(parsed.prioridades || []).length}):` : "🎯 sem prioridades hoje",
          linhasPrior,
          ``,
          `⚡ ${cQuentes} leads OLX quentes (7d)`,
          `📅 ${cAprov} anúncios pra aprovar`,
          `💰 Pipeline publicado: R$ ${fmtBRL(pipelinePot)}`,
          ``,
          `Abra o plano: https://1negocio.com.br/painel-v3.html#cockpit`,
        ].filter(Boolean).join("\n");

        const zapiUrl = `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`;
        const zapiHeaders: Record<string, string> = { "Content-Type": "application/json" };
        if (ZAPI_CLIENT_TOKEN) zapiHeaders["Client-Token"] = ZAPI_CLIENT_TOKEN;
        const zapiRes = await fetch(zapiUrl, {
          method: "POST",
          headers: zapiHeaders,
          body: JSON.stringify({ phone: ADMIN_WHATSAPP, message: msg }),
        });
        zapiSent = zapiRes.ok;
        if (zapiSent) await supabase.from("cowork_planos_diarios").update({ enviado_whatsapp: true }).eq("id", planoId);
        else console.warn("[zapi] não-ok:", zapiRes.status, await zapiRes.text().catch(() => ""));
      } catch (e) { console.warn("[zapi] falha silenciosa:", e); }
    }

    return jsonOk({ ok: true, plano_id: planoId, ja_existia: !!existente, tokens_usados: tokensUsados, zapi_enviado: zapiSent });
  } catch (e) {
    console.error("[cowork-gerar-plano-diario] erro:", e);
    return jsonErr(String((e as Error)?.message || e), 500);
  }
});

function jsonOk(payload: unknown) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function jsonErr(erro: string, status = 400) {
  return new Response(JSON.stringify({ ok: false, erro }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
