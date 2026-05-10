// supabase/functions/lookup-proprietario-por-phone/index.ts
// Sócio aprovado consulta se um phone já tem cadastro · retorna nome
// pra auto-preencher no modal de cadastro pra terceiro.
// Não revela proprietario_id · só nome + flag is_ghost.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function resp(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return resp(405, { ok: false, erro: "metodo" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

  // Gate · sócio aprovado
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return resp(401, { ok: false, erro: "sem_jwt" });

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user?.id) return resp(401, { ok: false, erro: "jwt_invalido" });

  const { data: socio } = await adminClient
    .from("socios")
    .select("id, status")
    .eq("usuario_id", userData.user.id)
    .maybeSingle();
  if (!socio || socio.status !== "aprovado") {
    return resp(403, { ok: false, erro: "nao_eh_socio" });
  }

  let body: any;
  try { body = await req.json(); } catch {
    return resp(400, { ok: false, erro: "json_invalido" });
  }

  const phoneRaw = String(body?.phone || "").replace(/\D/g, "");
  if (phoneRaw.length < 10) return resp(400, { ok: false, erro: "phone_invalido" });
  const phoneE164 = "+" + (phoneRaw.startsWith("55") ? phoneRaw : "55" + phoneRaw);

  // Lookup via RPC canônico
  const { data, error } = await adminClient.rpc("get_user_by_phone", {
    p_phone: phoneE164,
  });
  if (error) {
    console.error("erro rpc:", error);
    return resp(500, { ok: false, erro: "erro_interno" });
  }
  if (!Array.isArray(data) || data.length === 0) {
    return resp(200, { ok: true, encontrado: false });
  }

  const userId = data[0].id;
  const meta = data[0].raw_user_meta_data || {};
  const isGhost = meta.ghost === true;

  // Busca nome em public.usuarios (mais canônico que metadata)
  const { data: usuarioRow } = await adminClient
    .from("usuarios")
    .select("nome")
    .eq("id", userId)
    .maybeSingle();

  return resp(200, {
    ok: true,
    encontrado: true,
    nome: usuarioRow?.nome || meta.nome || null,
    is_ghost: isGhost,
  });
});
