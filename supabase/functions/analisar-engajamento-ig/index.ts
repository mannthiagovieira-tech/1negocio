// Edge Function: analisar-engajamento-ig
// Etapa F · Cowork esqueleto · NÃO IMPLEMENTADO
// Chamada após cada scrap de post · classifica likers/commenters via Haiku · checa bio · marca classificacao_ia
//
// Tabelas tocadas: instagram_engajamento
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
  // Tabelas a tocar: instagram_engajamento
  // Resumo: Chamada após cada scrap de post · classifica likers/commenters via Haiku · checa bio · marca classificacao_ia

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  void supabase; // silencia unused warning até implementar

  return new Response(
    JSON.stringify({
      ok: false,
      status: "stub",
      etapa: "F",
      slug: "analisar-engajamento-ig",
      mensagem: "Esqueleto · não implementado · ver TODO no source"
    }),
    { status: 501, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
