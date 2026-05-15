// buscar-pool-interno · v9.33.7 · filtro adicional por tags_consolidadas @> [setor]
// Busca no banco interno (pool_contatos_global) ANTES de gastar Apify · gratuito.
// Filtra por cidade do briefing + setor + tags de tipo de arquétipo.
// Insere uso em pool_contatos_uso com canal='interno'.
//
// POST body: { originacao_id: uuid, arquetipo_id?: uuid, limite?: number=30 }
// Output: { ok, por_arquetipo[], total_inseridos, custo_brl: 0 }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

async function buscarParaArquetipo(
  adminClient: any,
  originacao_id: string,
  arq: any,
  briefing: any,
  limite: number,
): Promise<any> {
  const baseStats: any = {
    arquetipo_id: arq.id,
    nome: arq.nome || "(sem nome)",
    encontrados: 0,
    inseridos: 0,
    duplicados: 0,
  };

  try {
    const negocio = briefing?.negocio || {};
    const cidade = (negocio.cidade || "").trim();
    const setor = (negocio.setor || "").trim();
    const subSetor = (negocio.sub_setor || "").trim();

    if (!cidade && !setor && !subSetor) {
      return { ...baseStats, erro: "briefing_sem_localizacao_nem_setor" };
    }

    // Filtro: cidade match (ILIKE) E (categoria/setor match OU tag match)
    // Construído com .or() do PostgREST · escape pra evitar injection
    const cidadeSafe = cidade.replace(/[%,()]/g, " ").trim();
    const setorSafe = setor.replace(/[%,()]/g, " ").trim();
    const subSetorSafe = subSetor.replace(/[%,()]/g, " ").trim();

    let q = adminClient
      .from("pool_contatos_global")
      .select("id, nome, cidade, categoria_setorial, last_seen_at")
      .order("last_seen_at", { ascending: false })
      .limit(limite);

    if (cidadeSafe) {
      const cidadeOr = `cidade.ilike.%${cidadeSafe}%,endereco_completo.ilike.%${cidadeSafe}%`;
      q = q.or(cidadeOr);
    }

    // Match de setor: categoria_setorial OR sub_setor OR tags_consolidadas @> setor
    // v9.33.7 · tags_consolidadas é jsonb · usamos cs (jsonb contains) via PostgREST
    if (setorSafe || subSetorSafe) {
      const setorOr: string[] = [];
      if (setorSafe) {
        setorOr.push(`categoria_setorial.ilike.%${setorSafe}%`);
        setorOr.push(`tags_consolidadas.cs.${JSON.stringify([setorSafe])}`);
      }
      if (subSetorSafe) {
        setorOr.push(`categoria_setorial.ilike.%${subSetorSafe}%`);
        setorOr.push(`tags_consolidadas.cs.${JSON.stringify([subSetorSafe])}`);
      }
      if (setorOr.length) q = q.or(setorOr.join(","));
    }

    const { data: candidatos, error: errCand } = await q;
    if (errCand) return { ...baseStats, erro: `query_falhou · ${errCand.message}` };
    if (!candidatos || candidatos.length === 0) return baseStats;

    baseStats.encontrados = candidatos.length;

    // Filtra os que JÁ estão em uso por este projeto (qualquer arquétipo)
    const { data: jaUsados } = await adminClient
      .from("pool_contatos_uso")
      .select("contato_id")
      .eq("originacao_id", originacao_id)
      .in("contato_id", candidatos.map((c: any) => c.id));

    const jaUsadosSet = new Set((jaUsados || []).map((u: any) => u.contato_id));
    const novos = candidatos.filter((c: any) => !jaUsadosSet.has(c.id));

    let inseridos = 0;
    let duplicados = 0;
    for (const cand of novos) {
      const { error: errUso } = await adminClient
        .from("pool_contatos_uso")
        .insert({
          contato_id: cand.id,
          originacao_id,
          arquetipo_id: arq.id,
          canal: "interno",
          status: "bruto",
        });
      if (errUso) {
        if (errUso.code === "23505") duplicados++;
        else console.error("[busca-interno] uso err", errUso.message);
      } else inseridos++;
    }

    return { ...baseStats, inseridos, duplicados };
  } catch (e: any) {
    return { ...baseStats, erro: `exception · ${e?.message || "sem mensagem"}` };
  }
}

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
  const { originacao_id, arquetipo_id, limite } = body || {};
  if (!originacao_id) return resp(400, { ok: false, erro: "originacao_id_obrigatorio" });

  const limiteN = Math.max(1, Math.min(200, Number(limite) || 30));

  try {
    const { data: orig } = await adminClient
      .from("projetos_originacao").select("id, fase_atual, briefing_jsonb")
      .eq("id", originacao_id).maybeSingle();
    if (!orig) return resp(404, { ok: false, erro: "originacao_nao_encontrada" });
    if (orig.fase_atual !== "leads") return resp(400, { ok: false, erro: "fase_invalida", detalhe: `fase: ${orig.fase_atual}` });

    let arqQuery = adminClient
      .from("arquetipos_compradores")
      .select("id, nome")
      .eq("originacao_id", originacao_id)
      .eq("status", "aprovado")
      .order("ordem", { ascending: true });
    if (arquetipo_id) arqQuery = arqQuery.eq("id", arquetipo_id);

    const { data: arquetipos, error: errArq } = await arqQuery;
    if (errArq) return resp(500, { ok: false, erro: "fetch_arquetipos_falhou", detalhe: errArq.message });
    if (!arquetipos || arquetipos.length === 0) return resp(400, { ok: false, erro: "nenhum_arquetipo_aprovado" });

    const porArquetipo = await Promise.all(
      arquetipos.map((arq) => buscarParaArquetipo(adminClient, originacao_id, arq, orig.briefing_jsonb, limiteN)),
    );

    const totalInseridos = porArquetipo.reduce((acc: number, x: any) => acc + (x.inseridos || 0), 0);
    const totalEncontrados = porArquetipo.reduce((acc: number, x: any) => acc + (x.encontrados || 0), 0);
    return resp(200, {
      ok: true,
      por_arquetipo: porArquetipo,
      total_encontrados: totalEncontrados,
      total_inseridos: totalInseridos,
      custo_brl: 0,
    });
  } catch (e: any) {
    console.error("[busca-interno] exception raiz", e);
    return resp(500, { ok: false, erro: "exception_raiz", erro_debug: e?.message, stack: e?.stack?.slice(0, 1000) });
  }
});
