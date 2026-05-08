// otp-refresh · V8 BLOCO 2 · 1negocio.com.br
// Renova access_token usando refresh_token salvo no localStorage do client.
// Não requer JWT bearer · refresh_token é a credencial.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function json(d: unknown, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "metodo_nao_permitido" }, 405);

  let body: { refresh_token?: string };
  try { body = await req.json(); } catch { return json({ error: "json_invalido" }, 400); }

  const refresh_token = (body.refresh_token || "").trim();
  if (!refresh_token) return json({ error: "missing_refresh_token" }, 400);

  try {
    const { data, error } = await anonClient.auth.refreshSession({ refresh_token });
    if (error || !data?.session || !data.user) {
      return json({ error: "refresh_invalid", detail: error?.message }, 401);
    }

    // Checa admin pra preservar flag (alguns HTMLs leem)
    let is_admin = false;
    if (data.user.phone) {
      const { count } = await adminClient
        .from("admins")
        .select("id", { count: "exact", head: true })
        .eq("whatsapp", data.user.phone)
        .eq("ativo", true);
      is_admin = (count ?? 0) > 0;
    }

    return json({
      ok: true,
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      user_id: data.user.id,
      expires_at: data.session.expires_at,
      is_admin,
    });
  } catch (e) {
    return json({ error: "internal", detail: (e as Error).message }, 500);
  }
});
