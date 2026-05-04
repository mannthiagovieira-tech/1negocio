// Edge Function: monitorar-ads-concorrente
// Etapa G · Cowork esqueleto · NÃO IMPLEMENTADO
// Pra cada ads_concorrentes_monitorados ativo · POST apify/facebook-ads-library-scraper · cria ads_snapshots · análise IA semanal · notifica domingo 8h
//
// Tabelas tocadas: ads_concorrentes_monitorados,ads_snapshots
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

  // TODO Etapa G · implementar lógica completa.
  // Tabelas a tocar: ads_concorrentes_monitorados,ads_snapshots
  // Resumo: Pra cada ads_concorrentes_monitorados ativo · POST apify/facebook-ads-library-scraper · cria ads_snapshots · análise IA semanal · notifica domingo 8h

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  void supabase; // silencia unused warning até implementar

  return new Response(
    JSON.stringify({
      ok: false,
      status: "stub",
      etapa: "G",
      slug: "monitorar-ads-concorrente",
      mensagem: "Esqueleto · não implementado · ver TODO no source"
    }),
    { status: 501, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
