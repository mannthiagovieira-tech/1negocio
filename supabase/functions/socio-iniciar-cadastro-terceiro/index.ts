// supabase/functions/socio-iniciar-cadastro-terceiro/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { findOrCreateGhost, ensureUsuarioRow } from "../_shared/ghost.ts";

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
  if (req.method !== "POST") return resp(405, { ok: false, erro: "metodo", mensagem: "POST only" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

  // 1) Identifica sócio via JWT
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) {
    return resp(401, { ok: false, erro: "sem_jwt", mensagem: "JWT obrigatório" });
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user?.id) {
    return resp(401, { ok: false, erro: "jwt_invalido", mensagem: "Sessão inválida" });
  }
  const auth_uid = userData.user.id;

  // 2) Gate · sócio aprovado?
  const { data: socio, error: socioErr } = await adminClient
    .from("socios")
    .select("id, codigo, status, usuario_id")
    .eq("usuario_id", auth_uid)
    .maybeSingle();

  if (socioErr) {
    console.error("erro buscar socio:", socioErr);
    return resp(500, { ok: false, erro: "erro_interno", mensagem: "Erro ao buscar sócio" });
  }
  if (!socio) {
    return resp(403, { ok: false, erro: "nao_eh_socio", mensagem: "Você não é sócio" });
  }
  if (socio.status !== "aprovado") {
    return resp(403, {
      ok: false,
      erro: "socio_nao_aprovado",
      mensagem: `Status do sócio: ${socio.status}. Aprovação pendente.`,
    });
  }

  // 3) Parse e valida input
  let body: any;
  try { body = await req.json(); } catch {
    return resp(400, { ok: false, erro: "json_invalido", mensagem: "JSON inválido" });
  }

  const { tipo, proprietario_phone, proprietario_nome, caminho } = body || {};

  if (tipo !== "tese" && tipo !== "diagnostico") {
    return resp(400, { ok: false, erro: "tipo_invalido", mensagem: "tipo deve ser 'tese' ou 'diagnostico'" });
  }
  if (caminho !== "a" && caminho !== "b") {
    return resp(400, { ok: false, erro: "caminho_invalido", mensagem: "caminho deve ser 'a' ou 'b'" });
  }
  if (typeof proprietario_phone !== "string" || proprietario_phone.replace(/\D/g, "").length < 10) {
    return resp(400, { ok: false, erro: "phone_invalido", mensagem: "Telefone inválido (mínimo 10 dígitos)" });
  }
  if (typeof proprietario_nome !== "string" || proprietario_nome.trim().length < 2) {
    return resp(400, { ok: false, erro: "nome_invalido", mensagem: "Nome do proprietário obrigatório" });
  }

  const phoneLimpo = proprietario_phone.replace(/\D/g, "");
  const phoneCom55 = phoneLimpo.startsWith("55") ? phoneLimpo : "55" + phoneLimpo;

  // 4) findOrCreateGhost
  const ghostResult = await findOrCreateGhost(adminClient, phoneCom55, proprietario_nome);
  if (!ghostResult.user_id) {
    console.error("ghost falhou:", ghostResult.erro);
    return resp(500, {
      ok: false,
      erro: "ghost_falhou",
      mensagem: ghostResult.erro || "Não consegui resolver o usuário proprietário",
    });
  }

  // 5) Garante row em public.usuarios
  await ensureUsuarioRow(
    adminClient,
    ghostResult.user_id,
    phoneCom55,
    proprietario_nome,
    tipo === "tese" ? "buy" : "sell",
  );

  // 6) Gera token (UUID sem hífens) e expira em 30 dias
  const token = crypto.randomUUID().replace(/-/g, "");
  const expiraEm = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  // 7) INSERT em notificacoes_proprietario
  const acao = tipo === "tese" ? "completar_cadastro_tese" : "completar_cadastro_negocio";

  const { data: notif, error: notifErr } = await adminClient
    .from("notificacoes_proprietario")
    .insert({
      vinculo_id: null,             // será preenchido por vincular-recem-criado
      proprietario_id: ghostResult.user_id,
      proprietario_phone: phoneCom55,
      acao,
      status: "pendente",
      deep_link_token: token,
      expira_em: expiraEm,
      socio_id_origem: socio.id,
    })
    .select("id")
    .single();

  if (notifErr) {
    console.error("erro insert notif:", notifErr);
    return resp(500, { ok: false, erro: "erro_interno", mensagem: "Falha ao criar notificação" });
  }

  // 8) Tracking
  try {
    await adminClient.from("eventos_usuario").insert({
      usuario_id: auth_uid,
      tipo: "socio_iniciou_cadastro_terceiro",
      entidade_tipo: tipo,
      entidade_id: notif.id,
      meta: {
        socio_codigo: socio.codigo,
        caminho,
        proprietario_id: ghostResult.user_id,
        is_ghost_novo: ghostResult.is_ghost,
      },
    });
  } catch (e) {
    console.warn("tracking falhou:", e);
  }

  // 9) Resposta · ramifica em caminho
  if (caminho === "a") {
    const redirect_url =
      tipo === "tese"
        ? `/cadastre.html?ctx=${token}`
        : `/diagnostico.html?ctx=${token}`;

    return resp(200, {
      ok: true,
      redirect_url,
      proprietario_nome,
      proprietario_id: ghostResult.user_id,
      socio_codigo: socio.codigo,
    });
  }

  // Caminho B · dispara WhatsApp via zapi-relay
  const linkPreencher = `https://1negocio.com.br/aceite-vinculo.html?token=${token}&modo=preencher`;
  const tipoLabel = tipo === "tese" ? "uma tese de investimento" : "um diagnóstico de empresa";
  const mensagem =
    `Olá ${proprietario_nome}, ${socio.codigo} (sócio 1Negócio) iniciou ${tipoLabel} em seu nome.\n\n` +
    `Pra preencher os detalhes pessoalmente, acesse:\n${linkPreencher}\n\n` +
    `Link válido por 30 dias.`;

  try {
    const zapiResp = await fetch(`${SUPABASE_URL}/functions/v1/zapi-relay`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ phone: phoneCom55, message: mensagem }),
    });
    if (!zapiResp.ok) {
      const errText = await zapiResp.text();
      console.error("zapi-relay falhou:", zapiResp.status, errText);
      return resp(500, {
        ok: false,
        erro: "whatsapp_falhou",
        mensagem: "Não consegui enviar o WhatsApp. Tenta o caminho A (preencher você mesmo) ou tenta de novo em alguns minutos.",
      });
    }

    const zapiJson = await zapiResp.json().catch(() => ({}));
    // Atualiza notif com message_id
    if (zapiJson?.messageId || zapiJson?.zaapId) {
      await adminClient
        .from("notificacoes_proprietario")
        .update({
          whatsapp_enviado_em: new Date().toISOString(),
          whatsapp_message_id: zapiJson.messageId || zapiJson.zaapId,
        })
        .eq("id", notif.id);
    } else {
      await adminClient
        .from("notificacoes_proprietario")
        .update({ whatsapp_enviado_em: new Date().toISOString() })
        .eq("id", notif.id);
    }
  } catch (e) {
    console.error("zapi-relay exception:", e);
    return resp(500, {
      ok: false,
      erro: "whatsapp_falhou",
      mensagem: "Erro ao enviar WhatsApp",
    });
  }

  return resp(200, {
    ok: true,
    link_enviado: true,
    proprietario_nome,
    proprietario_id: ghostResult.user_id,
  });
});
