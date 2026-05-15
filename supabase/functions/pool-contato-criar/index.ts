// pool-contato-criar · v9.10.5 · 1Negócio
// Admin cria novo contato no pool de potenciais compradores de um projeto.
//
// POST { negocio_id, nome, ...campos opcionais }
// → 200 { ok, contato }
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
    const { data: admin } = await adminClient.from("admins")
      .select("id").eq("whatsapp", data.user.phone).eq("ativo", true).maybeSingle();
    if (admin?.id) return { ok: true, admin_id: admin.id };
  } catch {}
  return { ok: false };
}

const ORIGENS = new Set(["linkedin", "indicacao", "cold_outreach", "evento", "midia", "outro"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "metodo" }, 405);

  const gate = await gateAdmin(req);
  if (!gate.ok) return json({ ok: false, error: "nao_autorizado" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "json_invalido" }, 400); }

  const negocio_id = String(body?.negocio_id || "").trim();
  const nome = String(body?.nome || "").trim();
  if (!negocio_id) return json({ ok: false, error: "params_invalidos", detalhe: "negocio_id" }, 400);
  if (!nome) return json({ ok: false, error: "params_invalidos", detalhe: "nome" }, 400);

  const origem = body?.origem ? String(body.origem).trim() : null;
  if (origem && !ORIGENS.has(origem)) return json({ ok: false, error: "params_invalidos", detalhe: "origem" }, 400);

  const { data: negocio } = await adminClient.from("negocios").select("id").eq("id", negocio_id).maybeSingle();
  if (!negocio) return json({ ok: false, error: "negocio_nao_encontrado" }, 404);

  const trunc = (v: unknown, n: number) => v == null ? null : String(v).trim().slice(0, n) || null;
  const payload = {
    negocio_id,
    nome: nome.slice(0, 200),
    empresa: trunc(body?.empresa, 200),
    cargo: trunc(body?.cargo, 200),
    telefone: trunc(body?.telefone, 50),
    email: trunc(body?.email, 200),
    linkedin_url: trunc(body?.linkedin_url, 500),
    setor_alvo: trunc(body?.setor_alvo, 200),
    regiao_alvo: trunc(body?.regiao_alvo, 200),
    faixa_faturamento: trunc(body?.faixa_faturamento, 100),
    perfil_descricao: trunc(body?.perfil_descricao, 2000),
    origem,
    origem_detalhe: trunc(body?.origem_detalhe, 2000),
    observacoes_admin: trunc(body?.observacoes_admin, 4000),
    created_by_admin_id: gate.admin_id || null,
  };

  const { data, error } = await adminClient.from("projeto_pool_contatos").insert(payload).select().maybeSingle();
  if (error) return json({ ok: false, error: "erro_insert", detalhe: error.message }, 500);

  return json({ ok: true, contato: data });
});
