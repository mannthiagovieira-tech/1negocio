// pool-abordagem-registrar · v9.10.5 · 1Negócio
// Admin registra nova abordagem (interação) com contato do pool.
// Se proximo_contato_em vier, atualiza também o contato pra sincronizar.
//
// POST { contato_id, canal, tipo, descricao, data?, proximo_passo?, proximo_contato_em? }
// → 200 { ok, abordagem, contato_atualizado? }
// → 400 params_invalidos · 403 nao_autorizado · 404 contato_nao_encontrado

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

const CANAIS = new Set(["whatsapp", "ligacao", "email", "linkedin", "presencial", "outro"]);
const TIPOS = new Set(["primeiro_contato", "followup", "resposta", "reuniao", "proposta", "outro"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "metodo" }, 405);

  const gate = await gateAdmin(req);
  if (!gate.ok) return json({ ok: false, error: "nao_autorizado" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "json_invalido" }, 400); }

  const contato_id = String(body?.contato_id || "").trim();
  const canal = String(body?.canal || "").trim();
  const tipo = String(body?.tipo || "").trim();
  const descricao = String(body?.descricao || "").trim();

  if (!contato_id) return json({ ok: false, error: "params_invalidos", detalhe: "contato_id" }, 400);
  if (!CANAIS.has(canal)) return json({ ok: false, error: "params_invalidos", detalhe: "canal" }, 400);
  if (!TIPOS.has(tipo)) return json({ ok: false, error: "params_invalidos", detalhe: "tipo" }, 400);
  if (!descricao) return json({ ok: false, error: "params_invalidos", detalhe: "descricao" }, 400);

  const { data: contato } = await adminClient.from("projeto_pool_contatos").select("id").eq("id", contato_id).maybeSingle();
  if (!contato) return json({ ok: false, error: "contato_nao_encontrado" }, 404);

  const trunc = (v: unknown, n: number) => v == null ? null : String(v).trim().slice(0, n) || null;
  const dataAbordagem = body?.data ? new Date(body.data).toISOString() : new Date().toISOString();
  let proximoContatoEm: string | null = null;
  if (body?.proximo_contato_em) {
    const s = String(body.proximo_contato_em).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return json({ ok: false, error: "params_invalidos", detalhe: "proximo_contato_em" }, 400);
    proximoContatoEm = s;
  }

  const abordagemPayload = {
    contato_id,
    data: dataAbordagem,
    canal,
    tipo,
    descricao: descricao.slice(0, 4000),
    proximo_passo: trunc(body?.proximo_passo, 2000),
    proximo_contato_em: proximoContatoEm,
    created_by_admin_id: gate.admin_id || null,
  };

  const { data: abordagem, error: errA } = await adminClient
    .from("projeto_pool_abordagens").insert(abordagemPayload).select().maybeSingle();
  if (errA) return json({ ok: false, error: "erro_insert", detalhe: errA.message }, 500);

  // Sincroniza proximo_contato_em no contato se vier
  let contato_atualizado: any = null;
  if (proximoContatoEm) {
    const { data: cu } = await adminClient
      .from("projeto_pool_contatos")
      .update({ proximo_contato_em: proximoContatoEm, updated_at: new Date().toISOString() })
      .eq("id", contato_id)
      .select("id, proximo_contato_em")
      .maybeSingle();
    contato_atualizado = cu;
  }

  return json({ ok: true, abordagem, contato_atualizado });
});
