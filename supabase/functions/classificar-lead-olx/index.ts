// Edge Function: classificar-lead-olx
// Etapa B · Cowork esqueleto · NÃO IMPLEMENTADO
// Classifica leads do OLX em negocio_funcionamento/imovel_residencial/ponto_vazio/ambiguo via Claude Haiku
//
// Tabelas tocadas: leads_google,classificacao_ia
// Status: STUB · retorna ok:false com status='stub'
// Para ativar: substituir o handler abaixo pela implementação real.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // TODO Etapa B · implementar lógica completa.
  // Tabelas a tocar: leads_google,classificacao_ia
  // Resumo: Classifica leads do OLX em negocio_funcionamento/imovel_residencial/ponto_vazio/ambiguo via Claude Haiku

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  void supabase; // silencia unused warning até implementar

  return new Response(
    JSON.stringify({
      ok: false,
      status: "stub",
      etapa: "B",
      slug: "classificar-lead-olx",
      mensagem: "Esqueleto · não implementado · ver TODO no source"
    }),
    { status: 501, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
