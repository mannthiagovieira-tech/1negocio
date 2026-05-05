// Edge Function: import-leads-base
// Bulk import de leads da base manual (CSV) com dedup global por telefone
//
// POST /functions/v1/import-leads-base
// Body: { leads: [{ nome, telefone, email, estado, tags[], created_at }, ...] }
// Returns: { ok, recebidos, inseridos, merged, erro? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));
    const leads = Array.isArray(body?.leads) ? body.leads : [];
    if (!leads.length) return new Response(JSON.stringify({ ok: false, erro: "leads array vazio" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

    const ORIGEM = body.origem || "base_manual_2026_05";
    const CAMP = body.campanha || "base_manual_2026_05";

    // Chama PL/pgSQL function via RPC · tudo atômico no banco
    const { data, error } = await supabase.rpc("bulk_import_leads_base", {
      payload: leads,
      p_origem: ORIGEM,
      p_campanha: CAMP,
    });
    if (error) return new Response(JSON.stringify({ ok: false, erro: "rpc: " + error.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ ok: true, ...(data as any) }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, erro: String((e as Error).message) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
