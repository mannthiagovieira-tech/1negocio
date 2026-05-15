// Edge Function: cowork-distribuir-instagram-diario
// Etapa C · Cowork esqueleto · NÃO IMPLEMENTADO
// Pega 200 perfis IG classificados como 'empreendedor' não distribuídos e marca distribuido_em=hoje · entram no plano diário
//
// Tabelas tocadas: ig_seguidores_raw
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
  // Tabelas a tocar: ig_seguidores_raw
  // Resumo: Pega 200 perfis IG classificados como 'empreendedor' não distribuídos e marca distribuido_em=hoje · entram no plano diário

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  void supabase; // silencia unused warning até implementar

  return new Response(
    JSON.stringify({
      ok: false,
      status: "stub",
      etapa: "C",
      slug: "cowork-distribuir-instagram-diario",
      mensagem: "Esqueleto · não implementado · ver TODO no source"
    }),
    { status: 501, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
