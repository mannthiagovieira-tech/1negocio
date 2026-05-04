// Edge Function: cowork-gerar-pecas-feed
// Etapa E · Cowork esqueleto · NÃO IMPLEMENTADO
// Escolhe 3 negócios (frescor + setor moda) · pra cada · POST gerar-conteudo-post · salva em pecas_geradas com status=aguardando_aprovacao
//
// Tabelas tocadas: negocios,anuncios_v2,pecas_geradas
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
  // Tabelas a tocar: negocios,anuncios_v2,pecas_geradas
  // Resumo: Escolhe 3 negócios (frescor + setor moda) · pra cada · POST gerar-conteudo-post · salva em pecas_geradas com status=aguardando_aprovacao

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  void supabase; // silencia unused warning até implementar

  return new Response(
    JSON.stringify({
      ok: false,
      status: "stub",
      etapa: "E",
      slug: "cowork-gerar-pecas-feed",
      mensagem: "Esqueleto · não implementado · ver TODO no source"
    }),
    { status: 501, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
