// originacao-buscar-social · v9.33.7
// Edge consolidada · 5 sub-canais via switch interno.
// Substitui originacao-buscar-facebook + originacao-buscar-instagram (deletadas · 2 slots liberados).
//
// POST body:
//   { originacao_id: uuid, canal: 'fb_grupos'|'ig_influenciadores'|'ig_corretores'|'ig_clientes'|'eventos',
//     arquetipo_id?: uuid, negocio_instagram?: string }
// Output: { ok, canal, por_arquetipo[], total_inseridos, custo_apify_brl_estimado }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APIFY_TOKEN = Deno.env.get("APIFY_TOKEN") || "";

const ACTOR_FB_GROUPS = "apify~facebook-groups-scraper";
const ACTOR_IG = "apify~instagram-scraper";

const APIFY_TIMEOUT_PRIMARY_MS = 120_000;
const APIFY_TIMEOUT_RETRY_MS = 90_000;

const CUSTO_POR_QUERY: Record<string, number> = {
  fb_grupos: 0.40,
  ig_influenciadores: 0.30,
  ig_corretores: 0.20,
  ig_clientes: 0.50,
  eventos: 0.15,
};

const CANAL_DB: Record<string, { canal_uso: string; fonte: string; categoria: string }> = {
  fb_grupos:          { canal_uso: "facebook",  fonte: "apify_facebook",  categoria: "grupo_setorial" },
  ig_influenciadores: { canal_uso: "instagram", fonte: "apify_instagram", categoria: "influenciador" },
  ig_corretores:      { canal_uso: "instagram", fonte: "apify_instagram", categoria: "corretor_local" },
  ig_clientes:        { canal_uso: "instagram", fonte: "apify_instagram", categoria: "cliente_negocio" },
  eventos:            { canal_uso: "interno",   fonte: "manual_admin",    categoria: "evento_setor" },
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function resp(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function chamarApify(actor: string, input: any, timeoutMs: number): Promise<{ ok: boolean; items?: any[]; erro?: string }> {
  const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${APIFY_TOKEN}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (r.status === 401) return { ok: false, erro: "apify_token_invalido" };
    if (r.status === 429) return { ok: false, erro: "apify_rate_limit" };
    if (!r.ok) {
      const errTxt = await r.text();
      return { ok: false, erro: `apify_status_${r.status} · ${errTxt.slice(0, 200)}` };
    }
    const items = await r.json();
    if (!Array.isArray(items)) return { ok: false, erro: "apify_resposta_invalida" };
    return { ok: true, items };
  } catch (e: any) {
    clearTimeout(timer);
    if (e.name === "AbortError") return { ok: false, erro: `apify_timeout · ${timeoutMs}ms` };
    return { ok: false, erro: `apify_exception · ${e.message}` };
  }
}

async function upsertGlobalEInserirUso(
  adminClient: any,
  originacao_id: string,
  arquetipo_id: string | null,
  cfg: { canal_uso: string; fonte: string; categoria: string },
  payload: {
    identificador: string;
    nome: string;
    website?: string | null;
    cidade?: string | null;
    telefone?: string | null;
    endereco?: string | null;
    categoria_extra?: string | null;
    tags?: string[];
    bruto: any;
  },
): Promise<"ins" | "dup" | "err"> {
  if (!payload.identificador) return "err";
  const { data: upserted, error: errUp } = await adminClient
    .from("pool_contatos_global")
    .upsert({
      identificador_canonico: payload.identificador,
      fonte_origem: cfg.fonte,
      nome: payload.nome || "(sem nome)",
      telefone: payload.telefone || null,
      website: payload.website || null,
      endereco_completo: payload.endereco || null,
      cidade: payload.cidade || null,
      categoria_setorial: payload.categoria_extra || cfg.categoria,
      tags_consolidadas: payload.tags && payload.tags.length ? payload.tags : null,
      dados_brutos: payload.bruto,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "identificador_canonico,fonte_origem" })
    .select("id")
    .maybeSingle();
  if (errUp || !upserted) {
    console.error("[social] upsert err", errUp?.message);
    return "err";
  }
  const { error: errUso } = await adminClient
    .from("pool_contatos_uso")
    .insert({
      contato_id: upserted.id,
      originacao_id,
      arquetipo_id,
      canal: cfg.canal_uso,
      status: "bruto",
    });
  if (errUso) {
    if (errUso.code === "23505") return "dup";
    console.error("[social] uso err", errUso.message);
    return "err";
  }
  return "ins";
}

// ============================================================
// SUB-CANAL · fb_grupos
// ============================================================
async function rodarFbGrupos(adminClient: any, originacao_id: string, arquetipos: any[], briefing: any): Promise<any[]> {
  const cfg = CANAL_DB.fb_grupos;
  const cidade = briefing?.negocio?.cidade || null;
  return await Promise.all(arquetipos.map(async (arq) => {
    const base: any = { arquetipo_id: arq.id, nome: arq.nome, queries: 0, inseridos: 0, duplicados: 0, total_retornado: 0 };
    try {
      const queries: string[] = arq.queries_busca?.fb_grupos || [];
      if (!Array.isArray(queries) || queries.length === 0) {
        return { ...base, erro: "sem_fb_grupos_queries" };
      }
      base.queries = queries.length;
      for (const query of queries) {
        const q = (query || "").toString().trim();
        if (!q) continue;
        let r = await chamarApify(ACTOR_FB_GROUPS, { searchQuery: q, maxResults: 20 }, APIFY_TIMEOUT_PRIMARY_MS);
        if (!r.ok && r.erro && r.erro.startsWith("apify_timeout")) {
          r = await chamarApify(ACTOR_FB_GROUPS, { searchQuery: q, maxResults: 10 }, APIFY_TIMEOUT_RETRY_MS);
        }
        if (!r.ok) {
          base.erros = (base.erros || []);
          base.erros.push({ query: q, erro: r.erro });
          continue;
        }
        const items = r.items || [];
        base.total_retornado += items.length;
        for (const grupo of items) {
          const identificador = String(grupo.url || grupo.id || grupo.groupId || grupo.name || "").slice(0, 200);
          if (!identificador) continue;
          const status = await upsertGlobalEInserirUso(adminClient, originacao_id, arq.id, cfg, {
            identificador,
            nome: grupo.name || grupo.title || "(sem nome)",
            website: grupo.url || null,
            cidade,
            tags: ["facebook_grupo", "local", briefing?.negocio?.setor || "setor"],
            bruto: grupo,
          });
          if (status === "ins") base.inseridos++;
          else if (status === "dup") base.duplicados++;
        }
      }
      return base;
    } catch (e: any) {
      return { ...base, erro: `exception · ${e?.message}` };
    }
  }));
}

// ============================================================
// SUB-CANAL · ig_influenciadores / ig_corretores (mesma lógica · queries diferentes)
// ============================================================
async function rodarIgHashtag(
  adminClient: any,
  originacao_id: string,
  arquetipos: any[],
  briefing: any,
  subcanal: "ig_influenciadores" | "ig_corretores",
): Promise<any[]> {
  const cfg = CANAL_DB[subcanal];
  const cidade = briefing?.negocio?.cidade || null;
  return await Promise.all(arquetipos.map(async (arq) => {
    const base: any = { arquetipo_id: arq.id, nome: arq.nome, queries: 0, inseridos: 0, duplicados: 0, total_retornado: 0 };
    try {
      const queries: string[] = arq.queries_busca?.[subcanal] || [];
      if (!Array.isArray(queries) || queries.length === 0) {
        return { ...base, erro: `sem_${subcanal}_queries` };
      }
      base.queries = queries.length;
      const usernamesVistos = new Set<string>();
      for (const query of queries) {
        const hashtag = (query || "").toString().trim().replace(/^#/, "");
        if (!hashtag) continue;
        let r = await chamarApify(ACTOR_IG, {
          search: hashtag,
          searchType: "hashtag",
          resultsType: "posts",
          resultsLimit: 30,
        }, APIFY_TIMEOUT_PRIMARY_MS);
        if (!r.ok && r.erro && r.erro.startsWith("apify_timeout")) {
          r = await chamarApify(ACTOR_IG, {
            search: hashtag,
            searchType: "hashtag",
            resultsType: "posts",
            resultsLimit: 15,
          }, APIFY_TIMEOUT_RETRY_MS);
        }
        if (!r.ok) {
          base.erros = (base.erros || []);
          base.erros.push({ query: hashtag, erro: r.erro });
          continue;
        }
        const items = r.items || [];
        base.total_retornado += items.length;
        // Dedup por username · agrega likes como proxy
        const userAgg: Record<string, any> = {};
        for (const post of items) {
          const username = post.ownerUsername || post.owner?.username;
          if (!username || usernamesVistos.has(username)) continue;
          if (!userAgg[username]) {
            userAgg[username] = {
              username,
              fullName: post.ownerFullName || post.owner?.full_name || null,
              likesSum: 0,
              postCount: 0,
              samplePost: post,
            };
          }
          userAgg[username].likesSum += Number(post.likesCount || 0);
          userAgg[username].postCount++;
        }
        for (const username of Object.keys(userAgg)) {
          usernamesVistos.add(username);
          const u = userAgg[username];
          const likesMedia = u.postCount > 0 ? Math.round(u.likesSum / u.postCount) : 0;
          const status = await upsertGlobalEInserirUso(adminClient, originacao_id, arq.id, cfg, {
            identificador: "@" + username,
            nome: u.fullName || username,
            website: `https://instagram.com/${username}`,
            cidade,
            tags: ["instagram", subcanal === "ig_influenciadores" ? "influenciador" : "corretor", briefing?.negocio?.setor || "setor"],
            bruto: { username, fullName: u.fullName, likesMedia, postCount: u.postCount, samplePost: u.samplePost },
          });
          if (status === "ins") base.inseridos++;
          else if (status === "dup") base.duplicados++;
        }
      }
      return base;
    } catch (e: any) {
      return { ...base, erro: `exception · ${e?.message}` };
    }
  }));
}

// ============================================================
// SUB-CANAL · ig_clientes (do perfil do negócio · comentadores)
// ============================================================
async function rodarIgClientes(
  adminClient: any,
  originacao_id: string,
  arquetipos: any[],
  briefing: any,
  negocio_instagram: string,
): Promise<any[]> {
  const cfg = CANAL_DB.ig_clientes;
  const cidade = briefing?.negocio?.cidade || null;
  const handle = negocio_instagram.replace(/^@/, "").trim();

  let r = await chamarApify(ACTOR_IG, {
    directUrls: [`https://www.instagram.com/${handle}/`],
    resultsType: "posts",
    resultsLimit: 10,
  }, APIFY_TIMEOUT_PRIMARY_MS);

  if (!r.ok) {
    return [{ arquetipo_id: null, nome: "(todos · ig_clientes)", erro: r.erro, inseridos: 0, duplicados: 0, total_retornado: 0 }];
  }
  const items = r.items || [];
  // Pra ig_clientes não usamos arquetipo_id (mapeia ao 1º aprovado · ou null)
  const arqId = arquetipos[0]?.id || null;
  const base: any = { arquetipo_id: arqId, nome: "(comentadores · ig_clientes)", queries: 1, total_retornado: 0, inseridos: 0, duplicados: 0 };

  const usernamesVistos = new Set<string>();
  for (const post of items) {
    const comentarios = post.latestComments || post.comments || [];
    base.total_retornado += comentarios.length;
    for (const com of comentarios) {
      const username = com.ownerUsername || com.owner?.username || com.username;
      if (!username || usernamesVistos.has(username)) continue;
      usernamesVistos.add(username);
      const status = await upsertGlobalEInserirUso(adminClient, originacao_id, arqId, cfg, {
        identificador: "@" + username,
        nome: com.ownerFullName || username,
        website: `https://instagram.com/${username}`,
        cidade,
        tags: ["instagram", "cliente_negocio", `comentou_em:${handle}`],
        bruto: { username, comentou_em: handle, comentario_texto: (com.text || "").slice(0, 200) },
      });
      if (status === "ins") base.inseridos++;
      else if (status === "dup") base.duplicados++;
    }
  }
  return [base];
}

// ============================================================
// SUB-CANAL · eventos (Sympla · API pública)
// ============================================================
async function rodarEventos(adminClient: any, originacao_id: string, arquetipos: any[], briefing: any): Promise<any[]> {
  const cfg = CANAL_DB.eventos;
  const cidade = briefing?.negocio?.cidade || null;
  return await Promise.all(arquetipos.map(async (arq) => {
    const base: any = { arquetipo_id: arq.id, nome: arq.nome, queries: 0, inseridos: 0, duplicados: 0, total_retornado: 0 };
    try {
      const queries: string[] = arq.queries_busca?.eventos || [];
      if (!Array.isArray(queries) || queries.length === 0) {
        return { ...base, erro: "sem_eventos_queries" };
      }
      base.queries = queries.length;
      for (const query of queries) {
        const q = (query || "").toString().trim();
        if (!q) continue;
        try {
          const url = `https://api.sympla.com.br/public/v3/events?s=${encodeURIComponent(q)}&page_size=20`;
          const r = await fetch(url, {
            method: "GET",
            headers: { "Accept": "application/json", "User-Agent": "1Negocio/v9.33.7" },
            signal: AbortSignal.timeout(20_000),
          });
          if (!r.ok) {
            base.erros = base.erros || [];
            base.erros.push({ query: q, erro: `sympla_status_${r.status}` });
            continue;
          }
          const data = await r.json();
          const eventos = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
          base.total_retornado += eventos.length;
          for (const ev of eventos) {
            const identificador = String(ev.url || ev.public_url || ev.id || "").slice(0, 200);
            if (!identificador) continue;
            const status = await upsertGlobalEInserirUso(adminClient, originacao_id, arq.id, cfg, {
              identificador,
              nome: ev.name || ev.title || "(evento sem nome)",
              website: ev.url || ev.public_url || null,
              cidade: ev.address?.city || cidade,
              endereco: ev.address?.formatted_address || ev.address?.name || null,
              categoria_extra: "evento_setor",
              tags: ["evento", briefing?.negocio?.setor || "setor", ev.category_prim?.name || "geral"],
              bruto: { ...ev, data_evento: ev.start_date || ev.startDate || null },
            });
            if (status === "ins") base.inseridos++;
            else if (status === "dup") base.duplicados++;
          }
        } catch (e: any) {
          base.erros = base.erros || [];
          base.erros.push({ query: q, erro: `fetch_sympla · ${e?.message}` });
        }
      }
      return base;
    } catch (e: any) {
      return { ...base, erro: `exception · ${e?.message}` };
    }
  }));
}

// ============================================================
// HANDLER
// ============================================================
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return resp(405, { ok: false, erro: "metodo" });

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return resp(401, { ok: false, erro: "sem_jwt" });
  const { data: userData, error: userErr } = await adminClient.auth.getUser(jwt);
  if (userErr || !userData?.user) return resp(401, { ok: false, erro: "jwt_invalido" });
  const { data: admin } = await adminClient
    .from("admins").select("id, ativo")
    .eq("whatsapp", userData.user.phone).eq("ativo", true).maybeSingle();
  if (!admin) return resp(403, { ok: false, erro: "nao_admin" });

  let body: any;
  try { body = await req.json(); } catch { return resp(400, { ok: false, erro: "json_invalido" }); }
  const { originacao_id, canal, arquetipo_id, negocio_instagram } = body || {};
  if (!originacao_id) return resp(400, { ok: false, erro: "originacao_id_obrigatorio" });
  if (!canal || !CANAL_DB[canal]) return resp(400, { ok: false, erro: "canal_invalido", canais_validos: Object.keys(CANAL_DB) });

  // Canais Apify exigem token
  const exigeApify = canal !== "eventos";
  if (exigeApify && !APIFY_TOKEN) return resp(503, { ok: false, erro: "apify_token_nao_configurada" });

  // ig_clientes precisa do @ do negócio
  if (canal === "ig_clientes" && !negocio_instagram) {
    return resp(200, { ok: true, canal, skipped: true, motivo: "instagram_negocio_nao_informado", total_inseridos: 0 });
  }

  try {
    const { data: orig } = await adminClient
      .from("projetos_originacao").select("id, fase_atual, briefing_jsonb")
      .eq("id", originacao_id).maybeSingle();
    if (!orig) return resp(404, { ok: false, erro: "originacao_nao_encontrada" });
    if (orig.fase_atual !== "leads") return resp(400, { ok: false, erro: "fase_invalida", detalhe: `fase: ${orig.fase_atual}` });

    let arqQuery = adminClient
      .from("arquetipos_compradores")
      .select("id, nome, queries_busca")
      .eq("originacao_id", originacao_id)
      .eq("status", "aprovado")
      .order("ordem", { ascending: true });
    if (arquetipo_id) arqQuery = arqQuery.eq("id", arquetipo_id);

    const { data: arquetipos, error: errArq } = await arqQuery;
    if (errArq) return resp(500, { ok: false, erro: "fetch_arquetipos_falhou", detalhe: errArq.message });
    if (!arquetipos || arquetipos.length === 0) return resp(400, { ok: false, erro: "nenhum_arquetipo_aprovado" });

    // v9.34.4 Sprint 5 b2 · queries_override (Passo B) injeta queries no campo do canal
    const queriesOverride = Array.isArray(body?.queries_override)
      ? body.queries_override.map((q: any) => String(q).trim()).filter(Boolean)
      : [];
    const arquetiposEfetivos = queriesOverride.length > 0
      ? arquetipos.map((a: any) => ({ ...a, queries_busca: { ...(a.queries_busca || {}), [canal]: queriesOverride } }))
      : arquetipos;

    let porArquetipo: any[];
    switch (canal) {
      case "fb_grupos":
        porArquetipo = await rodarFbGrupos(adminClient, originacao_id, arquetiposEfetivos, orig.briefing_jsonb);
        break;
      case "ig_influenciadores":
      case "ig_corretores":
        porArquetipo = await rodarIgHashtag(adminClient, originacao_id, arquetiposEfetivos, orig.briefing_jsonb, canal);
        break;
      case "ig_clientes":
        porArquetipo = await rodarIgClientes(adminClient, originacao_id, arquetipos, orig.briefing_jsonb, negocio_instagram);
        break;
      case "eventos":
        porArquetipo = await rodarEventos(adminClient, originacao_id, arquetipos, orig.briefing_jsonb);
        break;
      default:
        return resp(400, { ok: false, erro: "canal_nao_suportado" });
    }

    const totalInseridos = porArquetipo.reduce((acc: number, x: any) => acc + (x.inseridos || 0), 0);
    const queriesTotal = porArquetipo.reduce((acc: number, x: any) => acc + (x.queries || 0), 0);
    const custoUnit = CUSTO_POR_QUERY[canal] || 0;
    const custoEstimado = canal === "ig_clientes" ? custoUnit : +(queriesTotal * custoUnit).toFixed(2);

    return resp(200, {
      ok: true,
      canal,
      por_arquetipo: porArquetipo,
      total_inseridos: totalInseridos,
      custo_apify_brl_estimado: +custoEstimado.toFixed(2),
    });
  } catch (e: any) {
    console.error("[social] exception raiz", e);
    return resp(500, { ok: false, erro: "exception_raiz", erro_debug: e?.message, stack: e?.stack?.slice(0, 1000) });
  }
});
