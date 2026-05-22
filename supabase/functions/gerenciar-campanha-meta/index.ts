// gerenciar-campanha-meta · v2
// Actions:
//   update_status   → PATCH campaign+adset+ad por projeto_ads_id (legado v1)
//   metrics         → GET insights da campanha por projeto_ads_id (legado v1)
//   list_campanhas  → GET todas as campanhas da conta + insights agregados
//   list_adsets     → GET adsets de uma campanha
//   list_ads        → GET ads de um adset + thumbnail
//   update_adset    → PATCH adset (daily_budget e/ou end_time)
//   status_campanha → POST status na campanha (ACTIVE/PAUSED/ARCHIVED)
//   status_adset    → POST status no adset
//   status_ad       → POST status no ad

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const META_TOKEN = Deno.env.get("META_ACCESS_TOKEN") || "";

const AD_ACCOUNT_ID = "act_983335024007752";
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

// Resumo de insights · soma + leads + CPL
function parseInsights(insightsArr: any[]): any {
  const row = (insightsArr && insightsArr[0]) || {};
  const actions: any[] = row.actions || [];
  const costPerAction: any[] = row.cost_per_action_type || [];
  const leadAction = actions.find(a => a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped" || a.action_type === "onsite_conversion.messaging_conversation_started_7d");
  const leadCPL = costPerAction.find(a => a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped" || a.action_type === "onsite_conversion.messaging_conversation_started_7d");
  return {
    impressions: parseInt(row.impressions || "0", 10),
    reach: parseInt(row.reach || "0", 10),
    clicks: parseInt(row.clicks || "0", 10),
    spend: parseFloat(row.spend || "0"),
    cpc: parseFloat(row.cpc || "0"),
    cpm: parseFloat(row.cpm || "0"),
    ctr: parseFloat(row.ctr || "0"),
    leads: leadAction ? parseInt(leadAction.value || "0", 10) : 0,
    cpl: leadCPL ? parseFloat(leadCPL.value || "0") : 0,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return resp(405, { ok: false, erro: "method_not_allowed" });
  if (!META_TOKEN) return resp(500, { ok: false, erro: "META_ACCESS_TOKEN_nao_configurado" });

  let body: any;
  try { body = await req.json(); } catch { return resp(400, { ok: false, erro: "json_invalido" }); }

  const action = body?.action;

  try {
    // ─── NEW: list_campanhas ──────────────────────────────────────
    if (action === "list_campanhas") {
      const fields = "id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time,buying_type,insights.date_preset(maximum){spend,impressions,clicks,reach,cpc,cpm,ctr,actions,cost_per_action_type}";
      const d = await metaCall("GET", `/${AD_ACCOUNT_ID}/campaigns?fields=${encodeURIComponent(fields)}&limit=100`);
      const campanhas = (d?.data || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        effective_status: c.effective_status,
        objective: c.objective,
        daily_budget: c.daily_budget ? parseInt(c.daily_budget, 10) : null,
        lifetime_budget: c.lifetime_budget ? parseInt(c.lifetime_budget, 10) : null,
        start_time: c.start_time,
        stop_time: c.stop_time,
        created_time: c.created_time,
        buying_type: c.buying_type,
        insights: c.insights?.data ? parseInsights(c.insights.data) : null,
      }));
      // Ordena: ACTIVE primeiro, depois por criação desc
      campanhas.sort((a: any, b: any) => {
        const aActive = a.effective_status === 'ACTIVE' ? 0 : 1;
        const bActive = b.effective_status === 'ACTIVE' ? 0 : 1;
        if (aActive !== bActive) return aActive - bActive;
        return new Date(b.created_time).getTime() - new Date(a.created_time).getTime();
      });
      return resp(200, { ok: true, campanhas });
    }

    // ─── NEW: list_adsets ─────────────────────────────────────────
    if (action === "list_adsets") {
      const campaign_id = body?.campaign_id;
      if (!campaign_id) return resp(400, { ok: false, erro: "campaign_id_obrigatorio" });
      const fields = "id,name,status,effective_status,daily_budget,lifetime_budget,start_time,end_time,optimization_goal,billing_event,destination_type,targeting,insights.date_preset(maximum){spend,impressions,clicks,reach,cpc,cpm,ctr,actions,cost_per_action_type}";
      const d = await metaCall("GET", `/${campaign_id}/adsets?fields=${encodeURIComponent(fields)}&limit=50`);
      const adsets = (d?.data || []).map((a: any) => {
        const t = a.targeting || {};
        const cidades = (t.geo_locations?.cities || []).map((c: any) => `${c.name} ${c.radius || 25}km`).join(' · ');
        const countries = (t.geo_locations?.countries || []).join(',');
        const behaviorsCnt = (t.behaviors || []).length;
        const interestsCnt = (t.interests || []).length;
        return {
          id: a.id,
          name: a.name,
          status: a.status,
          effective_status: a.effective_status,
          daily_budget: a.daily_budget ? parseInt(a.daily_budget, 10) : null,
          end_time: a.end_time,
          start_time: a.start_time,
          optimization_goal: a.optimization_goal,
          destination_type: a.destination_type,
          targeting_resumo: {
            geo: cidades || (countries ? `País ${countries}` : '—'),
            idade: (t.age_min && t.age_max) ? `${t.age_min}-${t.age_max}` : '—',
            genero: (t.genders && t.genders.length) ? (t.genders.includes(1) && t.genders.includes(2) ? 'todos' : t.genders.includes(1) ? 'homens' : 'mulheres') : 'todos',
            behaviors_count: behaviorsCnt,
            interests_count: interestsCnt,
            posicionamentos: (t.publisher_platforms || []).join(','),
          },
          targeting_raw: t,
          insights: a.insights?.data ? parseInsights(a.insights.data) : null,
        };
      });
      return resp(200, { ok: true, adsets });
    }

    // ─── NEW: list_ads ────────────────────────────────────────────
    if (action === "list_ads") {
      const adset_id = body?.adset_id;
      if (!adset_id) return resp(400, { ok: false, erro: "adset_id_obrigatorio" });
      const fields = "id,name,status,effective_status,created_time,creative{id,name,image_url,thumbnail_url,body,title,object_story_spec},insights.date_preset(maximum){spend,impressions,clicks,reach,cpc,cpm,ctr,actions,cost_per_action_type}";
      const d = await metaCall("GET", `/${adset_id}/ads?fields=${encodeURIComponent(fields)}&limit=50`);
      const ads = (d?.data || []).map((ad: any) => {
        const c = ad.creative || {};
        const oss = c.object_story_spec || {};
        const ld = oss.link_data || {};
        const cta = ld.call_to_action?.type || null;
        return {
          id: ad.id,
          name: ad.name,
          status: ad.status,
          effective_status: ad.effective_status,
          created_time: ad.created_time,
          creative: {
            id: c.id,
            image_url: c.image_url,
            thumbnail_url: c.thumbnail_url,
            body: c.body || ld.message,
            title: c.title || ld.name,
            cta: cta,
            link: ld.link,
          },
          insights: ad.insights?.data ? parseInsights(ad.insights.data) : null,
        };
      });
      return resp(200, { ok: true, ads });
    }

    // ─── NEW: update_adset ────────────────────────────────────────
    if (action === "update_adset") {
      const adset_id = body?.adset_id;
      if (!adset_id) return resp(400, { ok: false, erro: "adset_id_obrigatorio" });
      const patch: Record<string, any> = {};
      if (body?.daily_budget !== undefined) patch.daily_budget = String(parseInt(body.daily_budget, 10));
      if (body?.end_time) patch.end_time = body.end_time;
      if (!Object.keys(patch).length) return resp(400, { ok: false, erro: "nada_pra_atualizar" });
      await metaCall("POST", `/${adset_id}`, patch);
      return resp(200, { ok: true, atualizado: patch });
    }

    // ─── NEW: status_* (campanha/adset/ad direto via Meta ID) ─────
    if (action === "status_campanha" || action === "status_adset" || action === "status_ad") {
      const novoStatus = body?.status;
      if (!novoStatus || !["ACTIVE", "PAUSED", "ARCHIVED", "DELETED"].includes(novoStatus)) {
        return resp(400, { ok: false, erro: "status_invalido" });
      }
      const idKey = action === "status_campanha" ? "campaign_id" : action === "status_adset" ? "adset_id" : "ad_id";
      const id = body?.[idKey];
      if (!id) return resp(400, { ok: false, erro: `${idKey}_obrigatorio` });
      await metaCall("POST", `/${id}`, { status: novoStatus });
      return resp(200, { ok: true, status: novoStatus });
    }

    // ─── LEGADO v1: update_status (por projeto_ads_id) ────────────
    if (action === "update_status") {
      const projeto_ads_id = body?.projeto_ads_id;
      if (!projeto_ads_id) return resp(400, { ok: false, erro: "projeto_ads_id_obrigatorio" });
      const admin = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
      const { data: pa } = await admin
        .from("projeto_ads")
        .select("campanha_meta_id, adset_meta_id, ad_meta_id, status")
        .eq("id", projeto_ads_id).maybeSingle();
      if (!pa) return resp(404, { ok: false, erro: "projeto_ads_nao_encontrado" });
      const novo = body.status;
      if (!novo || !["ACTIVE", "PAUSED"].includes(novo)) return resp(400, { ok: false, erro: "status_invalido" });
      await metaCall("POST", `/${pa.ad_meta_id}`, { status: novo });
      await metaCall("POST", `/${pa.adset_meta_id}`, { status: novo });
      await metaCall("POST", `/${pa.campanha_meta_id}`, { status: novo });
      await admin.from("projeto_ads").update({ status: novo, updated_at: new Date().toISOString() }).eq("id", projeto_ads_id);
      return resp(200, { ok: true, status: novo });
    }

    // ─── LEGADO v1: metrics (por projeto_ads_id) ──────────────────
    if (action === "metrics") {
      const projeto_ads_id = body?.projeto_ads_id;
      if (!projeto_ads_id) return resp(400, { ok: false, erro: "projeto_ads_id_obrigatorio" });
      const admin = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
      const { data: pa } = await admin
        .from("projeto_ads")
        .select("campanha_meta_id")
        .eq("id", projeto_ads_id).maybeSingle();
      if (!pa) return resp(404, { ok: false, erro: "projeto_ads_nao_encontrado" });
      const fields = "impressions,reach,clicks,spend,cpc,cpm,ctr,frequency,actions,cost_per_action_type";
      const insights = await metaCall("GET", `/${pa.campanha_meta_id}/insights?fields=${fields}&date_preset=lifetime`);
      const parsed = parseInsights(insights?.data || []);
      return resp(200, { ok: true, ...parsed, raw_actions: insights?.data?.[0]?.actions || [] });
    }

    return resp(400, { ok: false, erro: "action_desconhecida", action });
  } catch (e: any) {
    console.error("[gerenciar-campanha-meta]", e);
    return resp(500, { ok: false, erro: "falha_meta_api", detalhe: e?.message || String(e) });
  }
});
