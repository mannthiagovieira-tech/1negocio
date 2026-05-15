// Edge Function: cowork-rodar-frente-instagram
// Etapa F3 · Cowork · ATIVO · pipeline 4 stages
//
// Stage A · captura básica · scraping_solutions/instagram-scraper-followers-following-no-cookies
// Stage B · classifica SPARSE (sem bio) · Haiku 4.5 · candidato_alvo OU descarte
// Stage C · enriquece SÓ candidatos · apify/instagram-profile-scraper (bio, business, seguidores)
// Stage D · classifica RICH (com bio) · Haiku 4.5 · 4 categorias finais
//
// Custo esperado por perfil-âncora · 1k followers:
//   Apify A · 1000 × $0.001  = $1.00
//   Haiku B · 1000 × R$0.003 = R$3.00
//   Apify C · ~200 × $0.0026 = $0.52
//   Haiku D · ~200 × R$0.003 = R$0.60
//   TOTAL · ~$1.52 + R$3.60 = ~R$11/perfil-âncora
//
// Endpoint:
//   POST /functions/v1/cowork-rodar-frente-instagram
//   Body: { apify_token?, max_followers?, only_username?, skip_pipeline? }
//   skip_pipeline=true · só captura · pula B/C/D (debug)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const APIFY_TOKEN_ENV = Deno.env.get("APIFY_TOKEN")
  ?? Deno.env.get("APIFY_API_TOKEN")
  ?? Deno.env.get("APIFY_KEY")
  ?? Deno.env.get("APIFY_API_KEY")
  ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ACTOR_FOLLOWERS = "scraping_solutions~instagram-scraper-followers-following-no-cookies";
const ACTOR_PROFILE = "apify~instagram-profile-scraper";
const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const TIMEOUT_MS = 240_000;
const BATCH_HAIKU = 10;
const BATCH_PROFILE = 50;

const VALID_FINAL = ["empresario_alvo", "investidor", "profissional", "descarte"];

// ─────────────────────────────────────────────────────────────────
// STAGE A · captura followers
// ─────────────────────────────────────────────────────────────────
async function rodarApifyFollowers(token: string, username: string, max: number): Promise<{ items: any[]; debug: any }> {
  const url = `https://api.apify.com/v2/acts/${ACTOR_FOLLOWERS}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Account: [username], resultsLimit: max, dataToScrape: "Followers" }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const txt = await r.text();
    let parsed: any = null;
    try { parsed = JSON.parse(txt); } catch { /* */ }
    const debug = { status: r.status, ok: r.ok, body_preview: txt.slice(0, 200) };
    return { items: r.ok && Array.isArray(parsed) ? parsed : [], debug };
  } catch (e) {
    clearTimeout(t);
    return { items: [], debug: { erro: (e as Error).message } };
  }
}

function mapearFollowers(items: any[], perfilOrigem: string): any[] {
  return items.map(it => {
    const u = it.username || it.userName || it.user?.username || "";
    if (!u) return null;
    const nome = it.full_name || it.fullName || it.name || it.user?.full_name || "";
    return {
      username: String(u).toLowerCase().trim(),
      nome: nome || null,
      is_verified: Boolean(it.is_verified ?? it.isVerified),
      is_private: Boolean(it.is_private ?? it.isPrivate),
      profile_url: it.profileLink || it.profile_url || `https://instagram.com/${String(u).toLowerCase().trim()}`,
      perfil_origem: perfilOrigem,
    };
  }).filter(Boolean) as any[];
}

// ─────────────────────────────────────────────────────────────────
// STAGE B · classify SPARSE (sem bio · só nome+verified)
// ─────────────────────────────────────────────────────────────────
const PROMPT_SPARSE = `Você é classificador de perfis Instagram pra plataforma 1Negócio (compra e venda de PMEs).

Tarefa · sem ter a bio, decidir se VALE A PENA enriquecer pra classificar melhor depois.

VALE ENRIQUECER (candidato=true) quando:
- Nome contém "|" indicando profissão/marca · ex: "Maria | Doceria"
- Nome menciona empresa/serviço · ex: "Studio X", "Loja Y", "@minhamarca"
- Username sugere negócio · "comerciantebrasil", "lojaderoupas"
- Verified=true (suspeita de relevância pública)
- Profissional explícito · "advogada", "psicólogo", "arquiteto", "nutri", "dr."
- Sufixo .adv, .psi, .arq no username

NÃO VALE (candidato=false) quando:
- Só nome pessoal genérico · "João Silva", "Maria Santos"
- Nome com emoji decorativo · "𝓜𝓪𝓻𝓲𝓪🦋"
- Username com numbers/underscores genérico · "joao_123", "maria__"

REGRA OURO · em dúvida, candidato=true (foco em recall · refina depois)

Saída JSON estrito: {"candidato": true|false, "motivo": "..."}`;

async function classificarSparse(p: { username: string; nome: string | null; is_verified: boolean | null; is_private: boolean | null }): Promise<{ candidato: boolean; motivo: string }> {
  try {
    const prompt = `USERNAME: @${p.username}\nNOME: ${p.nome || "—"}\nVERIFIED: ${p.is_verified ? "sim" : "não"}\nPRIVATE: ${p.is_private ? "sim" : "não"}\n\nClassifique e devolva só o JSON.`;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: HAIKU_MODEL, max_tokens: 150, system: PROMPT_SPARSE, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) return { candidato: false, motivo: `Anthropic ${res.status}` };
    const data = await res.json();
    const raw = (data.content?.[0]?.text || "").replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(raw);
    return { candidato: Boolean(parsed.candidato), motivo: String(parsed.motivo || "").slice(0, 200) };
  } catch (e) {
    return { candidato: false, motivo: String((e as Error).message).slice(0, 100) };
  }
}

// ─────────────────────────────────────────────────────────────────
// STAGE C · enriquece com profile-scraper
// ─────────────────────────────────────────────────────────────────
async function rodarApifyProfile(token: string, usernames: string[]): Promise<any[]> {
  if (!usernames.length) return [];
  const url = `https://api.apify.com/v2/acts/${ACTOR_PROFILE}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) {
      console.warn(`[profile-scraper] ${r.status} · ${(await r.text()).slice(0, 200)}`);
      return [];
    }
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn(`[profile-scraper] erro · ${(e as Error).message}`);
    return [];
  }
}

function extrairProfileEnriquecido(it: any): any {
  const u = String(it.username || "").toLowerCase().trim();
  if (!u) return null;
  return {
    username: u,
    bio: it.biography || it.bio || null,
    seguidores: Number(it.followersCount || it.followers_count || 0) || null,
    posts: Number(it.postsCount || it.posts_count || 0) || null,
    is_business: Boolean(it.isBusinessAccount ?? it.is_business_account ?? false),
    website: it.externalUrl || it.external_url || it.website || null,
    categoria: it.businessCategoryName || it.category || null,
  };
}

// ─────────────────────────────────────────────────────────────────
// STAGE D · classify RICH (com bio · 4 categorias finais)
// ─────────────────────────────────────────────────────────────────
const PROMPT_RICH = `Você é classificador de perfis Instagram pra plataforma 1Negócio (compra e venda de PMEs).

Tarefa · com bio + flags business + seguidores · classifica em 1 das 4 categorias:

1. empresario_alvo · DONO de PME / negócio físico (alvo de VENDA)
   Sinais · "CEO da X", "fundador", "sócio", restaurante, padaria, clínica, oficina, mercado, salão, escritório próprio, "empreendedor", marca própria, e-commerce, loja, conta business com produto/serviço

2. investidor · pessoa que INVESTE / COMPRA empresas
   Sinais · "investidor", "M&A", "private equity", "venture capital", "angel", "family office", "holding", "compro empresas", "consultor M&A"

3. profissional · funcionário CLT, autônomo, profissional liberal
   Sinais · cargo em empresa de outro ("dev na X"), profissão isolada SEM marca/empresa própria, advogada autônoma, médico CLT, dentista CRM

4. descarte · pessoal sem viés business / fake / criança / atleta / influencer puro / fora do BR
   Sinais · só fotos pessoais, sem bio profissional, perfil de fã, < 18 anos, gringo sem operação BR

REGRAS:
- Saída JSON estrito: {"categoria":"...","motivo":"..."}
- "motivo" max 120 chars em PT-BR
- Em dúvida empresario_alvo vs profissional · vai de profissional
- Em dúvida profissional vs descarte · vai de descarte
- is_business=true + bio com produto/serviço · forte sinal pra empresario_alvo`;

async function classificarRich(p: any): Promise<{ categoria: string; motivo: string }> {
  try {
    const prompt = `USERNAME: @${p.username}\nNOME: ${p.nome || "—"}\nBIO: ${p.bio || "—"}\nBUSINESS: ${p.is_business ? "sim" : "não"}\nVERIFICADO: ${p.is_verified ? "sim" : "não"}\nSEGUIDORES: ${p.seguidores ?? "—"}\nCATEGORIA IG: ${p.categoria || "—"}\nWEBSITE: ${p.website || "—"}\n\nClassifique e devolva só o JSON.`;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: HAIKU_MODEL, max_tokens: 200, system: PROMPT_RICH, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) return { categoria: "descarte", motivo: `Anthropic ${res.status}` };
    const data = await res.json();
    const raw = (data.content?.[0]?.text || "").replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(raw);
    const cat = String(parsed.categoria || "").trim();
    return VALID_FINAL.includes(cat)
      ? { categoria: cat, motivo: String(parsed.motivo || "").slice(0, 200) }
      : { categoria: "descarte", motivo: "categoria inválida" };
  } catch (e) {
    return { categoria: "descarte", motivo: String((e as Error).message).slice(0, 100) };
  }
}

// ─────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────
async function processarLotes<T, R>(items: T[], size: number, fn: (i: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const lote = items.slice(i, i + size);
    out.push(...(await Promise.all(lote.map(fn))));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));
    const apifyToken = body?.apify_token || APIFY_TOKEN_ENV;
    const maxFollowers = Math.min(Math.max(parseInt(body?.max_followers) || 1000, 100), 5000);
    const skipPipeline = Boolean(body?.skip_pipeline);
    if (!apifyToken) return jsonErr("APIFY_TOKEN não configurado");

    let perfis: any[] = [];
    if (body?.only_username) {
      const { data } = await supabase.from("ig_perfis_ancora")
        .select("id,username,descricao,total_followers_capturados").eq("username", body.only_username).maybeSingle();
      if (data) perfis = [data];
    } else {
      const { data } = await supabase.from("ig_perfis_ancora")
        .select("id,username,descricao,ultima_captura,total_followers_capturados").eq("ativo", true)
        .order("ultima_captura", { ascending: true, nullsFirst: true })
        .limit(20);
      perfis = data || [];
    }
    if (!perfis.length) return jsonErr("nenhum perfil-âncora ativo", 404);

    const resumo: any[] = [];

    for (const p of perfis) {
      const t0 = Date.now();
      const stages: any = {};

      // STAGE A · captura
      const { items, debug: debugA } = await rodarApifyFollowers(apifyToken, p.username, maxFollowers);
      const followers = mapearFollowers(items, p.username);
      let inseridos = 0;
      let insertErro = "";
      if (followers.length) {
        const { data: ins, error: insErr } = await supabase
          .from("ig_seguidores_raw")
          .upsert(followers, { onConflict: "username", ignoreDuplicates: true })
          .select("id");
        if (insErr) insertErro = `${insErr.code || ""}: ${insErr.message}`.slice(0, 200);
        inseridos = ins?.length ?? 0;
      }
      stages.a_captura = { count: followers.length, ms: Date.now() - t0, ...debugA, salvos: inseridos, ...(insertErro ? { insert_erro: insertErro } : {}) };

      if (skipPipeline) {
        await supabase.from("ig_perfis_ancora").update({
          ultima_captura: new Date().toISOString(),
          total_followers_capturados: (p.total_followers_capturados || 0) + inseridos,
        }).eq("id", p.id);
        resumo.push({ username: p.username, duracao_ms: Date.now() - t0, stages });
        continue;
      }

      // STAGE B · classify SPARSE
      const tB = Date.now();
      const { data: pendentesB } = await supabase.from("ig_seguidores_raw")
        .select("id,username,nome,is_verified,is_private")
        .eq("perfil_origem", p.username)
        .is("classificacao_ia", null);
      const sparse = await processarLotes(pendentesB || [], BATCH_HAIKU, async (row: any) => {
        const c = await classificarSparse(row);
        return { id: row.id, username: row.username, candidato: c.candidato };
      });
      const candidatos = sparse.filter(s => s.candidato);
      const descartesB = sparse.filter(s => !s.candidato);
      // bulk update descartes
      if (descartesB.length) {
        await supabase.from("ig_seguidores_raw")
          .update({ classificacao_ia: "descarte", classificacao_etapa: 1 })
          .in("id", descartesB.map(d => d.id));
      }
      // bulk update candidatos (transitional state)
      if (candidatos.length) {
        await supabase.from("ig_seguidores_raw")
          .update({ classificacao_ia: "candidato_alvo", classificacao_etapa: 1 })
          .in("id", candidatos.map(c => c.id));
      }
      stages.b_sparse = { total: sparse.length, candidatos: candidatos.length, descartes: descartesB.length, ms: Date.now() - tB };

      // STAGE C · enriquece candidatos
      const tC = Date.now();
      const usernamesEnrich = candidatos.map(c => c.username);
      const enrichedItems = await rodarApifyProfile(apifyToken, usernamesEnrich);
      const mapEnriched = new Map<string, any>();
      for (const it of enrichedItems) {
        const e = extrairProfileEnriquecido(it);
        if (e) mapEnriched.set(e.username, e);
      }
      // update DB com bio/seguidores/etc
      let enriquecidos = 0;
      for (const c of candidatos) {
        const e = mapEnriched.get(c.username);
        if (e) {
          await supabase.from("ig_seguidores_raw").update({
            bio: e.bio,
            seguidores: e.seguidores,
            posts: e.posts,
            is_business: e.is_business,
            website: e.website,
            categoria: e.categoria,
            enriquecido: true,
          }).eq("id", c.id);
          enriquecidos++;
        }
      }
      stages.c_enrich = { tentados: candidatos.length, enriquecidos, ms: Date.now() - tC };

      // STAGE D · classify RICH
      const tD = Date.now();
      const { data: pendentesD } = await supabase.from("ig_seguidores_raw")
        .select("id,username,nome,bio,is_business,is_verified,seguidores,categoria,website")
        .eq("perfil_origem", p.username)
        .eq("classificacao_ia", "candidato_alvo")
        .eq("enriquecido", true);
      const rich = await processarLotes(pendentesD || [], BATCH_HAIKU, async (row: any) => {
        const c = await classificarRich(row);
        await supabase.from("ig_seguidores_raw").update({
          classificacao_ia: c.categoria,
          classificacao_etapa: 2,
        }).eq("id", row.id);
        return { categoria: c.categoria };
      });
      const distFinal: Record<string, number> = {};
      rich.forEach(r => { distFinal[r.categoria] = (distFinal[r.categoria] || 0) + 1; });
      stages.d_rich = { total: rich.length, por_categoria: distFinal, ms: Date.now() - tD };

      // candidatos não enriquecidos ficam em candidato_alvo · classificacao_etapa=1
      // (admin pode rerun)
      stages.candidatos_sem_enrich = candidatos.length - enriquecidos;

      // atualiza perfil-âncora
      await supabase.from("ig_perfis_ancora").update({
        ultima_captura: new Date().toISOString(),
        total_followers_capturados: (p.total_followers_capturados || 0) + inseridos,
      }).eq("id", p.id);

      resumo.push({ username: p.username, duracao_ms: Date.now() - t0, stages });
    }

    return jsonOk({
      ok: true,
      perfis_processados: perfis.length,
      detalhe: resumo,
    });
  } catch (e) {
    console.error("[cowork-rodar-frente-instagram]", e);
    return jsonErr(String((e as Error).message || e), 500);
  }
});

function jsonOk(p: unknown) { return new Response(JSON.stringify(p), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
function jsonErr(e: string, s = 400) { return new Response(JSON.stringify({ ok: false, erro: e }), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
