// Edge Function: zapi-reset-contadores-diarios
// Cron diário 00:00 BRT (= 03:00 UTC) · zera total_enviados_hoje em zapi_telefones
// Permite que cada telefone tenha contagem fresca pra novo dia

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb = createClient(SB_URL, SB_SERVICE);

  const { error, count } = await sb.from("zapi_telefones")
    .update({ total_enviados_hoje: 0 }, { count: "exact" })
    .gt("total_enviados_hoje", 0);

  if (error) {
    return new Response(JSON.stringify({ ok: false, erro: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ ok: true, telefones_resetados: count || 0 }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
