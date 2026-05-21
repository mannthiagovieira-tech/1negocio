// gerenciar-campanha-meta · v1
// action='update_status' → PATCH campaign + adset + ad (mantém consistência)
// action='metrics'       → GET insights da campanha + agregados (impressions, reach, clicks, spend, leads, CPL, CTR)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const META_TOKEN = Deno.env.get("META_ACCESS_TOKEN") || "";

const GRAPH = "https://graph.facebook.com/v23.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function resp(s: number, b: unknown) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}

async function metaCall(method: string, path: string, body?: Record<string, any>): Promise<any> {
  const url = `${GRAPH}${path}`;
  if (method === "GET") {
    const sep = path.includes("?") ? "&" : "?";
    const fullUrl = `${url}${sep}access_token=${encodeURIComponent(META_TOKEN)}`;
    const r = await fetch(fullUrl);
    const txt = await r.text();
    if (!r.ok) throw new Error(`Meta ${method} ${path} ${r.status}: ${txt.slice(0, 400)}`);
    return JSON.parse(txt);
  } else {
    const fd = new URLSearchParams();
    if (body) for (const [k, v] of Object.entries(body)) {
      fd.append(k, typeof v === "string" ? v : JSON.stringify(v));
    }
    fd.append("access_token", META_TOKEN);
    const r = await fetch(url, { method, body: fd });
    const txt = await r.text();
    if (!r.ok) throw new Error(`Meta ${method} ${path} ${r.status}: ${txt.slice(0, 400)}`);
    return JSON.parse(txt);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return resp(405, { ok: false, erro: "method_not_allowed" });
  if (!META_TOKEN) return resp(500, { ok: false, erro: "META_ACCESS_TOKEN_nao_configurado" });

  let body: any;
  try { body = await req.json(); } catch { return resp(400, { ok: false, erro: "json_invalido" }); }

  const { action, projeto_ads_id } = body || {};
  if (!projeto_ads_id) return resp(400, { ok: false, erro: "projeto_ads_id_obrigatorio" });

  const admin = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  const { data: pa, error: paErr } = await admin
    .from("projeto_ads")
    .select("campanha_meta_id, adset_meta_id, ad_meta_id, status")
    .eq("id", projeto_ads_id)
    .maybeSingle();
  if (paErr || !pa) return resp(404, { ok: false, erro: "projeto_ads_nao_encontrado" });

  try {
    if (action === "update_status") {
      const novo = body.status;
      if (!novo || !["ACTIVE", "PAUSED"].includes(novo)) {
        return resp(400, { ok: false, erro: "status_invalido" });
      }
      // PATCH em ad → adset → campaign nessa ordem (do filho pro pai)
      await metaCall("POST", `/${pa.ad_meta_id}`, { status: novo });
      await metaCall("POST", `/${pa.adset_meta_id}`, { status: novo });
      await metaCall("POST", `/${pa.campanha_meta_id}`, { status: novo });
      await admin.from("projeto_ads").update({ status: novo, updated_at: new Date().toISOString() }).eq("id", projeto_ads_id);
      return resp(200, { ok: true, status: novo });
    }

    if (action === "metrics") {
      // Insights da campanha · date_preset=lifetime · agrega tudo desde criação
      const fields = "impressions,reach,clicks,spend,cpc,cpm,ctr,frequency,actions,cost_per_action_type";
      const insights = await metaCall("GET", `/${pa.campanha_meta_id}/insights?fields=${fields}&date_preset=lifetime`);
      const row = (insights?.data && insights.data[0]) || {};

      // Lead Gen actions vêm como action_type='lead' ou 'onsite_conversion.lead_grouped'
      const actions: any[] = row.actions || [];
      const costPerAction: any[] = row.cost_per_action_type || [];
      const leadAction = actions.find(a => a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped");
      const leadCPL = costPerAction.find(a => a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped");

      return resp(200, {
        ok: true,
        impressions: parseInt(row.impressions || "0", 10),
        reach: parseInt(row.reach || "0", 10),
        clicks: parseInt(row.clicks || "0", 10),
        spend: parseFloat(row.spend || "0"),
        cpc: parseFloat(row.cpc || "0"),
        cpm: parseFloat(row.cpm || "0"),
        ctr: parseFloat(row.ctr || "0"),
        frequency: parseFloat(row.frequency || "0"),
        leads: leadAction ? parseInt(leadAction.value || "0", 10) : 0,
        cpl: leadCPL ? parseFloat(leadCPL.value || "0") : 0,
        raw_actions: actions,
      });
    }

    return resp(400, { ok: false, erro: "action_desconhecida" });
  } catch (e: any) {
    console.error("[gerenciar-campanha-meta]", e);
    return resp(500, { ok: false, erro: "falha_meta_api", detalhe: e?.message || String(e) });
  }
});
