// Edge Function: classificar-likers
// F8 PIVOTE · pipeline 4-stage adaptado pra ig_likers
//
// Stage A · captura · feita por monitorar-post-likers
// Stage B · classify SPARSE (sem bio) · candidato_alvo OR descarte
// Stage C · enriquece SÓ candidatos · apify/instagram-profile-scraper
// Stage D · classify RICH (com bio) · 4 categorias finais
//
// OTIMIZAÇÃO is_private=true skip antes Stage B (economia R$ 200-300/mês)
//
// Endpoint:
//   POST /functions/v1/classificar-likers
//   Body: { post_id?, limit?, only_username?, skip_private?: bool (default true) }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const APIFY_TOKEN = Deno.env.get("APIFY_TOKEN")
  ?? Deno.env.get("APIFY_API_TOKEN")
  ?? Deno.env.get("APIFY_KEY")
  ?? Deno.env.get("APIFY_API_KEY")
  ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ACTOR_PROFILE = "apify~instagram-profile-scraper";
const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const TIMEOUT_MS = 240_000;
const BATCH_HAIKU = 10;

const VALID_FINAL = ["empresario_alvo", "investidor", "profissional", "descarte"];

const PROMPT_SPARSE = `Você é classificador de likers Instagram pra plataforma 1Negócio (compra e venda de PMEs).

Tarefa · sem ter a bio, decidir se VALE A PENA enriquecer pra classificar melhor depois.

VALE ENRIQUECER (candidato=true) quando:
- Nome contém "|" indicando profissão/marca · ex: "Maria | Doceria"
- Nome menciona empresa/serviço · ex: "Studio X", "Loja Y"
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

const PROMPT_RICH = `Você é classificador de likers Instagram pra plataforma 1Negócio (compra e venda de PMEs).

Contexto · esse perfil curtiu post de concorrente sobre venda/compra de empresa. ALTA chance de interesse.

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

async function classificarSparse(p: { username: string; full_name: string | null; is_verified: boolean; is_private: boolean }): Promise<{ candidato: boolean; motivo: string }> {
  try {
    const prompt = `USERNAME: @${p.username}\nNOME: ${p.full_name || "—"}\nVERIFIED: ${p.is_verified ? "sim" : "não"}\nPRIVATE: ${p.is_private ? "sim" : "não"}\n\nClassifique e devolva só o JSON.`;
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

async function classificarRich(p: any): Promise<{ categoria: string; motivo: string }> {
  try {
    const prompt = `USERNAME: @${p.username}\nNOME: ${p.full_name || "—"}\nBIO: ${p.bio || "—"}\nBUSINESS: ${p.is_business ? "sim" : "não"}\nVERIFICADO: ${p.is_verified ? "sim" : "não"}\nSEGUIDORES: ${p.followers_count ?? "—"}\nCATEGORIA IG: ${p.categoria_ig || "—"}\nWEBSITE: ${p.external_url || "—"}\n\nClassifique e devolva só o JSON.`;
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

async function rodarApifyProfile(usernames: string[]): Promise<any[]> {
  if (!usernames.length) return [];
  const url = `https://api.apify.com/v2/acts/${ACTOR_PROFILE}/run-sync-get-dataset-items?token=${encodeURIComponent(APIFY_TOKEN)}`;
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
    followers_count: Number(it.followersCount || it.followers_count || 0) || null,
    posts_count: Number(it.postsCount || it.posts_count || 0) || null,
    is_business: Boolean(it.isBusinessAccount ?? it.is_business_account ?? false),
    external_url: it.externalUrl || it.external_url || it.website || null,
    categoria_ig: it.businessCategoryName || it.category || null,
  };
}

async function processarLotes<T, R>(items: T[], size: number, fn: (i: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const lote = items.slice(i, i + size);
    out.push(...(await Promise.all(lote.map(fn))));
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(parseInt(body?.limit) || 1000, 1), 5000);
    const skipPrivate = body?.skip_private !== false;

    let q = supabase.from("ig_likers")
      .select("id,username,full_name,is_verified,is_private,post_id")
      .is("classificacao_ia", null)
      .limit(limit);
    if (body?.post_id) q = q.eq("post_id", body.post_id);
    if (body?.only_username) q = q.eq("username", body.only_username);

    const { data: pendentes, error: errLer } = await q;
    if (errLer) return jsonErr("erro lendo likers: " + errLer.message, 500);
    if (!pendentes?.length) return jsonOk({ ok: true, classificados: 0, motivo: "nenhum liker pendente" });

    const tInicio = Date.now();
    const stages: any = {};

    // ─────────────────────────────────────────────────────────────
    // STAGE B0 · skip is_private=true como descarte heurístico
    // ─────────────────────────────────────────────────────────────
    const tB0 = Date.now();
    const privates = skipPrivate ? pendentes.filter(p => p.is_private) : [];
    const naoPrivate = skipPrivate ? pendentes.filter(p => !p.is_private) : pendentes;
    if (privates.length) {
      await supabase.from("ig_likers")
        .update({ classificacao_ia: "descarte", classificacao_etapa: 1 })
        .in("id", privates.map(p => p.id));
    }
    stages.b0_skip_private = { skipados: privates.length, ms: Date.now() - tB0 };

    // ─────────────────────────────────────────────────────────────
    // STAGE B · classify SPARSE
    // ─────────────────────────────────────────────────────────────
    const tB = Date.now();
    const sparse = await processarLotes(naoPrivate, BATCH_HAIKU, async (row: any) => {
      const c = await classificarSparse(row);
      return { id: row.id, username: row.username, candidato: c.candidato };
    });
    const candidatos = sparse.filter(s => s.candidato);
    const descartesB = sparse.filter(s => !s.candidato);
    if (descartesB.length) {
      await supabase.from("ig_likers")
        .update({ classificacao_ia: "descarte", classificacao_etapa: 1 })
        .in("id", descartesB.map(d => d.id));
    }
    if (candidatos.length) {
      await supabase.from("ig_likers")
        .update({ classificacao_ia: "candidato_alvo", classificacao_etapa: 1 })
        .in("id", candidatos.map(c => c.id));
    }
    stages.b_sparse = { total: sparse.length, candidatos: candidatos.length, descartes: descartesB.length, ms: Date.now() - tB };

    // ─────────────────────────────────────────────────────────────
    // STAGE C · enriquece candidatos
    // ─────────────────────────────────────────────────────────────
    const tC = Date.now();
    const usernamesEnrich = candidatos.map(c => c.username);
    const enrichedItems = await rodarApifyProfile(usernamesEnrich);
    const mapEnriched = new Map<string, any>();
    for (const it of enrichedItems) {
      const e = extrairProfileEnriquecido(it);
      if (e) mapEnriched.set(e.username, e);
    }
    let enriquecidos = 0;
    for (const c of candidatos) {
      const e = mapEnriched.get(c.username);
      if (e) {
        await supabase.from("ig_likers").update({
          bio: e.bio,
          followers_count: e.followers_count,
          posts_count: e.posts_count,
          is_business: e.is_business,
          external_url: e.external_url,
          categoria_ig: e.categoria_ig,
          enriquecido: true,
        }).eq("id", c.id);
        enriquecidos++;
      }
    }
    stages.c_enrich = { tentados: candidatos.length, enriquecidos, ms: Date.now() - tC };

    // ─────────────────────────────────────────────────────────────
    // STAGE D · classify RICH
    // ─────────────────────────────────────────────────────────────
    const tD = Date.now();
    const idsCandidatos = candidatos.map(c => c.id);
    let pendentesD: any[] = [];
    if (idsCandidatos.length) {
      const { data } = await supabase.from("ig_likers")
        .select("id,username,full_name,bio,is_business,is_verified,followers_count,categoria_ig,external_url")
        .in("id", idsCandidatos)
        .eq("enriquecido", true);
      pendentesD = data || [];
    }
    const rich = await processarLotes(pendentesD, BATCH_HAIKU, async (row: any) => {
      const c = await classificarRich(row);
      await supabase.from("ig_likers").update({
        classificacao_ia: c.categoria,
        classificacao_etapa: 2,
      }).eq("id", row.id);
      return { categoria: c.categoria };
    });
    const distFinal: Record<string, number> = {};
    rich.forEach(r => { distFinal[r.categoria] = (distFinal[r.categoria] || 0) + 1; });
    stages.d_rich = { total: rich.length, por_categoria: distFinal, ms: Date.now() - tD };

    stages.candidatos_sem_enrich = candidatos.length - enriquecidos;
    stages.duracao_total_ms = Date.now() - tInicio;

    return jsonOk({
      ok: true,
      total_pendentes: pendentes.length,
      private_skipados: privates.length,
      processados_haiku: naoPrivate.length,
      candidatos_aprovados: candidatos.length,
      classificados_finais: rich.length,
      stages,
    });
  } catch (e) {
    console.error("[classificar-likers]", e);
    return jsonErr(String((e as Error).message || e), 500);
  }
});

function jsonOk(p: unknown) { return new Response(JSON.stringify(p), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
function jsonErr(e: string, s = 400) { return new Response(JSON.stringify({ ok: false, erro: e }), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
