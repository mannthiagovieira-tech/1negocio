// Edge Function: cowork-gerar-roteiro-stories
// Etapa E · Cowork esqueleto · NÃO IMPLEMENTADO
// Escolhe 1 negócio publicado · gera roteiro 45-60s (Gancho/Contexto/Dados/Valor/CTA) via Sonnet · salva em cowork_roteiros_stories
//
// Tabelas tocadas: negocios,laudos_v2,cowork_roteiros_stories
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

  // TODO Etapa E · implementar lógica completa.
  // Tabelas a tocar: negocios,laudos_v2,cowork_roteiros_stories
  // Resumo: Escolhe 1 negócio publicado · gera roteiro 45-60s (Gancho/Contexto/Dados/Valor/CTA) via Sonnet · salva em cowork_roteiros_stories

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  void supabase; // silencia unused warning até implementar

  return new Response(
    JSON.stringify({
      ok: false,
      status: "stub",
      etapa: "E",
      slug: "cowork-gerar-roteiro-stories",
      mensagem: "Esqueleto · não implementado · ver TODO no source"
    }),
    { status: 501, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
