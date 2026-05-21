// criar-campanha-meta · v1 · Lead Gen
// Fluxo: fetch imagem → adimages → leadgen_form → campaign → adset → creative → ad → projeto_ads
// Tudo criado em status PAUSED. Admin ativa manualmente pela UI.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const META_TOKEN = Deno.env.get("META_ACCESS_TOKEN") || "";
const PRIVACY_URL = Deno.env.get("META_PRIVACY_URL") || "https://1negocio.com.br/termo-sigilo.html";

const AD_ACCOUNT_ID = "act_983335024007752";
const PAGE_ID = "612525678608107";
const INSTAGRAM_ACTOR_ID = "17841472978111882"; // @1negocio_
const GRAPH = "https://graph.facebook.com/v23.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function resp(s: number, b: unknown) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}

async function metaPOST(path: string, body: Record<string, any>): Promise<any> {
  const url = `${GRAPH}${path}`;
  const fd = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    fd.append(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  fd.append("access_token", META_TOKEN);
  const r = await fetch(url, { method: "POST", body: fd });
  const txt = await r.text();
  let data: any = null;
  try { data = JSON.parse(txt); } catch { /* texto bruto */ }
  if (!r.ok) {
    throw new Error(`Meta API ${path} status ${r.status}: ${txt.slice(0, 500)}`);
  }
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return resp(405, { ok: false, erro: "method_not_allowed" });
  if (!META_TOKEN) return resp(500, { ok: false, erro: "META_ACCESS_TOKEN_nao_configurado" });

  let body: any;
  try { body = await req.json(); } catch { return resp(400, { ok: false, erro: "json_invalido" }); }

  const {
    negocio_id,
    projeto_metadata_id,
    imagem_url,
    primary_text,
    headline,
    descricao_form,
    url_destino,
    publico,           // { age_min, age_max, genero }
    orcamento_diario,  // R$
    duracao_dias,
    nome_campanha,
  } = body || {};

  if (!negocio_id || !projeto_metadata_id) return resp(400, { ok: false, erro: "ids_obrigatorios" });
  if (!imagem_url) return resp(400, { ok: false, erro: "imagem_url_obrigatoria" });
  if (!primary_text || !headline) return resp(400, { ok: false, erro: "copy_obrigatoria" });
  if (!orcamento_diario || orcamento_diario < 5) return resp(400, { ok: false, erro: "orcamento_min_R$5" });
  if (!duracao_dias || duracao_dias < 1) return resp(400, { ok: false, erro: "duracao_min_1_dia" });

  const admin = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

  try {
    // 1. Fetch da imagem e upload pro ad library (multipart)
    const imgResp = await fetch(imagem_url);
    if (!imgResp.ok) throw new Error(`fetch imagem falhou: ${imgResp.status}`);
    const imgBlob = await imgResp.blob();

    const imgForm = new FormData();
    imgForm.append("source", imgBlob, "ad-image.png");
    imgForm.append("access_token", META_TOKEN);
    const upImg = await fetch(`${GRAPH}/${AD_ACCOUNT_ID}/adimages`, { method: "POST", body: imgForm });
    const upTxt = await upImg.text();
    if (!upImg.ok) throw new Error(`adimages upload ${upImg.status}: ${upTxt.slice(0, 500)}`);
    const upData = JSON.parse(upTxt);
    const firstKey = Object.keys(upData.images || {})[0];
    const image_hash = upData.images?.[firstKey]?.hash;
    if (!image_hash) throw new Error("adimages sem hash retornado");

    // 2. Criar Lead Gen Form na página
    const formData = await metaPOST(`/${PAGE_ID}/leadgen_forms`, {
      name: `Form 1N · ${(nome_campanha || "").slice(0, 40)} · ${Date.now()}`,
      locale: "pt_BR",
      questions: [
        { type: "FULL_NAME" },
        { type: "PHONE" },
      ],
      privacy_policy: { url: PRIVACY_URL, link_text: "Política de Privacidade · 1Negócio" },
      follow_up_action_url: url_destino || "https://1negocio.com.br/",
      context_card: {
        title: (headline || "").slice(0, 60),
        content: [(primary_text || "").slice(0, 200)],
        button_text: "Quero saber mais",
        style: "PARAGRAPH_STYLE",
      },
    });
    const leadgen_form_id = formData?.id;
    if (!leadgen_form_id) throw new Error("leadgen_form sem id");

    // 3. Criar campanha PAUSED
    const camp = await metaPOST(`/${AD_ACCOUNT_ID}/campaigns`, {
      name: nome_campanha,
      objective: "OUTCOME_LEADS",
      status: "PAUSED",
      special_ad_categories: [],
      is_adset_budget_sharing_enabled: false,
    });
    const campanha_meta_id = camp?.id;
    if (!campanha_meta_id) throw new Error("campanha sem id");

    // 4. Criar adset PAUSED
    const ageMin = Math.max(18, parseInt(publico?.age_min || 25, 10));
    const ageMax = Math.min(65, parseInt(publico?.age_max || 55, 10));
    const genero = publico?.genero || "all";
    const genders = genero === "homens" ? [1] : genero === "mulheres" ? [2] : undefined;

    const now = new Date();
    const startTime = new Date(now.getTime() + 2 * 60 * 1000).toISOString(); // +2 min
    const endTime = new Date(now.getTime() + parseInt(duracao_dias, 10) * 24 * 60 * 60 * 1000).toISOString();

    const targeting: any = {
      geo_locations: { countries: ["BR"] },
      age_min: ageMin,
      age_max: ageMax,
      publisher_platforms: ["facebook", "instagram"],
      facebook_positions: ["feed", "marketplace", "story"],
      instagram_positions: ["stream", "story", "explore", "reels"],
      targeting_automation: { advantage_audience: 0 },
    };
    if (genders) targeting.genders = genders;

    const adset = await metaPOST(`/${AD_ACCOUNT_ID}/adsets`, {
      name: `Adset · ${nome_campanha}`,
      campaign_id: campanha_meta_id,
      daily_budget: Math.round(parseFloat(orcamento_diario) * 100), // BRL → centavos
      billing_event: "IMPRESSIONS",
      optimization_goal: "LEAD_GENERATION",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      destination_type: "ON_AD",
      promoted_object: { page_id: PAGE_ID },
      targeting,
      start_time: startTime,
      end_time: endTime,
      status: "PAUSED",
    });
    const adset_meta_id = adset?.id;
    if (!adset_meta_id) throw new Error("adset sem id");

    // 5. Criar creative
    const creative = await metaPOST(`/${AD_ACCOUNT_ID}/adcreatives`, {
      name: `Creative · ${nome_campanha}`,
      object_story_spec: {
        page_id: PAGE_ID,
        instagram_actor_id: INSTAGRAM_ACTOR_ID,
        link_data: {
          image_hash,
          link: url_destino || "https://1negocio.com.br/",
          message: primary_text,
          name: headline,
          call_to_action: {
            type: "SIGN_UP",
            value: { lead_gen_form_id: leadgen_form_id },
          },
        },
      },
    });
    const creative_id = creative?.id;
    if (!creative_id) throw new Error("creative sem id");

    // 6. Criar ad PAUSED
    const ad = await metaPOST(`/${AD_ACCOUNT_ID}/ads`, {
      name: `Ad · ${nome_campanha}`,
      adset_id: adset_meta_id,
      creative: { creative_id },
      status: "PAUSED",
    });
    const ad_meta_id = ad?.id;
    if (!ad_meta_id) throw new Error("ad sem id");

    // 7. Persistir em projeto_ads
    const { data: row, error: insErr } = await admin
      .from("projeto_ads")
      .insert({
        projeto_metadata_id,
        negocio_id,
        campanha_meta_id,
        adset_meta_id,
        ad_meta_id,
        leadgen_form_id,
        nome: nome_campanha,
        status: "PAUSED",
        orcamento_diario: parseFloat(orcamento_diario),
        duracao_dias: parseInt(duracao_dias, 10),
        inicio_em: startTime.slice(0, 10),
        fim_em: endTime.slice(0, 10),
        imagem_url,
        primary_text,
        headline,
        url_destino,
        publico_jsonb: publico || {},
      })
      .select()
      .single();

    if (insErr) console.error("[projeto_ads insert]", insErr);

    return resp(200, {
      ok: true,
      campanha_id: campanha_meta_id,
      adset_id: adset_meta_id,
      ad_id: ad_meta_id,
      leadgen_form_id,
      image_hash,
      projeto_ads_id: row?.id || null,
      status: "PAUSED",
    });
  } catch (e: any) {
    console.error("[criar-campanha-meta] erro:", e);
    return resp(500, { ok: false, erro: "falha_meta_api", detalhe: e?.message || String(e) });
  }
});
