// originacao-buscar-instagram · v9.33.6
// Apify apify/instagram-scraper · busca users · escreve em pool_contatos_global+uso.
//
// POST body: { originacao_id: uuid, arquetipo_id?: uuid, limite?: number=15 }
// Output: { ok, por_arquetipo[], total_inseridos, custo_apify_brl_estimado }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APIFY_TOKEN = Deno.env.get("APIFY_TOKEN") || "";

const APIFY_ACTOR = "apify~instagram-scraper";
const APIFY_TIMEOUT_PRIMARY_MS = 120_000;
const APIFY_TIMEOUT_RETRY_MS = 90_000;
const CUSTO_POR_ARQ_BRL = 0.70;

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

async function buscarApify(query: string, limite: number, timeoutMs: number): Promise<{ ok: boolean; items?: any[]; erro?: string }> {
  const input = {
    search: [query],
    searchType: "user",
    resultsType: "details",
    resultsLimit: limite,
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
    if (!Array.isArray(items)) return { ok: false, erro: "apify_resposta_invalida" };
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
    ig_query: "",
    inseridos: 0,
    duplicados: 0,
    total_retornado: 0,
  };

  try {
    const q = (arq.queries_busca?.ig_query || "").toString().trim();
    if (!q) return { ...baseStats, erro: "sem_ig_query" };
    baseStats.ig_query = q;

    let r = await buscarApify(q, limite, APIFY_TIMEOUT_PRIMARY_MS);
    let retryInfo: string | undefined;
    if (!r.ok && r.erro && r.erro.startsWith("apify_timeout")) {
      console.log(`[orig-ig] timeout em "${arq.nome}" · retry com limite=${limiteFallback}`);
      const r2 = await buscarApify(q, limiteFallback, APIFY_TIMEOUT_RETRY_MS);
      if (r2.ok) { retryInfo = `retry OK com limite=${limiteFallback}`; r = r2; }
      else if (r2.erro && r2.erro.startsWith("apify_timeout")) {
        return { ...baseStats, erro: "apify_timeout_persistente" };
      } else { return { ...baseStats, erro: r2.erro }; }
    }
    if (!r.ok) return { ...baseStats, erro: r.erro };

    const items = r.items || [];
    baseStats.total_retornado = items.length;
    let inseridos = 0;
    let duplicados = 0;

    for (const user of items) {
      const identificador = String(user.id || user.userId || user.username || "").slice(0, 200);
      if (!identificador) continue;
      const nome = user.fullName || user.username || "(sem nome)";
      const website = user.externalUrl || (user.username ? `https://instagram.com/${user.username}` : null);
      const categoria = user.businessCategoryName || user.category || null;
      const bio = user.biography || null;

      const { data: upserted, error: errUp } = await adminClient
        .from("pool_contatos_global")
        .upsert({
          identificador_canonico: identificador,
          fonte_origem: "apify_instagram",
          nome,
          website,
          endereco_completo: bio,
          categoria_setorial: categoria,
          dados_brutos: user,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "identificador_canonico,fonte_origem" })
        .select("id")
        .maybeSingle();

      if (errUp || !upserted) {
        console.error("[orig-ig] upsert err", errUp?.message);
        continue;
      }

      const { error: errUso } = await adminClient
        .from("pool_contatos_uso")
        .insert({
          contato_id: upserted.id,
          originacao_id,
          arquetipo_id: arq.id,
          canal: "instagram",
          status: "bruto",
        });

      if (errUso) {
        if (errUso.code === "23505") duplicados++;
        else console.error("[orig-ig] insert uso err", errUso.message);
      } else inseridos++;
    }

    return { ...baseStats, inseridos, duplicados, ...(retryInfo ? { retry_info: retryInfo } : {}) };
  } catch (e: any) {
    return { ...baseStats, erro: `exception_arquetipo · ${e?.message || "sem mensagem"}` };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return resp(405, { ok: false, erro: "metodo" });
  if (!APIFY_TOKEN) return resp(503, { ok: false, erro: "apify_token_nao_configurada" });

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
  const { originacao_id, arquetipo_id, limite } = body || {};
  if (!originacao_id) return resp(400, { ok: false, erro: "originacao_id_obrigatorio" });

  const limiteN = Math.max(1, Math.min(50, Number(limite) || 15));
  const limiteFallback = Math.max(5, Math.floor(limiteN / 2));

  try {
    const { data: orig } = await adminClient
      .from("projetos_originacao").select("id, fase_atual")
      .eq("id", originacao_id).maybeSingle();
    if (!orig) return resp(404, { ok: false, erro: "originacao_nao_encontrada" });
    if (orig.fase_atual !== "leads") return resp(400, { ok: false, erro: "fase_invalida", detalhe: `fase: ${orig.fase_atual}` });

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
    if (!arquetipos || arquetipos.length === 0) return resp(400, { ok: false, erro: "nenhum_arquetipo_com_queries" });

    const porArquetipo = await Promise.all(
      arquetipos.map((arq) => processarArquetipo(adminClient, originacao_id, arq, limiteN, limiteFallback)),
    );

    const totalInseridos = porArquetipo.reduce((acc: number, x: any) => acc + (x.inseridos || 0), 0);
    return resp(200, {
      ok: true,
      por_arquetipo: porArquetipo,
      total_inseridos: totalInseridos,
      custo_apify_brl_estimado: +(arquetipos.length * CUSTO_POR_ARQ_BRL).toFixed(2),
    });
  } catch (e: any) {
    console.error("[orig-ig] exception raiz", e);
    return resp(500, { ok: false, erro: "exception_raiz", erro_debug: e?.message, stack: e?.stack?.slice(0, 1000) });
  }
});
