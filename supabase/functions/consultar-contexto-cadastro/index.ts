// supabase/functions/consultar-contexto-cadastro/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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
  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: any;
  try { body = await req.json(); } catch {
    return resp(400, { ok: false, erro: "json_invalido" });
  }

  const token = String(body?.ctx_token || "").trim();
  if (!token || token.length < 16) {
    return resp(400, { ok: false, erro: "token_invalido", mensagem: "Token ausente" });
  }

  const { data: notif, error } = await adminClient
    .from("notificacoes_proprietario")
    .select("id, proprietario_id, proprietario_phone, acao, status, expira_em, socio_id_origem")
    .eq("deep_link_token", token)
    .maybeSingle();

  if (error) {
    console.error("erro buscar notif:", error);
    return resp(500, { ok: false, erro: "erro_interno" });
  }
  if (!notif) {
    return resp(404, { ok: false, erro: "token_invalido", mensagem: "Token inválido" });
  }
  if (notif.status === "consumido") {
    return resp(409, { ok: false, erro: "token_consumido", mensagem: "Esse cadastro já foi finalizado." });
  }
  if (notif.status !== "pendente") {
    return resp(409, { ok: false, erro: "token_status", mensagem: `Token em status ${notif.status}` });
  }
  if (notif.expira_em && new Date(notif.expira_em) < new Date()) {
    return resp(410, { ok: false, erro: "token_expirado", mensagem: "Token expirou. Peça um novo link ao sócio." });
  }
  if (notif.acao !== "completar_cadastro_tese" && notif.acao !== "completar_cadastro_negocio") {
    return resp(400, { ok: false, erro: "acao_invalida", mensagem: "Token não é pra cadastro" });
  }

  // Busca dados do sócio
  const { data: socio } = await adminClient
    .from("socios")
    .select("id, codigo, usuario_id")
    .eq("id", notif.socio_id_origem)
    .maybeSingle();

  let socio_nome: string | null = null;
  if (socio?.usuario_id) {
    const { data: socioUser } = await adminClient
      .from("usuarios")
      .select("nome")
      .eq("id", socio.usuario_id)
      .maybeSingle();
    socio_nome = socioUser?.nome || null;
  }

  // Busca dados do proprietário (pra mostrar no header)
  const { data: propUser } = await adminClient
    .from("usuarios")
    .select("nome")
    .eq("id", notif.proprietario_id)
    .maybeSingle();

  const tipo = notif.acao === "completar_cadastro_tese" ? "tese" : "diagnostico";

  return resp(200, {
    ok: true,
    valido: true,
    tipo,
    proprietario_id: notif.proprietario_id,
    proprietario_phone: notif.proprietario_phone,
    proprietario_nome: propUser?.nome || null,
    socio_codigo: socio?.codigo || null,
    socio_nome,
  });
});
