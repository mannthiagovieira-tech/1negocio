// pool-contato-editar · v9.10.5 · 1Negócio
// Admin edita 1 campo do contato do pool via whitelist.
//
// POST { contato_id, campo, valor }
// → 200 { ok, campo, valor_salvo }
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

async function gateAdmin(req: Request): Promise<{ ok: boolean }> {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return { ok: false };
  const token = auth.slice(7);
  if (decodeJwtPayload(token)?.role === "service_role") return { ok: true };
  try {
    const { data, error } = await adminClient.auth.getUser(token);
    if (error || !data.user?.phone) return { ok: false };
    const { data: admin } = await adminClient.from("admins").select("id").eq("whatsapp", data.user.phone).eq("ativo", true).maybeSingle();
    if (admin?.id) return { ok: true };
  } catch {}
  return { ok: false };
}

// Whitelist · 16 campos editáveis (NÃO inclui negocio_id, id, timestamps, created_by)
const CAMPOS: Record<string, "text" | "text_curto" | "date" | "enum_status" | "enum_origem"> = {
  nome: "text",
  empresa: "text",
  cargo: "text",
  telefone: "text_curto",
  email: "text",
  linkedin_url: "text",
  setor_alvo: "text",
  regiao_alvo: "text",
  faixa_faturamento: "text_curto",
  perfil_descricao: "text",
  origem: "enum_origem",
  origem_detalhe: "text",
  status: "enum_status",
  motivo_perda: "text",
  observacoes_admin: "text",
  proximo_contato_em: "date",
};

const STATUS_VALIDOS = new Set(["frio","contatado","respondeu","qualificado","nda","proposta","fechou","perdeu"]);
const ORIGENS_VALIDAS = new Set(["linkedin","indicacao","cold_outreach","evento","midia","outro"]);

function coerce(tipo: string, raw: unknown): { ok: boolean; valor?: unknown; erro?: string } {
  if (raw === null || raw === undefined || raw === "") return { ok: true, valor: null };
  if (tipo === "text") {
    if (typeof raw !== "string") return { ok: false, erro: "esperava string" };
    return { ok: true, valor: raw.trim().slice(0, 4000) || null };
  }
  if (tipo === "text_curto") {
    if (typeof raw !== "string") return { ok: false, erro: "esperava string" };
    return { ok: true, valor: raw.trim().slice(0, 200) || null };
  }
  if (tipo === "date") {
    const s = String(raw).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { ok: false, erro: "data inválida (YYYY-MM-DD)" };
    return { ok: true, valor: s };
  }
  if (tipo === "enum_status") {
    if (!STATUS_VALIDOS.has(String(raw))) return { ok: false, erro: "status inválido" };
    return { ok: true, valor: String(raw) };
  }
  if (tipo === "enum_origem") {
    if (!ORIGENS_VALIDAS.has(String(raw))) return { ok: false, erro: "origem inválida" };
    return { ok: true, valor: String(raw) };
  }
  return { ok: false, erro: "tipo desconhecido" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "metodo" }, 405);

  const gate = await gateAdmin(req);
  if (!gate.ok) return json({ ok: false, error: "nao_autorizado" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "json_invalido" }, 400); }

  const contato_id = String(body?.contato_id || "").trim();
  const campo = String(body?.campo || "").trim();
  if (!contato_id) return json({ ok: false, error: "params_invalidos", detalhe: "contato_id" }, 400);
  if (!(campo in CAMPOS)) return json({ ok: false, error: "campo_invalido", detalhe: campo }, 400);

  const c = coerce(CAMPOS[campo], body?.valor);
  if (!c.ok) return json({ ok: false, error: "valor_invalido", detalhe: c.erro }, 400);

  const update: Record<string, unknown> = { [campo]: c.valor, updated_at: new Date().toISOString() };
  const { data, error } = await adminClient
    .from("projeto_pool_contatos").update(update).eq("id", contato_id).select(`id, ${campo}`).maybeSingle();
  if (error) return json({ ok: false, error: "erro_update", detalhe: error.message }, 500);
  if (!data) return json({ ok: false, error: "contato_nao_encontrado" }, 404);

  return json({ ok: true, campo, valor_salvo: (data as any)[campo] });
});
