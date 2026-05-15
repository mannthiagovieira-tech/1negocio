// editar-projeto-campo · v9.10.1 · 1Negócio
// Admin edita 1 campo do projeto_metadata por vez (via whitelist).
//
// POST { negocio_id, campo, valor }
// → 200 { ok, campo, valor_salvo }
// → 400 params_invalidos · 403 nao_autorizado · 404 projeto_nao_encontrado

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

// Whitelist · só esses 9 campos podem ser editados via edge (motivo_detalhe inclusivo)
const CAMPOS_VALIDOS: Record<string, "text" | "number" | "integer" | "jsonb"> = {
  motivo_detalhe: "text",
  valor_mensal_receita: "number",
  verba_ads_mensal: "number",
  publico_alvo_descricao: "text",
  publico_alvo_perfil_compradores: "jsonb",
  meta_abordagens_mensal: "integer",
  meta_abordagens_anual: "integer",
  valor_venda_alvo: "number",
  comissao_percentual: "number",
};

function coerce(tipo: string, raw: unknown): { ok: boolean; valor?: unknown; erro?: string } {
  if (raw === null || raw === "" || raw === undefined) return { ok: true, valor: null };
  if (tipo === "text") {
    if (typeof raw !== "string") return { ok: false, erro: "esperava string" };
    return { ok: true, valor: raw.trim().slice(0, 4000) || null };
  }
  if (tipo === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n)) return { ok: false, erro: "número inválido" };
    return { ok: true, valor: n };
  }
  if (tipo === "integer") {
    const n = parseInt(String(raw), 10);
    if (!Number.isFinite(n)) return { ok: false, erro: "inteiro inválido" };
    return { ok: true, valor: n };
  }
  if (tipo === "jsonb") {
    if (typeof raw === "object") return { ok: true, valor: raw };
    try { return { ok: true, valor: JSON.parse(String(raw)) }; } catch { return { ok: false, erro: "json inválido" }; }
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

  const negocio_id = String(body?.negocio_id || "").trim();
  const campo = String(body?.campo || "").trim();
  if (!negocio_id) return json({ ok: false, error: "params_invalidos", detalhe: "negocio_id" }, 400);
  if (!(campo in CAMPOS_VALIDOS)) return json({ ok: false, error: "campo_invalido", detalhe: campo }, 400);

  const c = coerce(CAMPOS_VALIDOS[campo], body?.valor);
  if (!c.ok) return json({ ok: false, error: "valor_invalido", detalhe: c.erro }, 400);

  if (campo === "comissao_percentual" && c.valor !== null) {
    const n = c.valor as number;
    if (n < 0 || n > 100) return json({ ok: false, error: "valor_invalido", detalhe: "comissão fora de 0-100" }, 400);
  }
  if ((campo === "meta_abordagens_mensal" || campo === "meta_abordagens_anual") && c.valor !== null) {
    if ((c.valor as number) <= 0) return json({ ok: false, error: "valor_invalido", detalhe: "meta deve ser > 0" }, 400);
  }

  const update: Record<string, unknown> = { [campo]: c.valor, updated_at: new Date().toISOString() };
  const { data, error } = await adminClient
    .from("projeto_metadata").update(update).eq("negocio_id", negocio_id).eq("status", "ativo").select(`id, ${campo}`).maybeSingle();
  if (error) return json({ ok: false, error: "erro_update", detalhe: error.message }, 500);
  if (!data) return json({ ok: false, error: "projeto_nao_encontrado" }, 404);

  return json({ ok: true, campo, valor_salvo: (data as any)[campo] });
});
