// Edge Function: monitorar-post-likers
// F8 PIVOTE · captura likers de posts de concorrentes
//
// Stage A · captura via Apify (data-slayer/instagram-likes)
// Salva em ig_likers (UNIQUE post_id+username)
// Atualiza ig_posts_monitorados.ultima_captura + proxima_captura
//
// NÃO classifica aqui · classificação separada via classificar-likers
//
// Endpoint:
//   POST /functions/v1/monitorar-post-likers
//   Body: { force_postcode?: string, only_post_id?: uuid, limit?: number, max_posts?: number }
//   force_postcode · roda 1 post sem cadastrar (smoke test)
//   only_post_id   · roda 1 post cadastrado pelo UUID
//   default         · roda todos os ativos onde proxima_captura <= NOW()

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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

const ACTOR = "data-slayer~instagram-likes";
const ACTOR_PROFILE = "apify~instagram-profile-scraper";
const TIMEOUT_MS = 240_000;

// busca último post de um username via apify/instagram-profile-scraper (latestPosts)
async function buscarUltimoPostUsername(username: string): Promise<{ shortcode: string | null; debug: any }> {
  if (!APIFY_TOKEN) return { shortcode: null, debug: { erro: "no token" } };
  const url = `https://api.apify.com/v2/acts/${ACTOR_PROFILE}/run-sync-get-dataset-items?token=${encodeURIComponent(APIFY_TOKEN)}`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [username], resultsLimit: 1 }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const txt = await r.text();
    let parsed: any = null;
    try { parsed = JSON.parse(txt); } catch { /* */ }
    if (!r.ok || !Array.isArray(parsed) || !parsed[0]) {
      return { shortcode: null, debug: { status: r.status, body: txt.slice(0, 300) } };
    }
    const profile = parsed[0];
    const post = profile.latestPosts?.[0] || profile.posts?.[0] || null;
    const sc = post?.shortCode || post?.shortcode || (post?.url ? post.url.match(/\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/)?.[1] : null);
    return { shortcode: sc || null, debug: { username, total_posts: profile.latestPosts?.length || 0, post_url: post?.url } };
  } catch (e) {
    return { shortcode: null, debug: { erro: (e as Error).message } };
  }
}

function shortcodeFromUrl(s: string): string {
  if (!s) return "";
  // aceita URL completa ou só shortcode
  const m = s.match(/instagram\.com\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]+$/.test(s.trim())) return s.trim();
  return "";
}

async function rodarApify(postCode: string): Promise<{ items: any[]; debug: any }> {
  const url = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(APIFY_TOKEN)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postCode }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const txt = await r.text();
    let parsed: any = null;
    try { parsed = JSON.parse(txt); } catch { /* */ }
    const debug = {
      status: r.status,
      ok: r.ok,
      actor: ACTOR,
      content_type: r.headers.get("content-type"),
      body_preview: txt.slice(0, 800),
      shape_first_item: Array.isArray(parsed) && parsed[0] ? Object.keys(parsed[0]).slice(0, 30) : null,
    };
    if (!r.ok) return { items: [], debug };
    return { items: Array.isArray(parsed) ? parsed : [], debug };
  } catch (e) {
    clearTimeout(t);
    return { items: [], debug: { erro: (e as Error).message, actor: ACTOR } };
  }
}

function mapearLiker(it: any, postId: string | null, shortcode: string, categoria: string | null): any {
  const u = it.username || it.userName || it.user?.username || "";
  if (!u) return null;
  return {
    post_id: postId,
    shortcode_post: shortcode,
    categoria_post: categoria,
    username: String(u).toLowerCase().trim(),
    full_name: it.full_name || it.fullName || it.name || it.user?.full_name || null,
    bio: it.biography || it.bio || it.user?.biography || null,
    profile_pic_url: it.profile_pic_url || it.profilePicUrl || it.user?.profile_pic_url || null,
    is_verified: Boolean(it.is_verified ?? it.isVerified ?? it.user?.is_verified ?? false),
    is_business: Boolean(it.is_business ?? it.isBusinessAccount ?? it.user?.is_business ?? false),
    is_private: Boolean(it.is_private ?? it.isPrivate ?? it.user?.is_private ?? false),
    followers_count: Number(it.followers_count || it.followersCount || it.user?.followers_count || 0) || null,
    posts_count: Number(it.posts_count || it.postsCount || it.user?.media_count || 0) || null,
    external_url: it.external_url || it.externalUrl || it.user?.external_url || it.website || null,
    categoria_ig: it.business_category_name || it.businessCategoryName || it.category || null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));
    if (!APIFY_TOKEN) return jsonErr("APIFY_TOKEN não configurado");

    // 3 modos: force_postcode (smoke ad-hoc), only_post_id (1 cadastrado), default (rotação)
    let posts: any[] = [];
    let descobertaDebug: any = null;
    if (body?.from_username) {
      // descobre último post via profile-scraper · usado no smoke
      const username = String(body.from_username).replace(/^@/, '').trim();
      const r = await buscarUltimoPostUsername(username);
      descobertaDebug = r.debug;
      if (!r.shortcode) return jsonErr(`não achou post recente de @${username} · debug: ${JSON.stringify(r.debug).slice(0, 300)}`);
      posts = [{ id: null, shortcode: r.shortcode, url: `https://instagram.com/p/${r.shortcode}/`, concorrente: username, categoria: "smoke", _smoke: true, frequencia_dias: 1 }];
    } else if (body?.force_postcode) {
      const sc = shortcodeFromUrl(body.force_postcode);
      if (!sc) return jsonErr("postcode inválido (cole URL ou shortcode)");
      posts = [{ id: null, shortcode: sc, url: `https://instagram.com/p/${sc}/`, concorrente: "smoke", categoria: "smoke", _smoke: true, frequencia_dias: 1 }];
    } else if (body?.only_post_id) {
      const { data, error: errSel } = await supabase.from("ig_posts_monitorados")
        .select("id,url,shortcode,concorrente,categoria,frequencia_dias,total_likers_capturados,apelido")
        .eq("id", body.only_post_id).maybeSingle();
      if (errSel) return jsonErr(`select erro: ${errSel.message}`, 500);
      if (!data) return jsonErr("post não encontrado", 404);
      posts = [data];
    } else {
      const maxPosts = Math.min(Math.max(parseInt(body?.max_posts) || 10, 1), 50);
      const { data } = await supabase.from("ig_posts_monitorados")
        .select("id,url,shortcode,concorrente,categoria,frequencia_dias,total_likers_capturados")
        .eq("ativo", true)
        .lte("proxima_captura", new Date().toISOString())
        .order("proxima_captura", { ascending: true, nullsFirst: true })
        .limit(maxPosts);
      posts = data || [];
    }
    if (!posts.length) return jsonOk({ ok: true, posts_processados: 0, motivo: "nenhum post pendente" });

    const limit = Math.min(Math.max(parseInt(body?.limit) || 500, 10), 5000);

    const resumo: any[] = [];
    for (const post of posts) {
      const t0 = Date.now();
      const sc = post.shortcode || shortcodeFromUrl(post.url);
      if (!sc) {
        resumo.push({ post_id: post.id, erro: "shortcode ausente · cadastra URL completo" });
        continue;
      }
      const { items, debug } = await rodarApify(sc);

      const likers = items.map(it => mapearLiker(it, post.id, sc, post.categoria))
        .filter(Boolean) as any[];
      // limita pra evitar inserts gigantes
      const likersLimit = likers.slice(0, limit);

      let inseridos = 0;
      let insertErro = "";
      if (likersLimit.length && post.id) {
        const { data: ins, error: insErr } = await supabase
          .from("ig_likers")
          .upsert(likersLimit, { onConflict: "post_id,username", ignoreDuplicates: true })
          .select("id");
        if (insErr) insertErro = `${insErr.code || ""}: ${insErr.message}`.slice(0, 200);
        inseridos = ins?.length ?? 0;
      } else if (likersLimit.length && post._smoke) {
        // smoke sem post_id · não persiste · só valida shape
        inseridos = 0;
      }

      // atualiza ig_posts_monitorados
      if (post.id) {
        const proxima = new Date(Date.now() + (post.frequencia_dias || 1) * 86400000).toISOString();
        await supabase.from("ig_posts_monitorados").update({
          ultima_captura: new Date().toISOString(),
          proxima_captura: proxima,
          total_likers_capturados: (post.total_likers_capturados || 0) + inseridos,
        }).eq("id", post.id);
      }

      resumo.push({
        post_id: post.id,
        shortcode: sc,
        concorrente: post.concorrente,
        capturados: likers.length,
        salvos_no_banco: inseridos,
        duracao_ms: Date.now() - t0,
        smoke: Boolean(post._smoke),
        apify_debug: debug,
        ...(insertErro ? { insert_erro: insertErro } : {}),
        ...(post._smoke && likersLimit[0] ? { sample_liker: likersLimit[0] } : {}),
      });
    }

    return jsonOk({
      ok: true,
      posts_processados: posts.length,
      total_capturados: resumo.reduce((s, r) => s + (r.capturados || 0), 0),
      total_salvos: resumo.reduce((s, r) => s + (r.salvos_no_banco || 0), 0),
      detalhe: resumo,
      proximo_passo: "POST /functions/v1/classificar-likers pra rodar pipeline 4-stage",
    });
  } catch (e) {
    console.error("[monitorar-post-likers]", e);
    return jsonErr(String((e as Error).message || e), 500);
  }
});

function jsonOk(p: unknown) { return new Response(JSON.stringify(p), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
function jsonErr(e: string, s = 400) { return new Response(JSON.stringify({ ok: false, erro: e }), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
