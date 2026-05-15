// socio-validar-phone · V8 B8.13 SUB-BLOCO B FASE 2 · 1Negócio
// Verifica se um phone existe em auth.users · usado pelo modal do sócio
// pra decidir se cadastra pra usuário existente ou cria ghost.
//
// POST { phone }  → 200 { ok, existe, user_id?, nome? }
// Auth: sócio aprovado (auth.uid → busca em socios) OU service_role.

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

async function gateSocio(req: Request): Promise<{ ok: boolean; socio_id?: string }> {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return { ok: false };
  const token = auth.slice(7);
  if (decodeJwtPayload(token)?.role === "service_role") return { ok: true };
  try {
    const { data, error } = await adminClient.auth.getUser(token);
    if (error || !data.user?.id) return { ok: false };
    const { data: socio } = await adminClient.from("socios")
      .select("id, status").eq("usuario_id", data.user.id).maybeSingle();
    if (!socio || socio.status !== "aprovado") return { ok: false };
    return { ok: true, socio_id: socio.id };
  } catch {
    return { ok: false };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "metodo" }, 405);

  const gate = await gateSocio(req);
  if (!gate.ok) return json({ ok: false, error: "socio_required" }, 403);

  let body: { phone?: string };
  try { body = await req.json(); } catch { return json({ ok: false, error: "json_invalido" }, 400); }

  const phoneLimpo = String(body?.phone || "").replace(/\D/g, "");
  if (!phoneLimpo || phoneLimpo.length < 10) {
    return json({ ok: false, error: "phone_invalido" }, 400);
  }

  // Normaliza com prefixo 55 se faltar (Brasil) · auth.users.phone tem 55 + DDD + número
  const phoneCom55 = phoneLimpo.startsWith("55") ? phoneLimpo : "55" + phoneLimpo;

  // Busca via admin · listUsers tem paginação · usamos perPage alto
  try {
    const { data: page } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
    const users = page?.users || [];
    const user = users.find((u: any) =>
      u.phone === phoneCom55 ||
      u.phone === phoneLimpo ||
      u.user_metadata?.phone === phoneCom55 ||
      u.user_metadata?.phone === phoneLimpo
    );
    if (user) {
      const meta: any = user.user_metadata || {};
      return json({
        ok: true,
        existe: true,
        user_id: user.id,
        nome: meta.nome || meta.full_name || meta.name || null,
      });
    }
    return json({ ok: true, existe: false });
  } catch (e) {
    return json({ ok: false, error: "busca_falhou", detalhe: (e as Error).message }, 500);
  }
});
