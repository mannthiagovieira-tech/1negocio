// vencimento-marcar-recebido · v9.10.6 · 1Negócio
// Admin marca vencimento como recebido · cria movimentação + vincula.
//
// POST { vencimento_id, data_real?, valor_real?, descricao_extra? }
// → 200 { ok, vencimento, movimentacao }
// → 400 params_invalidos · 403 nao_autorizado · 404 vencimento_nao_encontrado
// → 409 estado_invalido (status já fechado)

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
    const { data: admin } = await adminClient.from("admins").select("id").eq("whatsapp", data.user.phone).eq("ativo", true).maybeSingle();
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

  const vencimento_id = String(body?.vencimento_id || "").trim();
  if (!vencimento_id) return json({ ok: false, error: "params_invalidos", detalhe: "vencimento_id" }, 400);

  // Busca vencimento
  const { data: venc } = await adminClient
    .from("projeto_vencimentos")
    .select("id, negocio_id, tipo, categoria, valor, data_prevista, descricao, status")
    .eq("id", vencimento_id).maybeSingle();
  if (!venc) return json({ ok: false, error: "vencimento_nao_encontrado" }, 404);

  if (venc.status === "recebido" || venc.status === "cancelado") {
    return json({ ok: false, error: "estado_invalido", detalhe: "status atual=" + venc.status }, 409);
  }

  const dataReal = body?.data_real ? String(body.data_real).slice(0, 10) : new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataReal)) return json({ ok: false, error: "params_invalidos", detalhe: "data_real" }, 400);

  const valorReal = body?.valor_real != null ? Number(body.valor_real) : Number(venc.valor);
  if (!Number.isFinite(valorReal) || valorReal <= 0) return json({ ok: false, error: "params_invalidos", detalhe: "valor_real" }, 400);

  const descExtra = body?.descricao_extra != null ? String(body.descricao_extra).trim().slice(0, 500) : "";
  const descricaoFinal = (descExtra || venc.descricao || "") + " [via vencimento]";

  // 1. INSERT movimentação
  const movPayload = {
    negocio_id: venc.negocio_id,
    tipo: venc.tipo,
    categoria: venc.categoria,
    valor: valorReal,
    data: dataReal,
    descricao: descricaoFinal.trim().slice(0, 500),
    created_by_admin_id: gate.admin_id || null,
  };
  const { data: mov, error: errMov } = await adminClient
    .from("projeto_movimentacoes").insert(movPayload).select().maybeSingle();
  if (errMov) return json({ ok: false, error: "erro_insert_movimentacao", detalhe: errMov.message }, 500);

  // 2. UPDATE vencimento
  const { data: vencAtualizado, error: errUp } = await adminClient
    .from("projeto_vencimentos")
    .update({
      status: "recebido",
      recebido_em: new Date().toISOString(),
      movimentacao_id: mov!.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", vencimento_id)
    .select()
    .maybeSingle();
  if (errUp) {
    // tenta rollback da movimentação
    await adminClient.from("projeto_movimentacoes").delete().eq("id", mov!.id);
    return json({ ok: false, error: "erro_update_vencimento", detalhe: errUp.message }, 500);
  }

  return json({ ok: true, vencimento: vencAtualizado, movimentacao: mov });
});
