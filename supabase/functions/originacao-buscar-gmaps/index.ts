// originacao-buscar-gmaps · v9.33.7 · adiciona tipo='corretores' (queries fixas · categoria corretor_local)
// Roda Apify compass/crawler-google-places por arquétipo aprovado · EM PARALELO.
// Lê queries_busca.gmaps_query · insere em originacao_leads_brutos (canal='gmaps' · categoria='comprador_potencial').
// Custo Apify estimado: ~R$ 0,50 por arquétipo (15 places).
//
// v9.33.3.2 mudanças:
// - Default limite 20 → 15 (cabe em 120s em 95% dos casos)
// - Retry automático em timeout: 1ª tentativa (limite=15 · 120s) → 2ª (limiteFallback ≈ 8 · 90s)
// - retry_info no response · UI mostra "↳ retry OK"
//
// v9.33.3.1 mudanças:
// - FIX A: Promise.all paralelo (era loop sequencial · 4×35s=140s → 1×35s=40s · evita 504 gateway)
// - FIX B: try/finally raiz · sempre libera leads_executando_em
// - FIX C: try/catch raiz · exception retorna 500 com erro_debug + stack
//
// POST body: { originacao_id: uuid, arquetipo_id?: uuid, limite?: number=15 }
// Output: { ok, por_arquetipo[], total_inseridos, custo_apify_brl_estimado }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APIFY_TOKEN = Deno.env.get("APIFY_TOKEN") || "";

const APIFY_ACTOR = "compass~crawler-google-places";
const APIFY_TIMEOUT_PRIMARY_MS = 120_000; // 1ª tentativa · margem dos 150s do gateway
const APIFY_TIMEOUT_RETRY_MS = 90_000;    // 2ª tentativa · ainda mais conservador

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
  timeoutMs: number,
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
    if (!Array.isArray(items)) return { ok: false, erro: "apify_resposta_invalida · " + JSON.stringify(items).slice(0, 200) };
    return { ok: true, items };
  } catch (e: any) {
    clearTimeout(timer);
    if (e.name === "AbortError") return { ok: false, erro: `apify_timeout · ${timeoutMs}ms` };
    return { ok: false, erro: `apify_exception · ${e.message}` };
  }
}

async function processarArquetipo(
  adminClient: any,
  originacao_id: string,
  arq: any,
  limite: number,
  limiteFallback: number,
): Promise<any> {
  const baseStats: any = {
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

    // v9.33.3.2 · retry automático em timeout
    let r = await buscarApify(gmapsQuery, limite, APIFY_TIMEOUT_PRIMARY_MS);
    let retryInfo: string | undefined = undefined;

    if (!r.ok && r.erro && r.erro.startsWith("apify_timeout")) {
      console.log(`[orig-gmaps] timeout em "${arq.nome}" (limite=${limite}) · retry com limite=${limiteFallback}`);
      const r2 = await buscarApify(gmapsQuery, limiteFallback, APIFY_TIMEOUT_RETRY_MS);
      if (r2.ok) {
        retryInfo = `1ª tentativa timeout (limite=${limite}) · retry com limite=${limiteFallback} OK`;
        r = r2;
      } else if (r2.erro && r2.erro.startsWith("apify_timeout")) {
        return {
          ...baseStats,
          erro: "apify_timeout_persistente",
          retry_info: `1ª tentativa timeout (limite=${limite}·120s) · 2ª também (limite=${limiteFallback}·90s)`,
        };
      } else {
        return { ...baseStats, erro: r2.erro, retry_info: `retry após timeout falhou: ${r2.erro}` };
      }
    }

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
      const endereco = place.address || place.formattedAddress || null;
      const website = place.website || null;
      const categoria = place.categoryName || place.category || null;
      const cidade = place.city || null;
      const estado = place.state || null;
      const lat = typeof place.location?.lat === "number" ? place.location.lat : null;
      const lng = typeof place.location?.lng === "number" ? place.location.lng : null;

      // v9.33.6 · UPSERT em pool_contatos_global + INSERT em pool_contatos_uso
      const { data: upserted, error: errUp } = await adminClient
        .from("pool_contatos_global")
        .upsert({
          identificador_canonico: identificador,
          fonte_origem: "apify_gmaps",
          nome: nomePlace,
          telefone,
          website,
          endereco_completo: endereco,
          cidade,
          estado,
          latitude: lat,
          longitude: lng,
          categoria_setorial: categoria,
          dados_brutos: place,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "identificador_canonico,fonte_origem" })
        .select("id")
        .maybeSingle();

      if (errUp || !upserted) {
        console.error("[orig-gmaps] upsert global err", errUp?.message);
        continue;
      }

      const { error: errUso } = await adminClient
        .from("pool_contatos_uso")
        .insert({
          contato_id: upserted.id,
          originacao_id,
          arquetipo_id: arq.id,
          canal: "gmaps",
          status: "bruto",
        });

      if (errUso) {
        if (errUso.code === "23505") {
          duplicados++;
        } else {
          console.error("[orig-gmaps] insert uso err", errUso.message);
        }
      } else {
        inseridos++;
      }
    }

    return { ...baseStats, inseridos, duplicados, ...(retryInfo ? { retry_info: retryInfo } : {}) };
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
  const { originacao_id, arquetipo_id, limite, tipo } = body || {};
  if (!originacao_id) return resp(400, { ok: false, erro: "originacao_id_obrigatorio" });

  const limiteN = Math.max(1, Math.min(100, Number(limite) || 15));
  const limiteFallback = Math.max(5, Math.floor(limiteN / 2));
  const modoTipo = (tipo === "corretores") ? "corretores" : "compradores";

  let lockSetado = false;

  try {
    const { data: orig, error: errOrig } = await adminClient
      .from("projetos_originacao").select("id, projeto_id, fase_atual, leads_executando_em, briefing_jsonb")
      .eq("id", originacao_id).maybeSingle();
    if (errOrig) return resp(500, { ok: false, erro: "fetch_orig_falhou", detalhe: errOrig.message });
    if (!orig) return resp(404, { ok: false, erro: "originacao_nao_encontrada" });
    if (orig.fase_atual !== "leads") {
      return resp(400, { ok: false, erro: "fase_invalida", detalhe: `fase atual: ${orig.fase_atual} · esperado: leads` });
    }

    // v9.33.7 · MODO CORRETORES · queries fixas · não usa arquétipos
    if (modoTipo === "corretores") {
      const cidade = (orig.briefing_jsonb?.negocio?.cidade || "").trim() || "Brasil";
      const queries = [
        `corretora de negócios ${cidade}`,
        `imobiliária comercial ${cidade}`,
        `consultor M&A ${cidade}`,
        `corretor de empresas ${cidade}`,
      ];

      await adminClient.from("projetos_originacao").update({ leads_executando_em: new Date().toISOString() }).eq("id", originacao_id);
      lockSetado = true;

      let totalRetornado = 0, inseridos = 0, duplicados = 0;
      const errosCorretores: any[] = [];

      const resultados = await Promise.all(queries.map(async (q) => {
        let r = await buscarApify(q, 20, APIFY_TIMEOUT_PRIMARY_MS);
        if (!r.ok && r.erro && r.erro.startsWith("apify_timeout")) {
          r = await buscarApify(q, 10, APIFY_TIMEOUT_RETRY_MS);
        }
        return { q, r };
      }));

      for (const { q, r } of resultados) {
        if (!r.ok) { errosCorretores.push({ query: q, erro: r.erro }); continue; }
        const items = r.items || [];
        totalRetornado += items.length;
        for (const place of items) {
          const identificador = pickIdentificador(place);
          if (!identificador) continue;
          const nome = place.title || place.name || "(sem nome)";
          const telefone = pickTelefone(place);
          const endereco = place.address || place.formattedAddress || null;
          const website = place.website || null;
          const categoria = place.categoryName || place.category || null;

          const { data: upserted, error: errUp } = await adminClient
            .from("pool_contatos_global")
            .upsert({
              identificador_canonico: identificador,
              fonte_origem: "apify_gmaps",
              nome,
              telefone,
              website,
              endereco_completo: endereco,
              cidade: place.city || cidade,
              estado: place.state || null,
              categoria_setorial: "corretor_local",
              dados_brutos: { ...place, _modo: "corretores", _query: q, _categoria_gmaps: categoria },
              tags_consolidadas: ["corretor", "local", cidade],
              last_seen_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }, { onConflict: "identificador_canonico,fonte_origem" })
            .select("id")
            .maybeSingle();
          if (errUp || !upserted) continue;

          const { error: errUso } = await adminClient
            .from("pool_contatos_uso")
            .insert({
              contato_id: upserted.id,
              originacao_id,
              arquetipo_id: null,
              canal: "corretores_locais",
              status: "bruto",
            });
          if (errUso) {
            if (errUso.code === "23505") duplicados++;
          } else inseridos++;
        }
      }

      await adminClient.from("projetos_originacao").update({
        leads_executando_em: null,
        leads_executados_em: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", originacao_id);
      lockSetado = false;

      return resp(200, {
        ok: true,
        tipo: "corretores",
        cidade,
        queries,
        total_retornado: totalRetornado,
        inseridos,
        duplicados,
        erros: errosCorretores,
        custo_apify_brl_estimado: 0.50,
      });
    }

    // === MODO compradores (default · v9.33.3.x) ===
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
    // v9.33.3.2 · passa limiteFallback pra retry automático em timeout
    const porArquetipo = await Promise.all(
      arquetipos.map((arq) => processarArquetipo(adminClient, originacao_id, arq, limiteN, limiteFallback)),
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
