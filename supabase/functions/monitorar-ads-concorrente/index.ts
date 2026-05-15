// Edge Function: monitorar-ads-concorrente
// Item 6 / F9 · captura ads ativos de concorrentes via Meta Ad Library + análise IA Sonnet
//
// Cron · domingo 03:30 BRT (06:30 UTC)
// Lê ads_concorrentes_monitorados ativos · roda Apify · compara com snapshot anterior
// Salva ads_snapshots com analise_ia (Sonnet inferencial)
//
// Endpoint:
//   POST /functions/v1/monitorar-ads-concorrente
//   Body: { only_concorrente_id?, com_analise_ia?: bool (default true), notificar_admin?: bool }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const APIFY_TOKEN = Deno.env.get("APIFY_TOKEN")
  ?? Deno.env.get("APIFY_API_TOKEN")
  ?? Deno.env.get("APIFY_KEY")
  ?? Deno.env.get("APIFY_API_KEY")
  ?? "";
const ADMIN_WHATSAPP = Deno.env.get("ADMIN_WHATSAPP") ?? "";
const ZAPI_INSTANCE = Deno.env.get("ZAPI_INSTANCE") ?? "";
const ZAPI_TOKEN = Deno.env.get("ZAPI_TOKEN") ?? "";
const ZAPI_CLIENT_TOKEN = Deno.env.get("ZAPI_CLIENT_TOKEN") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ACTOR = "apify~facebook-ads-scraper";
const SONNET_MODEL = "claude-sonnet-4-20250514";
const TIMEOUT_MS = 180_000;

function buildAdLibraryUrl(c: { nome_pagina: string; pagina_id_meta?: string | null; pais?: string | null }): string {
  const country = (c.pais || "BR").toUpperCase();
  if (c.pagina_id_meta) {
    return `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${country}&view_all_page_id=${c.pagina_id_meta}`;
  }
  const q = encodeURIComponent(c.nome_pagina);
  return `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${country}&q=${q}&search_type=keyword_unordered`;
}

async function rodarApify(startUrl: string, resultsLimit: number): Promise<{ items: any[]; debug: any }> {
  const url = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(APIFY_TOKEN)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startUrls: [{ url: startUrl }],
        resultsLimit,
        activeStatus: "active",
        isDetailsPerAd: true,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const txt = await r.text();
    let parsed: any = null;
    try { parsed = JSON.parse(txt); } catch { /* */ }
    const debug = { status: r.status, ok: r.ok, body_preview: txt.slice(0, 300) };
    return { items: r.ok && Array.isArray(parsed) ? parsed : [], debug };
  } catch (e) {
    clearTimeout(t);
    return { items: [], debug: { erro: (e as Error).message } };
  }
}

function extractAdId(it: any): string | null {
  return String(it.ad_archive_id || it.adArchiveId || it.id || it.archive_id || "") || null;
}

function normalizarAd(it: any): any {
  return {
    id: extractAdId(it),
    body: it.body || it.ad_creative_bodies?.[0] || it.snapshot?.body?.text || "",
    titulo: it.title || it.ad_creative_link_titles?.[0] || it.snapshot?.title || "",
    cta: it.cta_type || it.snapshot?.cta_text || "",
    inicio: it.start_date || it.startDate || null,
    fim: it.end_date || it.endDate || null,
    plataformas: it.publisher_platform || it.platforms || [],
    tipo_midia: it.snapshot?.display_format || it.media_type || "",
    link: it.link_url || it.snapshot?.link_url || "",
  };
}

const PROMPT_ANALISE_ADS = `Você é analista sênior de marketing de performance pra plataforma 1Negócio (compra e venda de PMEs).

Contexto · vou te passar a lista de ads ATIVOS de um concorrente (do Meta Ad Library) + comparativo com snapshot anterior. Faça análise INFERENCIAL · sem inventar dados que o Meta não dá.

Saída JSON estrito com campos:
{
  "resumo_executivo": "frase de 1-2 linhas",
  "top_5_mais_tempo_no_ar": ["string · short", ...],
  "padroes_de_copy": ["padrão 1", "padrão 2", ...],
  "investimento_inferido": "baixo|medio|alto + justificativa",
  "publico_inferido": "descrição",
  "estagio_funil_predominante": "topo|meio|fundo + razão",
  "gaps_de_mercado": ["categoria não atacada 1", ...],
  "sugestao_copy_proprio": ["sugestão 1 (max 200 chars)", "sugestão 2", ...],
  "alerta": "string opcional · só se tiver algo crítico"
}

REGRAS:
- "investimento_inferido" baseado em volume × variações × plataformas (não invente $)
- "padroes_de_copy" identifica gatilhos repetidos (urgência · número · prova social · etc)
- "sugestao_copy_proprio" PT-BR · max 200 chars · objetivo claro
- Se zero ads · {"resumo_executivo":"sem ads ativos","alerta":"concorrente está pausado"}`;

async function analisarComSonnet(concorrente: string, ads: any[], deltas: { novos: number; pararam: number; total: number }): Promise<string> {
  if (!ANTHROPIC_API_KEY) return "";
  if (!ads.length) return JSON.stringify({ resumo_executivo: "sem ads ativos", alerta: "concorrente sem ads" });
  try {
    const resumoAds = ads.slice(0, 30).map((a, i) => {
      const dur = (a.inicio && a.fim) ? `${a.inicio}→${a.fim}` : (a.inicio || "—");
      return `${i + 1}. [${dur}] ${(a.titulo || a.body || "").slice(0, 200)}`;
    }).join("\n");
    const userMsg = `CONCORRENTE: ${concorrente}\nTOTAL ATIVOS: ${deltas.total} (${deltas.novos} novos · ${deltas.pararam} pararam desde último snapshot)\n\nADS:\n${resumoAds}\n\nFaça a análise inferencial.`;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: SONNET_MODEL,
        max_tokens: 1500,
        system: PROMPT_ANALISE_ADS,
        messages: [{ role: "user", content: userMsg }],
      }),
    });
    if (!res.ok) return JSON.stringify({ resumo_executivo: `Anthropic ${res.status}`, alerta: "falha análise" });
    const data = await res.json();
    const raw = (data.content?.[0]?.text || "").replace(/```json|```/g, "").trim();
    return raw;
  } catch (e) { return JSON.stringify({ resumo_executivo: String((e as Error).message).slice(0, 200) }); }
}

async function notificarAdminResumo(concorrentes: any[]): Promise<void> {
  if (!ADMIN_WHATSAPP || !ZAPI_INSTANCE || !ZAPI_TOKEN) return;
  const linhas = concorrentes.slice(0, 8).map(c => {
    const delta = c.novos > 0 ? ` 📈 +${c.novos}` : (c.pararam > 0 ? ` 📉 -${c.pararam}` : "");
    return `· ${c.nome}: ${c.total} ativos${delta}`;
  }).join("\n");
  const msg = [
    "📢 RESUMO ADS DOS CONCORRENTES · domingo",
    "",
    `${concorrentes.length} concorrentes monitorados:`,
    linhas,
    "",
    "Ver detalhes + análise IA:",
    "https://1negocio.com.br/painel-v3.html#monitoramento-conteudo",
  ].join("\n");
  const url = `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ZAPI_CLIENT_TOKEN) headers["Client-Token"] = ZAPI_CLIENT_TOKEN;
  await fetch(url, { method: "POST", headers, body: JSON.stringify({ phone: ADMIN_WHATSAPP, message: msg }) });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));
    if (!APIFY_TOKEN) return jsonErr("APIFY_TOKEN não configurado");
    const comAnaliseIa = body?.com_analise_ia !== false;
    const notificarAdmin = Boolean(body?.notificar_admin);

    let concorrentes: any[] = [];
    if (body?.only_concorrente_id) {
      const { data } = await supabase.from("ads_concorrentes_monitorados")
        .select("*").eq("id", body.only_concorrente_id).maybeSingle();
      if (data) concorrentes = [data];
    } else {
      const { data } = await supabase.from("ads_concorrentes_monitorados")
        .select("*").eq("ativo", true)
        .order("ultima_analise", { ascending: true, nullsFirst: true });
      concorrentes = data || [];
    }
    if (!concorrentes.length) return jsonErr("nenhum concorrente ativo", 404);

    const resumo: any[] = [];
    for (const c of concorrentes) {
      const t0 = Date.now();
      const url = buildAdLibraryUrl(c);
      const { items, debug } = await rodarApify(url, 50);
      const adsAtivos = items.map(normalizarAd).filter((a: any) => a.id);
      const idsAtivos = new Set(adsAtivos.map((a: any) => a.id));

      const { data: ultimo } = await supabase.from("ads_snapshots")
        .select("ads_ativos, total_ativos")
        .eq("concorrente_id", c.id)
        .order("capturado_em", { ascending: false })
        .limit(1)
        .maybeSingle();
      const idsAnteriores = new Set<string>(
        ((ultimo?.ads_ativos as any[]) || []).map((a: any) => String(a.id || ""))
      );
      const novos = [...idsAtivos].filter(id => !idsAnteriores.has(id)).length;
      const pararam = [...idsAnteriores].filter(id => !idsAtivos.has(id)).length;

      let analiseIa = "";
      if (comAnaliseIa) {
        analiseIa = await analisarComSonnet(c.nome_pagina, adsAtivos, { novos, pararam, total: adsAtivos.length });
      }

      await supabase.from("ads_snapshots").insert({
        concorrente_id: c.id,
        total_ativos: adsAtivos.length,
        novos_desde_ultimo: novos,
        pararam_desde_ultimo: pararam,
        ads_ativos: adsAtivos,
        analise_ia: analiseIa,
      });

      await supabase.from("ads_concorrentes_monitorados")
        .update({ ultima_analise: new Date().toISOString() })
        .eq("id", c.id);

      resumo.push({
        concorrente_id: c.id,
        nome: c.nome_pagina,
        total: adsAtivos.length,
        novos,
        pararam,
        com_analise_ia: !!analiseIa,
        duracao_ms: Date.now() - t0,
        apify_debug: debug,
      });
    }

    if (notificarAdmin) {
      try { await notificarAdminResumo(resumo); } catch (e) { console.warn("[notif admin]", e); }
    }

    return jsonOk({
      ok: true,
      concorrentes_processados: concorrentes.length,
      total_ads: resumo.reduce((s, r) => s + (r.total || 0), 0),
      total_novos: resumo.reduce((s, r) => s + (r.novos || 0), 0),
      total_pararam: resumo.reduce((s, r) => s + (r.pararam || 0), 0),
      detalhe: resumo,
    });
  } catch (e) {
    console.error("[monitorar-ads-concorrente]", e);
    return jsonErr(String((e as Error).message || e), 500);
  }
});

function jsonOk(p: unknown) { return new Response(JSON.stringify(p), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
function jsonErr(e: string, s = 400) { return new Response(JSON.stringify({ ok: false, erro: e }), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
