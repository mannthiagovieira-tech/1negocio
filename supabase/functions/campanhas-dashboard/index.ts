// campanhas-dashboard · v1.0.0
// Unifica Meta Ads + Google Ads num único endpoint, com filtro de período
// Períodos suportados: today, 7d, 30d, custom (com start/end YYYY-MM-DD)

const META_TOKEN = Deno.env.get("META_ACCESS_TOKEN") || "";
const META_AD_ACCOUNT = "act_983335024007752";
const GRAPH = "https://graph.facebook.com/v23.0";

// Google Ads · 5 env vars necessárias pro funcionamento completo
const GA_DEV_TOKEN = Deno.env.get("GOOGLE_ADS_DEVELOPER_TOKEN") || "";
const GA_CLIENT_ID = Deno.env.get("GOOGLE_ADS_CLIENT_ID") || "";
const GA_CLIENT_SECRET = Deno.env.get("GOOGLE_ADS_CLIENT_SECRET") || "";
const GA_REFRESH_TOKEN = Deno.env.get("GOOGLE_ADS_REFRESH_TOKEN") || "";
const GA_LOGIN_CUSTOMER_ID = (Deno.env.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID") || "3503142844").replace(/-/g, "");
const GA_CUSTOMER_ID = (Deno.env.get("GOOGLE_ADS_CUSTOMER_ID") || GA_LOGIN_CUSTOMER_ID).replace(/-/g, "");
const GA_API_VERSION = "v18";

if (!META_TOKEN) console.warn("[campanhas-dashboard][boot] META_ACCESS_TOKEN ausente");
const gaMissing: string[] = [];
if (!GA_DEV_TOKEN) gaMissing.push("GOOGLE_ADS_DEVELOPER_TOKEN");
if (!GA_CLIENT_ID) gaMissing.push("GOOGLE_ADS_CLIENT_ID");
if (!GA_CLIENT_SECRET) gaMissing.push("GOOGLE_ADS_CLIENT_SECRET");
if (!GA_REFRESH_TOKEN) gaMissing.push("GOOGLE_ADS_REFRESH_TOKEN");
if (gaMissing.length) console.warn("[campanhas-dashboard][boot] Google Ads env ausentes:", gaMissing.join(","));

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function resp(s: number, b: unknown) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}

// ─── Helpers de período ─────────────────────────────────────────────
function metaDatePreset(periodo: string): string {
  switch (periodo) {
    case "today": return "today";
    case "7d": case "last_7_days": return "last_7d";
    case "30d": case "last_30_days": return "last_30d";
    default: return "today";
  }
}
function googleDuring(periodo: string): string {
  switch (periodo) {
    case "today": return "TODAY";
    case "7d": case "last_7_days": return "LAST_7_DAYS";
    case "30d": case "last_30_days": return "LAST_30_DAYS";
    default: return "TODAY";
  }
}

function extrairAction(actions: any[]): number {
  if (!Array.isArray(actions)) return 0;
  const a = actions.find((x: any) =>
    x.action_type === "onsite_conversion.messaging_conversation_started_7d" ||
    x.action_type === "lead" ||
    x.action_type === "onsite_conversion.lead_grouped");
  return a ? parseInt(a.value || "0", 10) : 0;
}
function extrairCPL(cpa: any[]): number {
  if (!Array.isArray(cpa)) return 0;
  const a = cpa.find((x: any) =>
    x.action_type === "onsite_conversion.messaging_conversation_started_7d" ||
    x.action_type === "lead" ||
    x.action_type === "onsite_conversion.lead_grouped");
  return a ? parseFloat(a.value || "0") : 0;
}

// ─── META · resumo agregado da conta + lista de campanhas ──────────
async function buscarMetaResumo(periodo: string, customRange: any) {
  if (!META_TOKEN) return { configured: false, erro: "META_ACCESS_TOKEN ausente" };
  const preset = metaDatePreset(periodo);
  const fieldsAgreg = "spend,impressions,clicks,actions,cost_per_action_type,ctr";
  const urlHoje = `${GRAPH}/${META_AD_ACCOUNT}/insights?fields=${fieldsAgreg}&date_preset=today&access_token=${encodeURIComponent(META_TOKEN)}`;
  let urlPeriodo: string;
  if (periodo === "custom" && customRange?.start && customRange?.end) {
    const tr = encodeURIComponent(JSON.stringify({ since: customRange.start, until: customRange.end }));
    urlPeriodo = `${GRAPH}/${META_AD_ACCOUNT}/insights?fields=${fieldsAgreg}&time_range=${tr}&access_token=${encodeURIComponent(META_TOKEN)}`;
  } else {
    urlPeriodo = `${GRAPH}/${META_AD_ACCOUNT}/insights?fields=${fieldsAgreg}&date_preset=${preset}&access_token=${encodeURIComponent(META_TOKEN)}`;
  }
  try {
    const [hojeR, periodoR] = await Promise.all([fetch(urlHoje), fetch(urlPeriodo)]);
    const hojeData = (await hojeR.json())?.data?.[0] || {};
    const periodoData = (await periodoR.json())?.data?.[0] || {};
    return {
      configured: true,
      hoje: {
        spend: parseFloat(hojeData.spend || "0"),
      },
      periodo: {
        spend: parseFloat(periodoData.spend || "0"),
        impressions: parseInt(periodoData.impressions || "0", 10),
        clicks: parseInt(periodoData.clicks || "0", 10),
        ctr: parseFloat(periodoData.ctr || "0"),
        conversas: extrairAction(periodoData.actions),
        cpl: extrairCPL(periodoData.cost_per_action_type),
      },
    };
  } catch (e: any) {
    return { configured: true, erro: e?.message || String(e) };
  }
}

async function buscarMetaCampanhas(periodo: string, customRange: any) {
  if (!META_TOKEN) return [];
  const preset = metaDatePreset(periodo);
  let insightsClause: string;
  if (periodo === "custom" && customRange?.start && customRange?.end) {
    const tr = JSON.stringify({ since: customRange.start, until: customRange.end });
    insightsClause = `insights.time_range(${encodeURIComponent(tr)}){spend,impressions,clicks,ctr,actions,cost_per_action_type}`;
  } else {
    insightsClause = `insights.date_preset(${preset}){spend,impressions,clicks,ctr,actions,cost_per_action_type}`;
  }
  const fields = `id,name,status,effective_status,objective,daily_budget,${insightsClause}`;
  const url = `${GRAPH}/${META_AD_ACCOUNT}/campaigns?fields=${encodeURIComponent(fields)}&limit=100&access_token=${encodeURIComponent(META_TOKEN)}`;
  try {
    const r = await fetch(url);
    if (!r.ok) {
      console.error(`[campanhas-dashboard][meta] ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return [];
    }
    const data = await r.json();
    const list = (data?.data || []).map((c: any) => {
      const i = c.insights?.data?.[0] || {};
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        effective_status: c.effective_status,
        objective: c.objective,
        daily_budget: c.daily_budget ? parseInt(c.daily_budget, 10) / 100 : null, // centavos → R$
        spend: parseFloat(i.spend || "0"),
        impressions: parseInt(i.impressions || "0", 10),
        clicks: parseInt(i.clicks || "0", 10),
        ctr: parseFloat(i.ctr || "0"),
        conversas: extrairAction(i.actions),
        cpl: extrairCPL(i.cost_per_action_type),
      };
    });
    // ordena ACTIVE primeiro, depois por gasto desc
    list.sort((a: any, b: any) => {
      const aActive = a.effective_status === "ACTIVE" ? 0 : 1;
      const bActive = b.effective_status === "ACTIVE" ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return b.spend - a.spend;
    });
    return list;
  } catch (e) {
    console.error("[campanhas-dashboard][meta] exception", e);
    return [];
  }
}

// ─── GOOGLE ADS ─────────────────────────────────────────────────────
let gaCachedToken: { token: string; expiresAt: number } | null = null;

async function obterGoogleAccessToken(): Promise<string | null> {
  if (gaCachedToken && Date.now() < gaCachedToken.expiresAt - 30_000) return gaCachedToken.token;
  if (!GA_CLIENT_ID || !GA_CLIENT_SECRET || !GA_REFRESH_TOKEN) return null;
  const body = new URLSearchParams({
    client_id: GA_CLIENT_ID,
    client_secret: GA_CLIENT_SECRET,
    refresh_token: GA_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!r.ok) {
      console.error(`[campanhas-dashboard][ga oauth] ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return null;
    }
    const d = await r.json();
    gaCachedToken = { token: d.access_token, expiresAt: Date.now() + (d.expires_in || 3600) * 1000 };
    return d.access_token;
  } catch (e) {
    console.error("[campanhas-dashboard][ga oauth] exception", e);
    return null;
  }
}

function googleHeaders(token: string): Record<string, string> {
  return {
    "Authorization": `Bearer ${token}`,
    "developer-token": GA_DEV_TOKEN,
    "login-customer-id": GA_LOGIN_CUSTOMER_ID,
    "Content-Type": "application/json",
  };
}

async function buscarGoogle(periodo: string) {
  const missing = gaMissing.slice();
  if (missing.length) {
    return {
      configured: false,
      erro: "google_ads_env_vars_ausentes",
      missing,
      instrucoes: "Configure no Supabase: GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN (+ opcional GOOGLE_ADS_LOGIN_CUSTOMER_ID).",
    };
  }
  const token = await obterGoogleAccessToken();
  if (!token) return { configured: false, erro: "oauth_refresh_falhou" };

  const customerId = GA_CUSTOMER_ID;
  const during = googleDuring(periodo);
  // Hoje sempre (independente do período)
  const queryHoje = `SELECT metrics.cost_micros FROM customer WHERE segments.date DURING TODAY`;
  // Período + lista de campanhas
  const queryCampanhas = `
    SELECT campaign.id, campaign.name, campaign.status,
      campaign_budget.amount_micros,
      metrics.cost_micros, metrics.impressions, metrics.clicks,
      metrics.ctr, metrics.average_cpc
    FROM campaign
    WHERE segments.date DURING ${during}
  `;
  const url = `https://googleads.googleapis.com/${GA_API_VERSION}/customers/${customerId}/googleAds:search`;
  try {
    const [hojeR, campR] = await Promise.all([
      fetch(url, { method: "POST", headers: googleHeaders(token), body: JSON.stringify({ query: queryHoje, pageSize: 1 }) }),
      fetch(url, { method: "POST", headers: googleHeaders(token), body: JSON.stringify({ query: queryCampanhas, pageSize: 100 }) }),
    ]);
    if (!hojeR.ok) {
      const txt = await hojeR.text();
      console.error(`[campanhas-dashboard][ga hoje] ${hojeR.status}: ${txt.slice(0, 300)}`);
      return { configured: true, erro: `google_ads_api_${hojeR.status}`, detalhe: txt.slice(0, 200) };
    }
    if (!campR.ok) {
      const txt = await campR.text();
      console.error(`[campanhas-dashboard][ga camp] ${campR.status}: ${txt.slice(0, 300)}`);
      return { configured: true, erro: `google_ads_api_${campR.status}`, detalhe: txt.slice(0, 200) };
    }
    const hojeData = await hojeR.json();
    const campData = await campR.json();
    const hojeMicros = (hojeData.results || []).reduce((s: number, r: any) => s + (parseInt(r.metrics?.costMicros || "0", 10)), 0);
    let totSpend = 0, totImp = 0, totClicks = 0;
    const campanhas: any[] = [];
    (campData.results || []).forEach((row: any) => {
      const spend = (parseInt(row.metrics?.costMicros || "0", 10)) / 1_000_000;
      const imp = parseInt(row.metrics?.impressions || "0", 10);
      const clicks = parseInt(row.metrics?.clicks || "0", 10);
      const cpc = (parseInt(row.metrics?.averageCpc || "0", 10)) / 1_000_000;
      const ctr = parseFloat(row.metrics?.ctr || "0") * 100; // GA retorna decimal 0-1
      const budget = (parseInt(row.campaignBudget?.amountMicros || "0", 10)) / 1_000_000;
      totSpend += spend; totImp += imp; totClicks += clicks;
      campanhas.push({
        id: row.campaign?.id,
        name: row.campaign?.name,
        status: row.campaign?.status,
        daily_budget: budget,
        spend, impressions: imp, clicks,
        ctr, cpc,
      });
    });
    campanhas.sort((a: any, b: any) => {
      const aA = a.status === "ENABLED" ? 0 : 1;
      const bA = b.status === "ENABLED" ? 0 : 1;
      if (aA !== bA) return aA - bA;
      return b.spend - a.spend;
    });
    return {
      configured: true,
      customer_id: customerId,
      hoje: { spend: hojeMicros / 1_000_000 },
      periodo: { spend: totSpend, impressions: totImp, clicks: totClicks },
      campanhas,
    };
  } catch (e: any) {
    console.error("[campanhas-dashboard][ga] exception", e);
    return { configured: true, erro: e?.message || String(e) };
  }
}

// ─── Mutations: pausar/ativar campanha ──────────────────────────────
async function metaSetStatus(campaign_id: string, status: "ACTIVE" | "PAUSED") {
  if (!META_TOKEN) return { ok: false, erro: "META_ACCESS_TOKEN_ausente" };
  const fd = new URLSearchParams();
  fd.append("status", status);
  fd.append("access_token", META_TOKEN);
  const r = await fetch(`${GRAPH}/${campaign_id}`, { method: "POST", body: fd });
  const txt = await r.text();
  if (!r.ok) return { ok: false, erro: `meta_${r.status}`, detalhe: txt.slice(0, 200) };
  return { ok: true };
}

async function googleSetStatus(campaign_id: string, status: "ENABLED" | "PAUSED") {
  if (gaMissing.length) return { ok: false, erro: "google_ads_env_vars_ausentes" };
  const token = await obterGoogleAccessToken();
  if (!token) return { ok: false, erro: "oauth_refresh_falhou" };
  const customerId = GA_CUSTOMER_ID;
  const url = `https://googleads.googleapis.com/${GA_API_VERSION}/customers/${customerId}/campaigns:mutate`;
  const body = {
    operations: [{
      update: { resourceName: `customers/${customerId}/campaigns/${campaign_id}`, status },
      updateMask: "status",
    }],
  };
  const r = await fetch(url, { method: "POST", headers: googleHeaders(token), body: JSON.stringify(body) });
  if (!r.ok) {
    const txt = await r.text();
    console.error(`[campanhas-dashboard][ga mutate] ${r.status}: ${txt.slice(0, 300)}`);
    return { ok: false, erro: `google_${r.status}`, detalhe: txt.slice(0, 200) };
  }
  return { ok: true };
}

// ─── MAIN HANDLER ───────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return resp(405, { ok: false, erro: "method_not_allowed" });

  let body: any = {};
  try { body = await req.json(); } catch { /* aceita body vazio */ }

  const action = body?.action || "dashboard";
  const periodo = body?.periodo || "today";
  const customRange = body?.custom_range || null;

  try {
    if (action === "dashboard") {
      const [meta, metaCamp, google] = await Promise.all([
        buscarMetaResumo(periodo, customRange),
        buscarMetaCampanhas(periodo, customRange),
        buscarGoogle(periodo),
      ]);
      const totalHoje =
        (meta?.hoje?.spend || 0) +
        (google?.hoje?.spend || 0);
      const totalPeriodo =
        (meta?.periodo?.spend || 0) +
        (google?.periodo?.spend || 0);
      return resp(200, {
        ok: true,
        periodo, custom_range: customRange,
        totais: { hoje: totalHoje, periodo: totalPeriodo },
        meta: { ...meta, campanhas: metaCamp },
        google,
      });
    }

    if (action === "meta_set_status") {
      const { campaign_id, status } = body;
      if (!campaign_id || !["ACTIVE", "PAUSED"].includes(status)) return resp(400, { ok: false, erro: "params_invalidos" });
      const r = await metaSetStatus(campaign_id, status);
      return resp(r.ok ? 200 : 500, r);
    }

    if (action === "google_set_status") {
      const { campaign_id, status } = body;
      if (!campaign_id || !["ENABLED", "PAUSED"].includes(status)) return resp(400, { ok: false, erro: "params_invalidos" });
      const r = await googleSetStatus(campaign_id, status);
      return resp(r.ok ? 200 : 500, r);
    }

    return resp(400, { ok: false, erro: "action_desconhecida", action });
  } catch (e: any) {
    console.error("[campanhas-dashboard] erro", e);
    return resp(500, { ok: false, erro: e?.message || String(e) });
  }
});
