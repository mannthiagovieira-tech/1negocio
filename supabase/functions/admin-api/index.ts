import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const ALLOWED_TABLES = [
  "negocios",
  "usuarios",
  "admin_agenda",
  "leads_site",
  "leads_google",
  "disparos_whatsapp",
  "filiados",
  "transacoes",
  "admin_conversas",
  "admin_mensagens",
  "chat_ia_leads",
  "teses_investimento",
  "solicitacoes_info",
  "nda_solicitacoes",
  "laudos_completos",
  "termos_adesao",
  "laudos_v2",
  "anuncios_v2",
  "anuncio_eventos",
  "config_plataforma",
  "dossie_acessos",
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // --- 1. Extrair token do header Authorization ---
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Missing authorization token" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const accessToken = authHeader.replace("Bearer ", "").trim();

  // --- 2. Validar token via getUser() ---
  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await anonClient.auth.getUser(accessToken);

  if (userError || !userData?.user) {
    return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userPhone = userData.user.phone;
  if (!userPhone) {
    return new Response(JSON.stringify({ error: "Token does not contain a phone number" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // --- 3. Verificar se o usuario e admin ---
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: adminRow, error: adminError } = await adminClient
    .from("admins")
    .select("id, nome")
    .eq("whatsapp", userPhone)
    .maybeSingle();

  if (adminError || !adminRow) {
    return new Response(JSON.stringify({ error: "Access denied: not an admin" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // --- 4. Parse do body ---
  let body: { action: string; table: string; query?: string; data?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { action, table, query, data } = body;

  // --- 5. Validar tabela contra whitelist ---
  if (!table || !ALLOWED_TABLES.includes(table)) {
    return new Response(
      JSON.stringify({ error: "Table not allowed: " + String(table) }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // --- 6. Executar operacao com service_role via REST direto ---
  try {
    let result;

    if (action === "select") {
      const qs = query ? "?" + query : "";
      const res = await fetch(SUPABASE_URL + "/rest/v1/" + table + qs, {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": "application/json",
        },
      });
      result = await res.json();

    } else if (action === "insert") {
      const res = await fetch(SUPABASE_URL + "/rest/v1/" + table, {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(data),
      });
      result = await res.json();

    } else if (action === "update") {
      const qs = query ? "?" + query : "";
      const res = await fetch(SUPABASE_URL + "/rest/v1/" + table + qs, {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(data),
      });
      result = await res.json();

    } else if (action === "upsert") {
      // POST com Prefer: resolution=merge-duplicates (PostgREST UPSERT
      // por unique constraint — pra config_plataforma é PK 'chave').
      const res = await fetch(SUPABASE_URL + "/rest/v1/" + table, {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": "application/json",
          Prefer: "return=representation,resolution=merge-duplicates",
        },
        body: JSON.stringify(data),
      });
      result = await res.json();

    } else {
      return new Response(JSON.stringify({ error: "Unknown action: " + String(action) }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: "Internal error: " + msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
