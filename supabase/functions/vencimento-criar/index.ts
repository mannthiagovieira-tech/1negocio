// vencimento-criar · v9.10.6 · 1Negócio
// Admin lança vencimento planejado no projeto.
//
// POST { negocio_id, tipo, categoria, valor, data_prevista, descricao?, recorrencia? }
// → 200 { ok, vencimento }
// → 400 params_invalidos · 403 nao_autorizado · 404 negocio_nao_encontrado

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

const TIPOS = new Set(["entrada", "saida"]);
const CATEGORIAS = new Set([
  "mensalidade_assessorada", "venda_empresa", "ads_meta", "ads_google",
  "ads_outro", "comissao_socio", "taxa_plataforma", "reembolso", "outro",
]);
const RECORRENCIAS = new Set(["mensal", "trimestral", "anual"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "metodo" }, 405);

  const gate = await gateAdmin(req);
  if (!gate.ok) return json({ ok: false, error: "nao_autorizado" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "json_invalido" }, 400); }

  const negocio_id = String(body?.negocio_id || "").trim();
  const tipo = String(body?.tipo || "").trim();
  const categoria = String(body?.categoria || "").trim();
  const valor = Number(body?.valor);
  const data_prevista = body?.data_prevista ? String(body.data_prevista).slice(0, 10) : "";
  const descricao = body?.descricao != null ? String(body.descricao).trim().slice(0, 1000) || null : null;
  const recorrencia = body?.recorrencia ? String(body.recorrencia).trim() : null;

  if (!negocio_id) return json({ ok: false, error: "params_invalidos", detalhe: "negocio_id" }, 400);
  if (!TIPOS.has(tipo)) return json({ ok: false, error: "params_invalidos", detalhe: "tipo" }, 400);
  if (!CATEGORIAS.has(categoria)) return json({ ok: false, error: "params_invalidos", detalhe: "categoria" }, 400);
  if (!Number.isFinite(valor) || valor <= 0) return json({ ok: false, error: "params_invalidos", detalhe: "valor" }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data_prevista)) return json({ ok: false, error: "params_invalidos", detalhe: "data_prevista" }, 400);
  if (recorrencia && !RECORRENCIAS.has(recorrencia)) return json({ ok: false, error: "params_invalidos", detalhe: "recorrencia" }, 400);

  const { data: negocio } = await adminClient.from("negocios").select("id").eq("id", negocio_id).maybeSingle();
  if (!negocio) return json({ ok: false, error: "negocio_nao_encontrado" }, 404);

  const payload = {
    negocio_id, tipo, categoria, valor, data_prevista, descricao,
    recorrencia,
    created_by_admin_id: gate.admin_id || null,
  };

  const { data, error } = await adminClient.from("projeto_vencimentos").insert(payload).select().maybeSingle();
  if (error) return json({ ok: false, error: "erro_insert", detalhe: error.message }, 500);

  return json({ ok: true, vencimento: data });
});
