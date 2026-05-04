// Edge Function: cowork-rodar-frente-corretores
// Etapa C · Cowork esqueleto · NÃO IMPLEMENTADO
// Roda google-places-proxy com cidade rotativa do dia · keywords corretor/consultor empresarial · classifica via IA · salva origem=gmaps_corretores ou gmaps_concorrentes
//
// Tabelas tocadas: cowork_cidades_alvo,leads_google
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

  // TODO Etapa C · implementar lógica completa.
  // Tabelas a tocar: cowork_cidades_alvo,leads_google
  // Resumo: Roda google-places-proxy com cidade rotativa do dia · keywords corretor/consultor empresarial · classifica via IA · salva origem=gmaps_corretores ou gmaps_concorrentes

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  void supabase; // silencia unused warning até implementar

  return new Response(
    JSON.stringify({
      ok: false,
      status: "stub",
      etapa: "C",
      slug: "cowork-rodar-frente-corretores",
      mensagem: "Esqueleto · não implementado · ver TODO no source"
    }),
    { status: 501, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
