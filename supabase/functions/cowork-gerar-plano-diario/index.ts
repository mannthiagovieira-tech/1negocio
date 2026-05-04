// Edge Function: cowork-gerar-plano-diario
// v2 · ORIENTADO A EXECUÇÃO (não estratégia)
//
// Roda todo dia 5h BRT (8h UTC) via GitHub Actions cron.
// Coleta leads classificados · pré-monta mensagens template · salva plano.
// Estrutura nova: leads_pra_abordar · corretores_pra_abordar · perfis_ig_seguir
// + alertas_operacionais + stats_rapido + saudacao + contexto_curto.
//
// Anthropic é chamado APENAS pra: saudacao + contexto_curto + alertas_operacionais.
// Listas de leads/corretores/perfis vêm de queries SQL diretas (sem IA).
// Mensagens template são geradas determinísticamente por categoria/setor.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const ZAPI_INSTANCE = Deno.env.get("ZAPI_INSTANCE") ?? "";
const ZAPI_TOKEN = Deno.env.get("ZAPI_TOKEN") ?? "";
const ZAPI_CLIENT_TOKEN = Deno.env.get("ZAPI_CLIENT_TOKEN") ?? "";
const ADMIN_WHATSAPP = Deno.env.get("ADMIN_WHATSAPP") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LIMITE_LEADS_OLX = 30;
const LIMITE_CORRETORES = 10;
const LIMITE_PERFIS_IG = 5;

// ── helpers ──
function fmtBRL(v: number): string {
  v = Math.round(v || 0);
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1).replace(".", ",") + "M";
  if (Math.abs(v) >= 1e3) return Math.round(v / 1e3) + "k";
  return v.toLocaleString("pt-BR");
}

function tplMsgOlx(lead: any): string {
  const cidade = lead.cidade || "sua cidade";
  const setor = (lead.categoria || "").replace(/_/g, " ");
  const apelido = lead.nome ? lead.nome.split(/[·\n]/)[0].trim().slice(0, 40) : "seu negócio";
  const linhas = [
    `Olá! Vi seu anúncio "${apelido}" no OLX em ${cidade}.`,
    ``,
    `Sou da 1Negócio, plataforma de compra e venda de empresas. Você sabe quanto seu negócio realmente vale no mercado? Posso te mostrar uma avaliação técnica gratuita em 5 min.`,
    ``,
    `Quer ver?`,
  ];
  return linhas.join("\n");
}
function tplMsgCorretor(c: any): string {
  const cidade = c.cidade || "sua cidade";
  const linhas = [
    `Oi! Vi que você atua com pontos comerciais em ${cidade}.`,
    ``,
    `Sou da 1Negócio · plataforma de compra e venda de empresas inteiras (não só ponto). Tenho rede de empresários querendo vender, e parceiros como você ganham 40% da comissão (R$ 30k a 100k por venda fechada).`,
    ``,
    `Topa entender em 10 min como funciona?`,
  ];
  return linhas.join("\n");
}
function tplMsgPerfilIg(p: any): string {
  const nome = (p.nome || "").trim().split(/\s+/)[0] || "tudo bem";
  return `Olá ${nome}! Te encontrei no Instagram · vi sua bio. Sou da 1Negócio, plataforma de compra e venda de empresas. Tem 1 minuto pra eu te mostrar como avaliamos negócios?`;
}

function buildWaLink(phone: string, msg: string): string {
  const d = String(phone || "").replace(/\D/g, "");
  if (!d || d.length < 10) return "";
  const ddi = d.startsWith("55") ? d : "55" + d;
  return `https://wa.me/${ddi}?text=${encodeURIComponent(msg)}`;
}

// System prompt enxuto · só pra contexto + alertas (não pra listas)
const SYSTEM_PROMPT = `Você é o Cowork da 1Negócio · plataforma colaborativa de compra e venda de empresas.

Sua missão é gerar 3 elementos do plano diário do admin (Thiago) · ORIENTADO A EXECUÇÃO:
1. saudacao · "Bom dia, Thiago" + variação leve por dia da semana (1 frase)
2. contexto_curto · 1 LINHA dura com números reais (ex: "1.035 leads OLX classificados · 285 quentes pendentes de abordagem")
3. alertas_operacionais · 0-3 alertas CRÍTICOS (não estratégicos) que afetam execução do dia

REGRAS:
- Sem M&A, valuation, EBITDA, benchmark, ROI, deal, churn (linguagem leiga)
- Sem distinção Sócio/Parceiro confundida (Sócio R$5.346 trienal · Parceiro pontual)
- Foco em EXECUÇÃO (não estratégia) · Thiago já tem leads na mão na lista principal
- Alertas só pra coisas críticas: "0 leads novos site 24h" / "anúncios em rascunho > 7 dias"
- NÃO sugira tarefas vagas tipo "investigar" ou "otimizar"

OUTPUT · APENAS JSON (sem markdown):
{
  "saudacao": "string",
  "contexto_curto": "1 linha · ex: '1.035 leads OLX classificados · 285 quentes pendentes'",
  "alertas_operacionais": [{ "tipo": "critico|atencao|info", "mensagem": "..." }]
}`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const hoje = new Date();
    const dataISO = hoje.toISOString().slice(0, 10);

    const body = await req.json().catch(() => ({}));
    const forceRegenerate = body?.force === true;
    const { data: existente } = await supabase
      .from("cowork_planos_diarios").select("id, gerado_em").eq("data", dataISO).maybeSingle();
    if (existente && !forceRegenerate) {
      return jsonOk({ ok: true, ja_existia: true, plano_id: existente.id });
    }

    // ──────────────────────────────────────────────────────────
    // 1. Coleta candidatos · queries paralelas
    // ──────────────────────────────────────────────────────────
    const seteDiasAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const ontemISO = new Date(hoje.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const [olxR, corretR, igR, anuRascR, leadsHojeR, anuPubR] = await Promise.allSettled([
      // leads OLX classificados como negócio em funcionamento · não abordados (abordado_em IS NULL) · não pulados (revisar_depois=false)
      supabase.from("leads_google")
        .select("id,nome,telefone,cidade,categoria,setor,classificacao_ia,notas,bio,url_anuncio,valor_anuncio,data_publicacao,created_at")
        .eq("origem", "olx")
        .eq("classificacao_ia", "negocio_funcionamento")
        .is("abordado_em", null)
        .or("revisar_depois.is.null,revisar_depois.eq.false")
        .order("created_at", { ascending: false })
        .limit(LIMITE_LEADS_OLX),
      // corretores · gmaps_corretores · últimos 7 dias · não abordados
      supabase.from("leads_google")
        .select("id,nome,telefone,cidade,categoria,classificacao_ia,notas,url_anuncio,created_at")
        .eq("origem", "gmaps_corretores")
        .is("abordado_em", null)
        .gte("created_at", seteDiasAtras)
        .order("created_at", { ascending: false })
        .limit(LIMITE_CORRETORES),
      // perfis IG distribuídos hoje (já filtrados como empreendedor)
      supabase.from("ig_seguidores_raw")
        .select("id,username,nome,bio,external_url,classificacao_ia,distribuido_em,criado_em")
        .eq("distribuido_em", dataISO)
        .order("criado_em", { ascending: false })
        .limit(LIMITE_PERFIS_IG),
      // anúncios em rascunho/aguardando_aprovacao · pra alerta
      supabase.from("anuncios_v2").select("id", { count: "exact", head: true })
        .in("status", ["rascunho", "aguardando_aprovacao"]),
      // leads novos no site últimas 24h
      supabase.from("leads_site").select("id", { count: "exact", head: true })
        .gte("created_at", ontemISO),
      // pipeline publicado
      supabase.from("anuncios_v2").select("valor_pedido").eq("status", "publicado"),
    ]);

    const v = (r: PromiseSettledResult<any>) => (r.status === "fulfilled" ? r.value : null);
    const leadsOlx = (v(olxR)?.data || []) as any[];
    const corretores = (v(corretR)?.data || []) as any[];
    const perfisIg = (v(igR)?.data || []) as any[];
    const anuRasc = v(anuRascR)?.count ?? 0;
    const leadsHoje = v(leadsHojeR)?.count ?? 0;
    const pubData = v(anuPubR)?.data || [];
    const pipelinePot = pubData.reduce((s: number, a: any) => s + (Number(a.valor_pedido) || 0), 0);

    // Stats rápido pra preencher contexto + ui
    const { count: totalOlxClass } = await supabase
      .from("leads_google").select("id", { count: "exact", head: true })
      .eq("origem", "olx").not("classificacao_ia", "is", null);
    const { count: olxQuentesPend } = await supabase
      .from("leads_google").select("id", { count: "exact", head: true })
      .eq("origem", "olx").eq("classificacao_ia", "negocio_funcionamento").is("abordado_em", null);

    // ──────────────────────────────────────────────────────────
    // 2. Monta listas com mensagens template
    // ──────────────────────────────────────────────────────────
    const leads_pra_abordar = leadsOlx.map(l => {
      const msg = tplMsgOlx(l);
      return {
        id: l.id,
        origem: "olx",
        categoria: l.classificacao_ia,
        nome_anuncio: (l.nome || "").trim(),
        cidade: l.cidade || "",
        setor: l.setor || l.categoria || "",
        telefone: l.telefone || "",
        valor_anuncio: l.valor_anuncio ?? null,
        url_anuncio: l.url_anuncio || null,
        data_publicacao: l.data_publicacao || l.created_at || null,
        motivo_classificacao: (l.notas || "").replace(/^\[IA\]\s*/, "").slice(0, 200),
        mensagem_template: msg,
        link_whatsapp: l.telefone ? buildWaLink(l.telefone, msg) : null,
        ultima_abordagem: null,
      };
    });

    const corretores_pra_abordar = corretores.map(c => {
      const msg = tplMsgCorretor(c);
      return {
        id: c.id,
        origem: "gmaps_corretores",
        nome: c.nome || "",
        cidade: c.cidade || "",
        telefone: c.telefone || "",
        mensagem_template: msg,
        link_whatsapp: c.telefone ? buildWaLink(c.telefone, msg) : null,
      };
    });

    const perfis_ig_seguir = perfisIg.map(p => {
      const msg = tplMsgPerfilIg(p);
      return {
        id: p.id,
        username: p.username || "",
        nome: p.nome || "",
        bio: (p.bio || "").slice(0, 200),
        motivo: p.classificacao_ia || "distribuido",
        link_perfil: p.username ? `https://instagram.com/${p.username}` : null,
        mensagem_template: msg,
      };
    });

    // ──────────────────────────────────────────────────────────
    // 3. Anthropic · só pra saudação + contexto + alertas
    // ──────────────────────────────────────────────────────────
    const inputContext = {
      data: dataISO,
      dia_semana: hoje.toLocaleDateString("pt-BR", { weekday: "long" }),
      stats: {
        olx_total_classificados: totalOlxClass || 0,
        olx_quentes_pendentes: olxQuentesPend || 0,
        leads_pra_abordar_hoje: leads_pra_abordar.length,
        corretores_pra_abordar: corretores_pra_abordar.length,
        perfis_ig_pra_seguir: perfis_ig_seguir.length,
        anuncios_em_rascunho: anuRasc,
        leads_site_24h: leadsHoje,
        pipeline_publicado: pipelinePot,
      },
    };

    let parsed: any = { saudacao: "Bom dia, Thiago", contexto_curto: "", alertas_operacionais: [] };
    let tokensUsados = 0;
    try {
      const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 600,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: `Stats do dia:\n\n${JSON.stringify(inputContext, null, 2)}\n\nDevolva APENAS o JSON.` }],
        }),
      });
      if (claudeRes.ok) {
        const data = await claudeRes.json();
        const raw = (data.content?.[0]?.text || "").replace(/```json|```/g, "").trim();
        try { parsed = JSON.parse(raw); } catch { /* keep default */ }
        tokensUsados = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);
      }
    } catch (e) { console.warn("[anthropic] falha · usando defaults:", e); }

    // ──────────────────────────────────────────────────────────
    // 4. Monta payload final do plano
    // ──────────────────────────────────────────────────────────
    const stats_rapido = {
      anuncios_rascunho: anuRasc,
      leads_24h_site: leadsHoje,
      leads_olx_quentes_pendentes: olxQuentesPend || 0,
      pipeline_potencial: pipelinePot,
    };

    const planoPayload = {
      data: dataISO,
      // schema antigo · mantém pra compatibilidade
      contexto: { data_iso: dataISO, dia_semana: inputContext.dia_semana, resumo: parsed.contexto_curto || "" },
      prioridades: [], // deprecado · agora vive em leads_pra_abordar (estrutura nova)
      performance_negocio: { fluxo_caixa_resumo: "", alertas_financeiros: [] },
      estrutural: [],
      alertas: (parsed.alertas_operacionais || []).map((a: any) => a.mensagem || String(a)),
      proximos_dias: null,
      texto_completo: JSON.stringify({
        // schema NOVO · v2 orientado a execução
        saudacao: parsed.saudacao || "Bom dia, Thiago",
        contexto_curto: parsed.contexto_curto || "",
        leads_pra_abordar,
        corretores_pra_abordar,
        perfis_ig_seguir,
        alertas_operacionais: parsed.alertas_operacionais || [],
        stats_rapido,
      }, null, 0),
      gerado_em: new Date().toISOString(),
      tokens_usados: tokensUsados,
    };

    let planoId: string | null = null;
    if (existente) {
      const { data: upd } = await supabase
        .from("cowork_planos_diarios").update(planoPayload).eq("id", existente.id).select("id").single();
      planoId = upd?.id || existente.id;
      await supabase.from("cowork_tarefas").delete().eq("plano_id", planoId);
    } else {
      const { data: ins, error: insErr } = await supabase
        .from("cowork_planos_diarios").insert(planoPayload).select("id").single();
      if (insErr) throw new Error("INSERT falhou: " + insErr.message);
      planoId = ins?.id;
    }

    // ──────────────────────────────────────────────────────────
    // 5. WhatsApp resumo pro admin (operacional · não estratégico)
    // ──────────────────────────────────────────────────────────
    let zapiSent = false;
    if (ADMIN_WHATSAPP && ZAPI_INSTANCE && ZAPI_TOKEN) {
      try {
        const dataPt = new Date(dataISO + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
        const totalLeads = leads_pra_abordar.length + corretores_pra_abordar.length + perfis_ig_seguir.length;
        const linhasAlertas = (parsed.alertas_operacionais || []).slice(0, 2)
          .filter((a: any) => a.tipo === "critico")
          .map((a: any) => `🚨 ${a.mensagem}`).join("\n");

        const msg = [
          `🌅 ${parsed.saudacao || "Bom dia, Thiago"} · ${dataPt}`,
          ``,
          `${totalLeads} leads prontos pra você abordar hoje:`,
          `· ${leads_pra_abordar.length} empresários OLX`,
          `· ${corretores_pra_abordar.length} corretores`,
          `· ${perfis_ig_seguir.length} perfis IG`,
          ``,
          `Stats: ${anuRasc} rascunhos · ${leadsHoje} leads site 24h${leadsHoje === 0 ? " ⚠️" : ""} · R$ ${fmtBRL(pipelinePot)} pipeline`,
          linhasAlertas ? `\n${linhasAlertas}` : "",
          ``,
          `Abrir: https://1negocio.com.br/painel-v3.html#cockpit`,
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
      } catch (e) { console.warn("[zapi] falha:", e); }
    }

    return jsonOk({
      ok: true,
      plano_id: planoId,
      ja_existia: !!existente,
      tokens_usados: tokensUsados,
      zapi_enviado: zapiSent,
      counts: {
        leads_olx: leads_pra_abordar.length,
        corretores: corretores_pra_abordar.length,
        perfis_ig: perfis_ig_seguir.length,
      },
      stats: stats_rapido,
    });
  } catch (e) {
    console.error("[cowork-gerar-plano-diario]", e);
    return jsonErr(String((e as Error)?.message || e), 500);
  }
});

function jsonOk(payload: unknown) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function jsonErr(erro: string, status = 400) {
  return new Response(JSON.stringify({ ok: false, erro }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
