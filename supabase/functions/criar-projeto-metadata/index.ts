// criar-projeto-metadata · v9.10 Módulo 1 (1/3) · 1Negócio
// Admin cria/reativa projeto_metadata enriquecido + flag negócio como assessorado.
//
// POST {
//   negocio_id, motivo_inicio, motivo_detalhe?,
//   valor_mensal_receita, verba_ads_mensal?,
//   publico_alvo_descricao, publico_alvo_perfil_compradores?,
//   meta_abordagens_mensal, meta_abordagens_anual, meta_fechamento_data?,
//   valor_venda_alvo, comissao_percentual
// }
// → 200 { ok, projeto_metadata }
// → 401 sem_jwt / jwt_invalido · 403 nao_autorizado · 404 negocio_nao_encontrado
// → 409 projeto_ativo_existe · 400 params_invalidos

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function json(d: unknown, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function decodeJwtPayload(t: string): any | null {
  try {
    const p = t.split(".");
    if (p.length !== 3) return null;
    const b64 = p[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64 + "=".repeat((4 - b64.length % 4) % 4)));
  } catch { return null; }
}

async function gateAdmin(req: Request): Promise<{ ok: boolean; admin_id?: string | null }> {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return { ok: false };
  const token = auth.slice(7);
  if (decodeJwtPayload(token)?.role === "service_role") return { ok: true, admin_id: null };
  try {
    const { data, error } = await adminClient.auth.getUser(token);
    if (error || !data.user?.phone) return { ok: false };
    const { data: admin } = await adminClient.from("admins")
      .select("id").eq("whatsapp", data.user.phone).eq("ativo", true).maybeSingle();
    if (admin?.id) return { ok: true, admin_id: admin.id };
  } catch {}
  return { ok: false };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "metodo" }, 405);

  const gate = await gateAdmin(req);
  if (!gate.ok) return json({ ok: false, error: "nao_autorizado" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "json_invalido" }, 400); }

  const {
    negocio_id,
    motivo_inicio,
    motivo_detalhe,
    valor_mensal_receita,
    verba_ads_mensal,
    publico_alvo_descricao,
    publico_alvo_perfil_compradores,
    meta_abordagens_mensal,
    meta_abordagens_anual,
    meta_fechamento_data,
    valor_venda_alvo,
    comissao_percentual,
  } = body || {};

  const obrigatorios: Record<string, unknown> = {
    negocio_id, motivo_inicio, valor_mensal_receita,
    publico_alvo_descricao, meta_abordagens_mensal, meta_abordagens_anual,
    valor_venda_alvo, comissao_percentual,
  };
  for (const [k, v] of Object.entries(obrigatorios)) {
    if (v === undefined || v === null || v === "") {
      return json({ ok: false, error: "params_invalidos", detalhe: `campo obrigatório: ${k}` }, 400);
    }
  }

  const { data: negocio } = await adminClient
    .from("negocios").select("id, plano").eq("id", negocio_id).maybeSingle();
  if (!negocio) return json({ ok: false, error: "negocio_nao_encontrado" }, 404);

  const { data: metaExistente } = await adminClient
    .from("projeto_metadata").select("id, status").eq("negocio_id", negocio_id).maybeSingle();

  if (metaExistente && metaExistente.status === "ativo") {
    return json({ ok: false, error: "projeto_ativo_existe" }, 409);
  }

  await adminClient.from("negocios").update({ plano: "assessorada" }).eq("id", negocio_id);

  const payload: Record<string, unknown> = {
    negocio_id,
    motivo_inicio,
    motivo_detalhe: motivo_detalhe || null,
    valor_mensal_receita,
    verba_ads_mensal: verba_ads_mensal ?? null,
    publico_alvo_descricao,
    publico_alvo_perfil_compradores: publico_alvo_perfil_compradores || null,
    meta_abordagens_mensal,
    meta_abordagens_anual,
    meta_fechamento_data: meta_fechamento_data || null,
    valor_venda_alvo,
    comissao_percentual,
    status: "ativo",
    updated_at: new Date().toISOString(),
  };

  let result: any;
  if (metaExistente) {
    const { data, error } = await adminClient
      .from("projeto_metadata").update(payload).eq("id", metaExistente.id).select().maybeSingle();
    if (error) return json({ ok: false, error: "erro_update", detalhe: error.message }, 500);
    result = data;
  } else {
    const insertPayload = { ...payload, iniciado_em: new Date().toISOString() };
    const { data, error } = await adminClient
      .from("projeto_metadata").insert(insertPayload).select().maybeSingle();
    if (error) return json({ ok: false, error: "erro_insert", detalhe: error.message }, 500);
    result = data;
  }

  return json({ ok: true, projeto_metadata: result });
});
