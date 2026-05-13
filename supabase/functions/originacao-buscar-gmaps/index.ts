// originacao-buscar-gmaps · v9.33.3.1
// Roda Apify compass/crawler-google-places por arquétipo aprovado · EM PARALELO.
// Lê queries_busca.gmaps_query · insere em originacao_leads_brutos (canal='gmaps' · categoria='comprador_potencial').
// Custo Apify estimado: ~R$ 0,50 por arquétipo (20 places).
//
// v9.33.3.1 mudanças:
// - FIX A: Promise.all paralelo (era loop sequencial · 4×35s=140s → 1×35s=40s · evita 504 gateway)
// - FIX B: try/finally raiz · sempre libera leads_executando_em
// - FIX C: try/catch raiz · exception retorna 500 com erro_debug + stack
// - Timeout Apify 180s → 120s · margem dos 150s gateway
//
// POST body: { originacao_id: uuid, arquetipo_id?: uuid, limite?: number=20 }
// Output: { ok, por_arquetipo[], total_inseridos, custo_apify_brl_estimado }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APIFY_TOKEN = Deno.env.get("APIFY_TOKEN") || "";

const APIFY_ACTOR = "compass~crawler-google-places";
const APIFY_TIMEOUT_MS = 120_000; // v9.33.3.1 · margem dos 150s do gateway Supabase

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

function pickIdentificador(place: any): string {
  const placeId = place.placeId || place.place_id || place.cid;
  if (placeId) return String(placeId);
  const url = place.url || place.maps_url || place.googleMapsUrl;
  if (url) return String(url);
  const title = place.title || place.name || "";
  const addr = place.address || place.formattedAddress || "";
  return `${title}|${addr}`.slice(0, 200);
}

function pickTelefone(place: any): string | null {
  return place.phone || place.phoneNumber || place.formattedPhoneNumber || place.internationalPhoneNumber || null;
}

async function buscarApify(
  gmapsQuery: string,
  limite: number,
): Promise<{ ok: boolean; items?: any[]; erro?: string }> {
  const input = {
    searchStringsArray: [gmapsQuery],
    maxCrawledPlacesPerSearch: limite,
    language: "pt-BR",
    countryCode: "br",
    exportPlaceUrls: true,
    includeWebResults: false,
  };

  const url = `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${APIFY_TOKEN}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), APIFY_TIMEOUT_MS);

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
    if (!Array.isArray(items)) return { ok: false, erro: "apify_resposta_invalida · " + JSON.stringify(items).slice(0, 200) };
    return { ok: true, items };
  } catch (e: any) {
    clearTimeout(timer);
    if (e.name === "AbortError") return { ok: false, erro: `apify_timeout · ${APIFY_TIMEOUT_MS}ms` };
    return { ok: false, erro: `apify_exception · ${e.message}` };
  }
}

async function processarArquetipo(
  adminClient: any,
  originacao_id: string,
  arq: any,
  limite: number,
): Promise<any> {
  const baseStats = {
    arquetipo_id: arq.id,
    nome: arq.nome || "(sem nome)",
    gmaps_query: "",
    inseridos: 0,
    duplicados: 0,
    total_retornado: 0,
  };

  try {
    const gmapsQuery = (arq.queries_busca?.gmaps_query || "").toString().trim();
    if (!gmapsQuery) {
      return { ...baseStats, erro: "sem_gmaps_query" };
    }
    baseStats.gmaps_query = gmapsQuery;

    const r = await buscarApify(gmapsQuery, limite);
    if (!r.ok) {
      return { ...baseStats, erro: r.erro };
    }

    const items = r.items || [];
    baseStats.total_retornado = items.length;
    let inseridos = 0;
    let duplicados = 0;

    for (const place of items) {
      const identificador = pickIdentificador(place);
      if (!identificador) continue;
      const nomePlace = place.title || place.name || "(sem nome)";
      const telefone = pickTelefone(place);

      const { error: errIns } = await adminClient
        .from("originacao_leads_brutos")
        .insert({
          originacao_id,
          arquetipo_id: arq.id,
          canal: "gmaps",
          categoria: "comprador_potencial",
          nome: nomePlace,
          identificador_canal: identificador,
          dados_brutos: place,
          telefone,
          status: "bruto",
        });

      if (errIns) {
        if (errIns.code === "23505") {
          duplicados++;
        } else {
          console.error("[orig-gmaps] insert err", errIns.message);
        }
      } else {
        inseridos++;
      }
    }

    return { ...baseStats, inseridos, duplicados };
  } catch (e: any) {
    return { ...baseStats, erro: `exception_arquetipo · ${e?.message || "sem mensagem"}` };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return resp(405, { ok: false, erro: "metodo" });

  if (!APIFY_TOKEN) {
    return resp(503, { ok: false, erro: "apify_token_nao_configurada" });
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

  // Gate admin canônico
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
  const { originacao_id, arquetipo_id, limite } = body || {};
  if (!originacao_id) return resp(400, { ok: false, erro: "originacao_id_obrigatorio" });

  const limiteN = Math.max(1, Math.min(100, Number(limite) || 20));

  // v9.33.3.1 · FIX B+C · try/finally raiz · sempre libera lock + sempre retorna erro_debug
  let lockSetado = false;

  try {
    // Valida originação
    const { data: orig, error: errOrig } = await adminClient
      .from("projetos_originacao").select("id, projeto_id, fase_atual, leads_executando_em")
      .eq("id", originacao_id).maybeSingle();
    if (errOrig) return resp(500, { ok: false, erro: "fetch_orig_falhou", detalhe: errOrig.message });
    if (!orig) return resp(404, { ok: false, erro: "originacao_nao_encontrada" });
    if (orig.fase_atual !== "leads") {
      return resp(400, { ok: false, erro: "fase_invalida", detalhe: `fase atual: ${orig.fase_atual} · esperado: leads` });
    }

    // Busca arquétipos aprovados com queries
    let arqQuery = adminClient
      .from("arquetipos_compradores")
      .select("id, nome, queries_busca")
      .eq("originacao_id", originacao_id)
      .eq("status", "aprovado")
      .not("queries_busca", "is", null)
      .order("ordem", { ascending: true });

    if (arquetipo_id) arqQuery = arqQuery.eq("id", arquetipo_id);

    const { data: arquetipos, error: errArq } = await arqQuery;
    if (errArq) return resp(500, { ok: false, erro: "fetch_arquetipos_falhou", detalhe: errArq.message });
    if (!arquetipos || arquetipos.length === 0) {
      return resp(400, { ok: false, erro: "nenhum_arquetipo_com_queries" });
    }

    // Lock executando
    await adminClient
      .from("projetos_originacao")
      .update({ leads_executando_em: new Date().toISOString() })
      .eq("id", originacao_id);
    lockSetado = true;

    // v9.33.3.1 · FIX A · paralelizar arquétipos (tempo total = mais lento · não soma)
    const porArquetipo = await Promise.all(
      arquetipos.map((arq) => processarArquetipo(adminClient, originacao_id, arq, limiteN)),
    );

    // Libera lock + marca conclusão
    await adminClient
      .from("projetos_originacao")
      .update({
        leads_executando_em: null,
        leads_executados_em: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", originacao_id);
    lockSetado = false;

    const totalInseridos = porArquetipo.reduce((acc: number, x: any) => acc + (x.inseridos || 0), 0);
    const custoEstimado = +(arquetipos.length * 0.5).toFixed(2);

    return resp(200, {
      ok: true,
      por_arquetipo: porArquetipo,
      total_inseridos: totalInseridos,
      custo_apify_brl_estimado: custoEstimado,
    });

  } catch (e: any) {
    console.error("[orig-gmaps] exception raiz", e);
    // FIX B · libera lock se exception ocorreu depois de setar
    if (lockSetado) {
      try {
        await adminClient
          .from("projetos_originacao")
          .update({ leads_executando_em: null })
          .eq("id", originacao_id);
      } catch (_) {}
    }
    return resp(500, {
      ok: false,
      erro: "exception_raiz",
      erro_debug: e?.message || "sem mensagem",
      stack: e?.stack?.slice(0, 1000) || null,
    });
  }
});
