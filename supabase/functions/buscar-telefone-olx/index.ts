// Edge Function: buscar-telefone-olx
// Tenta extrair telefone+valor de UM lead OLX via 2 actors em sequência.
// Idempotente · se já tem telefone retorna direto.
//
// Estratégia (após investigação · OLX bloqueia phone atrás de gates):
// 1. daddyapi/olx-brazil-scraper · searchQuery=slug do título · pega item enriquecido
//    (já é o actor usado no apify-olx-scraper · pode trazer description+price extras)
// 2. Se nenhum actor retorna phone · marca manual_required (admin cola)
//
// Endpoint:
//   POST /functions/v1/buscar-telefone-olx
//   Body: { lead_id: string, apify_token?: string }
//   Returns: { ok, telefone?, valor_anuncio?, manual_required?, url_anuncio?, motivo? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APIFY_TOKEN_ENV = Deno.env.get("APIFY_TOKEN_OLX")
  ?? Deno.env.get("APIFY_TOKEN")
  ?? Deno.env.get("APIFY_API_TOKEN")
  ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ACTOR_PRIMARY = "daddyapi~olx-brazil-scraper"; // search-based · pode retornar phone se vier no item
const TIMEOUT_MS = 90_000;

// Extrai slug do título da URL OLX (após "comercio-e-industria/" · antes do número final)
function slugFromUrl(url: string): string {
  if (!url) return "";
  const parts = url.split("/");
  // último segmento tem "slug-titulo-NUMERO"
  const last = parts[parts.length - 1] || "";
  const slug = last.replace(/-\d+$/, "").replace(/-/g, " ").trim();
  return slug.slice(0, 100);
}

function extractPhone(item: any): string | null {
  // Tenta vários campos onde phone pode aparecer
  const fields = [
    item?.phone, item?.telephone, item?.contact_phone, item?.contactPhone,
    item?.user?.phone, item?.seller?.phone, item?.advertiser?.phone,
    item?.contact?.phone, item?.contact?.tel, item?.tel,
  ];
  for (const f of fields) {
    if (typeof f === "string") {
      const dig = f.replace(/\D/g, "");
      if (dig.length >= 10) return dig;
    }
  }
  // Vasculha texto livre por padrão de telefone BR
  const blob = JSON.stringify(item).toLowerCase();
  const m = blob.match(/(?:tel[:\s]*|whatsapp[:\s]*|fone[:\s]*)\(?(\d{2})\)?[\s-]*9?[\s-]*(\d{4})[\s-]*(\d{4})/);
  if (m) {
    const dig = (m[1] + (m[0].includes("9") ? "9" : "") + m[2] + m[3]).replace(/\D/g, "");
    if (dig.length >= 10) return dig;
  }
  return null;
}

function extractValor(item: any): number | null {
  const candidatos = [item?.price, item?.priceText, item?.valor, item?.value];
  for (const c of candidatos) {
    if (c == null) continue;
    let raw = typeof c === "object" ? String(c.value ?? c.amount ?? "") : String(c);
    raw = raw.toLowerCase().replace(/r\$\s*/g, "").trim();
    if (/mil/.test(raw)) {
      const m = raw.match(/([\d.,]+)\s*mil/);
      if (m) return Math.round(parseFloat(m[1].replace(/\./g, "").replace(",", ".")) * 1000);
    }
    if (/milh/.test(raw)) {
      const m = raw.match(/([\d.,]+)\s*milh/);
      if (m) return Math.round(parseFloat(m[1].replace(/\./g, "").replace(",", ".")) * 1_000_000);
    }
    const m = raw.match(/(\d+(?:\.\d{3})*(?:,\d{2})?)/);
    if (m) {
      const n = parseFloat(m[1].replace(/\./g, "").replace(",", "."));
      if (Number.isFinite(n) && n > 0) return Math.round(n);
    }
  }
  return null;
}

async function tentarActor(actor: string, slug: string, token: string): Promise<{ items: any[]; debug: any }> {
  const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=80&memory=256`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        searchQuery: slug,
        olxDomain: "olx.com.br",
        sortBy: "newest",
        maxPages: 1,
        proxyConfiguration: { useApifyProxy: true },
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const txt = await r.text();
    let parsed: any = null;
    try { parsed = JSON.parse(txt); } catch { /* */ }
    return {
      items: r.ok && Array.isArray(parsed) ? parsed : [],
      debug: { actor, status: r.status, ok: r.ok, body_preview: txt.slice(0, 200) },
    };
  } catch (e) {
    clearTimeout(t);
    return { items: [], debug: { actor, erro: (e as Error).message } };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));
    const { lead_id } = body || {};
    const apify_token = body?.apify_token || APIFY_TOKEN_ENV;
    if (!lead_id) return jsonErr("lead_id obrigatório");

    const { data: lead, error } = await supabase
      .from("leads_google")
      .select("id, nome, telefone, valor_anuncio, telefone_buscado_em, url_anuncio")
      .eq("id", lead_id)
      .maybeSingle();
    if (error || !lead) return jsonErr("lead não encontrado", 404);

    if (lead.telefone && lead.telefone.length >= 10) {
      return jsonOk({ ok: true, telefone: lead.telefone, ja_tinha: true });
    }
    if (!lead.url_anuncio) {
      await supabase.from("leads_google").update({ telefone_buscado_em: new Date().toISOString() }).eq("id", lead_id);
      return jsonOk({ ok: true, manual_required: true, motivo: "sem URL · admin precisa abrir manualmente" });
    }
    if (!apify_token) {
      await supabase.from("leads_google").update({ telefone_buscado_em: new Date().toISOString() }).eq("id", lead_id);
      return jsonOk({ ok: true, manual_required: true, url_anuncio: lead.url_anuncio, motivo: "APIFY_TOKEN_OLX não configurado" });
    }

    // Tenta extrair via slug (daddyapi)
    const slug = slugFromUrl(lead.url_anuncio);
    const debugChain: any[] = [];
    let telCapturado: string | null = null;
    let valorCapturado: number | null = lead.valor_anuncio ? Number(lead.valor_anuncio) : null;
    let descricaoExtra: string | null = null;

    if (slug) {
      const r = await tentarActor(ACTOR_PRIMARY, slug, apify_token);
      debugChain.push(r.debug);
      // Tenta achar item que matche a URL (parcial)
      const urlBase = lead.url_anuncio.split("?")[0].toLowerCase();
      const match = r.items.find((it: any) => {
        const u = String(it?.url || it?.friendlyUrl || "").toLowerCase();
        return u && (u === urlBase || urlBase.endsWith(u) || u.endsWith(urlBase.replace(/^https?:\/\//, "")));
      }) || r.items[0]; // fallback · primeiro item

      if (match) {
        telCapturado = extractPhone(match);
        const v = extractValor(match);
        if (v && !valorCapturado) valorCapturado = v;
        descricaoExtra = match.description || match.body || null;
      }
    }

    const updates: any = { telefone_buscado_em: new Date().toISOString() };
    if (telCapturado) {
      const dig = telCapturado.replace(/\D/g, "");
      const tFmt = dig.startsWith("55") ? dig : "55" + dig;
      updates.telefone = tFmt;
    }
    if (valorCapturado && !lead.valor_anuncio) updates.valor_anuncio = valorCapturado;
    if (descricaoExtra && !lead.bio) updates.bio = String(descricaoExtra).slice(0, 500);
    await supabase.from("leads_google").update(updates).eq("id", lead_id);

    if (telCapturado) {
      return jsonOk({
        ok: true,
        telefone: updates.telefone,
        valor_anuncio: valorCapturado,
        custo_estimado_brl: 0.10,
      });
    }
    return jsonOk({
      ok: true,
      manual_required: true,
      url_anuncio: lead.url_anuncio,
      valor_anuncio: valorCapturado,
      motivo: "OLX não expõe telefone via Apify scraper · admin abre URL e cola manual",
      debug_chain: debugChain,
    });
  } catch (e) {
    console.error("[buscar-telefone-olx]", e);
    return jsonErr(String((e as Error).message || e), 500);
  }
});

function jsonOk(payload: unknown) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function jsonErr(erro: string, status = 400) {
  return new Response(JSON.stringify({ ok: false, erro }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
