// editar-peca-texto · v9.12 · 1Negócio
// Admin edita o texto da peça (mantém texto_gerado original · grava em texto_editado).
//
// POST { peca_id, texto_editado }
// → 200 { ok, peca }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};
function json(d: unknown, s = 200) { return new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
function decodeJwtPayload(t: string): any | null { try { const p = t.split("."); if (p.length !== 3) return null; const b64 = p[1].replace(/-/g, "+").replace(/_/g, "/"); return JSON.parse(atob(b64 + "=".repeat((4 - b64.length % 4) % 4))); } catch { return null; } }
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "metodo" }, 405);

  const gate = await gateAdmin(req);
  if (!gate.ok) return json({ ok: false, error: "nao_autorizado" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "json_invalido" }, 400); }

  const peca_id = String(body?.peca_id || "").trim();
  const texto_editado = body?.texto_editado != null ? String(body.texto_editado).slice(0, 4000) : "";
  if (!peca_id) return json({ ok: false, error: "params_invalidos", detalhe: "peca_id" }, 400);
  if (!texto_editado) return json({ ok: false, error: "params_invalidos", detalhe: "texto_editado" }, 400);

  const { data, error } = await adminClient
    .from("pecas_geradas")
    .update({ texto_editado, updated_at: new Date().toISOString() })
    .eq("id", peca_id)
    .select("id, texto_editado, updated_at")
    .maybeSingle();
  if (error) return json({ ok: false, error: "erro_update", detalhe: error.message }, 500);
  if (!data) return json({ ok: false, error: "peca_nao_encontrada" }, 404);

  return json({ ok: true, peca: data });
});
