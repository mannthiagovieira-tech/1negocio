// Edge Function: monitorar-post-instagram
// Etapa F · Cowork esqueleto · NÃO IMPLEMENTADO
// Pra cada ig_posts_monitorados ativo · POST apify/instagram-post-scraper · captura métricas + likers + commenters · cria ig_posts_snapshots · classifica engajamento
//
// Tabelas tocadas: ig_posts_monitorados,ig_posts_snapshots,instagram_engajamento
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

  // TODO Etapa F · implementar lógica completa.
  // Tabelas a tocar: ig_posts_monitorados,ig_posts_snapshots,instagram_engajamento
  // Resumo: Pra cada ig_posts_monitorados ativo · POST apify/instagram-post-scraper · captura métricas + likers + commenters · cria ig_posts_snapshots · classifica engajamento

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  void supabase; // silencia unused warning até implementar

  return new Response(
    JSON.stringify({
      ok: false,
      status: "stub",
      etapa: "F",
      slug: "monitorar-post-instagram",
      mensagem: "Esqueleto · não implementado · ver TODO no source"
    }),
    { status: 501, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
