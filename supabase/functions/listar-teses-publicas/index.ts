// supabase/functions/listar-teses-publicas/index.ts
// v9.7 · Sócio aprovado lista teses ativas com dados anonimizados
// (sem usuario_id, sem whatsapp, sem email do dono).
//
// Gate: JWT válido + socios.status='aprovado'.
// POST { setor?, estado?, valor_min?, valor_max?, limit? }
// → 200 { ok, total, teses[] }
// → 401 sem_jwt | jwt_invalido · 403 nao_eh_socio · 500 erro_interno
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function resp(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return resp(405, { ok: false, erro: "metodo" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

  // Gate · sócio aprovado
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return resp(401, { ok: false, erro: "sem_jwt" });

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user?.id) return resp(401, { ok: false, erro: "jwt_invalido" });

  const { data: socio } = await adminClient
    .from("socios")
    .select("id, status")
    .eq("usuario_id", userData.user.id)
    .maybeSingle();
  if (!socio || socio.status !== "aprovado") {
    return resp(403, { ok: false, erro: "nao_eh_socio" });
  }

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const { setor, estado, valor_min, valor_max, limit } = body;

  // v9.8 · usuario_id é puxado APENAS pra calcular is_minha · removido do retorno antes de responder
  let query = adminClient
    .from("teses_investimento")
    .select("id, codigo, titulo, setores, formas_atuacao, localizacao_tipo, estado, cidade, valor_alvo, observacoes, created_at, status, usuario_id")
    .eq("status", "ativa")
    .order("created_at", { ascending: false })
    .limit(Math.min(Number(limit) || 100, 200));

  if (setor) query = query.contains("setores", [setor]);
  if (estado) query = query.eq("estado", estado);
  if (valor_min) query = query.gte("valor_alvo", valor_min);
  if (valor_max) query = query.lte("valor_alvo", valor_max);

  const { data: teses, error } = await query;
  if (error) {
    console.error("erro listar teses:", error);
    return resp(500, { ok: false, erro: "erro_interno" });
  }

  // v9.8 · injeta is_minha e remove usuario_id antes de responder (anonimização)
  const tesesEnriquecidas = (teses || []).map((t: any) => {
    const enriched = { ...t, is_minha: t.usuario_id === userData.user!.id };
    delete enriched.usuario_id;
    return enriched;
  });

  return resp(200, {
    ok: true,
    total: tesesEnriquecidas.length,
    teses: tesesEnriquecidas,
  });
});
