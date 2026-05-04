// Edge Function: buscar-telefone-olx
// Busca telefone de UM lead OLX específico via Apify detail scraper.
// Idempotente · se já tem telefone, retorna direto.
//
// PENDÊNCIA · actor Apify pra OLX detail page com extração de phone
// não está claro qual actor da loja Apify usa nessa conta.
// Implementação atual: tenta apify/olx-scraper passando URL como startUrls.
// Se actor não retornar phone, marca telefone_buscado_em + retorna
// manual_required=true · admin abre URL e cola telefone manualmente.
//
// Endpoint:
//   POST /functions/v1/buscar-telefone-olx
//   Body: { lead_id: string, apify_token: string }
//   Returns: { ok, telefone?, manual_required?, url_anuncio?, motivo? }

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

const APIFY_ACTOR = "epctex~olx-scraper"; // pendente confirmar · admin pode trocar
const TIMEOUT_MS = 60_000;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));
    const { lead_id } = body || {};
    const apify_token = body?.apify_token || APIFY_TOKEN_ENV;
    if (!lead_id) return jsonErr("lead_id obrigatório");

    // 1. Carrega lead
    const { data: lead, error } = await supabase
      .from("leads_google")
      .select("id, telefone, telefone_buscado_em, url_anuncio")
      .eq("id", lead_id)
      .maybeSingle();
    if (error || !lead) return jsonErr("lead não encontrado", 404);

    // 2. Se já tem telefone · idempotente
    if (lead.telefone && lead.telefone.length >= 10) {
      return jsonOk({ ok: true, telefone: lead.telefone, ja_tinha: true });
    }

    // 3. Sem URL · não dá pra buscar · marca como buscado e retorna manual
    if (!lead.url_anuncio) {
      await supabase.from("leads_google")
        .update({ telefone_buscado_em: new Date().toISOString() })
        .eq("id", lead_id);
      return jsonOk({ ok: true, manual_required: true, motivo: "sem URL · backfill futuro com novo scrap" });
    }

    // 4. Sem token Apify · tenta manual
    if (!apify_token) {
      await supabase.from("leads_google")
        .update({ telefone_buscado_em: new Date().toISOString() })
        .eq("id", lead_id);
      return jsonOk({
        ok: true,
        manual_required: true,
        url_anuncio: lead.url_anuncio,
        motivo: "Apify token não informado · admin abre URL e cola telefone",
      });
    }

    // 5. Tenta Apify detail scraper · run sync
    let telefoneCapturado: string | null = null;
    let apifyErro = "";
    try {
      const apifyUrl = `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(apify_token)}`;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const r = await fetch(apifyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startUrls: [{ url: lead.url_anuncio }],
          maxItems: 1,
          extendOutputFunction: "($) => ({ phone: $('a[href*=\"tel:\"]').attr('href') })",
        }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (r.ok) {
        const items = await r.json();
        const item = Array.isArray(items) ? items[0] : null;
        const candidatos = [item?.phone, item?.telephone, item?.contact_phone, item?.user?.phone, item?.seller?.phone];
        const tel = candidatos.find(x => typeof x === "string" && x.replace(/\D/g, "").length >= 10);
        if (tel) telefoneCapturado = String(tel).replace(/[^0-9+]/g, "").replace(/^\+?55?/, "");
      } else {
        apifyErro = `Apify ${r.status}: ${(await r.text()).slice(0, 100)}`;
      }
    } catch (e) {
      apifyErro = String((e as Error).message);
    }

    // 6. Salva resultado
    const updates: any = { telefone_buscado_em: new Date().toISOString() };
    if (telefoneCapturado) {
      const tel = telefoneCapturado.replace(/\D/g, "");
      const tFmt = tel.startsWith("55") ? tel : "55" + tel;
      updates.telefone = tFmt;
    }
    await supabase.from("leads_google").update(updates).eq("id", lead_id);

    if (telefoneCapturado) {
      return jsonOk({ ok: true, telefone: updates.telefone, custo_estimado_brl: 0.05 });
    }
    return jsonOk({
      ok: true,
      manual_required: true,
      url_anuncio: lead.url_anuncio,
      motivo: apifyErro || "Apify não capturou telefone · admin abre URL e cola manualmente",
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
