// supabase/functions/vincular-recem-criado/index.ts
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
  if (req.method !== "POST") return resp(405, { ok: false, erro: "metodo", mensagem: "POST only" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

  // 1) Parse e valida input
  let body: any;
  try { body = await req.json(); } catch {
    return resp(400, { ok: false, erro: "json_invalido", mensagem: "JSON inválido" });
  }

  const { ctx_token, objeto_tipo, objeto_id } = body || {};

  if (typeof ctx_token !== "string" || ctx_token.length < 16) {
    return resp(400, { ok: false, erro: "token_invalido", mensagem: "Token ausente" });
  }
  if (objeto_tipo !== "tese" && objeto_tipo !== "diagnostico") {
    return resp(400, { ok: false, erro: "tipo_invalido", mensagem: "objeto_tipo deve ser 'tese' ou 'diagnostico'" });
  }
  if (typeof objeto_id !== "string" || objeto_id.length < 16) {
    return resp(400, { ok: false, erro: "objeto_invalido", mensagem: "objeto_id ausente ou inválido" });
  }

  // 2) Lookup notificação
  const { data: notif, error: notifErr } = await adminClient
    .from("notificacoes_proprietario")
    .select("id, vinculo_id, proprietario_id, proprietario_phone, acao, status, expira_em, socio_id_origem")
    .eq("deep_link_token", ctx_token)
    .maybeSingle();

  if (notifErr) {
    console.error("erro buscar notif:", notifErr);
    return resp(500, { ok: false, erro: "erro_interno", mensagem: "Erro ao buscar notificação" });
  }
  if (!notif) {
    return resp(404, { ok: false, erro: "token_invalido", mensagem: "Token inválido" });
  }
  if (notif.status === "consumido") {
    // Idempotência: se já consumido E vínculo existente, retorna silencioso
    if (notif.vinculo_id) {
      const { data: vincExistente } = await adminClient
        .from("vinculos_socio")
        .select("id, codigo, status")
        .eq("id", notif.vinculo_id)
        .maybeSingle();
      if (vincExistente) {
        return resp(200, {
          ok: true,
          vinculo_id: vincExistente.id,
          vinculo_codigo: vincExistente.codigo,
          status_vinculo: vincExistente.status,
          caminho: vincExistente.status === "aguardando_admin" ? "b" : "a",
          idempotente: true,
        });
      }
    }
    return resp(409, { ok: false, erro: "token_consumido", mensagem: "Token já foi usado" });
  }
  if (notif.status !== "pendente") {
    return resp(409, { ok: false, erro: "token_status", mensagem: `Token em status ${notif.status}` });
  }
  if (notif.expira_em && new Date(notif.expira_em) < new Date()) {
    await adminClient
      .from("notificacoes_proprietario")
      .update({ status: "expirado" })
      .eq("id", notif.id);
    return resp(410, { ok: false, erro: "token_expirado", mensagem: "Token expirou" });
  }

  // 3) Tipo da ação bate com objeto_tipo?
  const acaoEsperada = objeto_tipo === "tese"
    ? "completar_cadastro_tese"
    : "completar_cadastro_negocio";
  if (notif.acao !== acaoEsperada) {
    return resp(400, {
      ok: false,
      erro: "tipo_mismatch",
      mensagem: `Notificação é pra ${notif.acao}, request é pra ${objeto_tipo}`,
    });
  }

  // 4) Validar que objeto pertence ao proprietário
  let donoId: string | null = null;
  if (objeto_tipo === "tese") {
    const { data: tese } = await adminClient
      .from("teses_investimento")
      .select("usuario_id")
      .eq("id", objeto_id)
      .maybeSingle();
    donoId = tese?.usuario_id || null;
  } else {
    const { data: negocio } = await adminClient
      .from("negocios")
      .select("vendedor_id")
      .eq("id", objeto_id)
      .maybeSingle();
    donoId = negocio?.vendedor_id || null;
  }

  if (!donoId) {
    return resp(404, { ok: false, erro: "objeto_nao_encontrado", mensagem: "Objeto não encontrado" });
  }
  if (donoId !== notif.proprietario_id) {
    return resp(403, {
      ok: false,
      erro: "objeto_nao_pertence_proprietario",
      mensagem: "Objeto não pertence ao proprietário do convite",
    });
  }

  // 5) Detectar caminho (A vs B) via JWT
  let caminho: "a" | "b" = "a";
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (jwt && jwt !== ANON_KEY) {
    try {
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
      });
      const { data: userData } = await userClient.auth.getUser();
      if (userData?.user?.id === notif.proprietario_id) {
        caminho = "b";
      }
    } catch (_e) {
      // Sem sessão válida · fica caminho A
    }
  }

  // 6) Validar socio_id_origem
  if (!notif.socio_id_origem) {
    return resp(500, { ok: false, erro: "sem_socio_origem", mensagem: "Notificação sem sócio de origem" });
  }

  // 7) Idempotência · vínculo já existe pra esse objeto?
  const { data: vincExistente } = await adminClient
    .from("vinculos_socio")
    .select("id, codigo, status")
    .or(
      objeto_tipo === "tese"
        ? `tese_id.eq.${objeto_id}`
        : `diagnostico_id.eq.${objeto_id}`,
    )
    .maybeSingle();

  if (vincExistente) {
    // Marca notif como consumida (caso ainda não esteja) e retorna
    await adminClient
      .from("notificacoes_proprietario")
      .update({ status: "consumido", vinculo_id: vincExistente.id })
      .eq("id", notif.id);
    return resp(200, {
      ok: true,
      vinculo_id: vincExistente.id,
      vinculo_codigo: vincExistente.codigo,
      status_vinculo: vincExistente.status,
      caminho,
      idempotente: true,
    });
  }

  // 8) Gera codigo V-XXXX
  const { data: codigoData, error: codigoErr } = await adminClient
    .rpc("gerar_codigo_vinculo");
  if (codigoErr || !codigoData) {
    console.error("erro rpc gerar_codigo_vinculo:", codigoErr);
    return resp(500, { ok: false, erro: "erro_interno", mensagem: "Falha ao gerar código de vínculo" });
  }
  const vinculoCodigo = codigoData as string;

  // 9) Status inicial baseado no caminho
  const statusVinculo = caminho === "b" ? "aguardando_admin" : "aguardando_aceite_proprietario";

  // 10) INSERT vínculo
  const { data: novoVinculo, error: insertErr } = await adminClient
    .from("vinculos_socio")
    .insert({
      codigo: vinculoCodigo,
      socio_id: notif.socio_id_origem,
      tese_id: objeto_tipo === "tese" ? objeto_id : null,
      diagnostico_id: objeto_tipo === "diagnostico" ? objeto_id : null,
      origem: "cadastrado_pelo_socio",
      status: statusVinculo,
    })
    .select("id, codigo, status")
    .single();

  if (insertErr || !novoVinculo) {
    console.error("erro insert vinculo:", insertErr);
    return resp(500, { ok: false, erro: "erro_interno", mensagem: "Falha ao criar vínculo" });
  }

  // 11) UPDATE notif · consumido + vinculo_id
  await adminClient
    .from("notificacoes_proprietario")
    .update({ status: "consumido", vinculo_id: novoVinculo.id })
    .eq("id", notif.id);

  // 12) v9.2 · disparo de "aceitar vínculo" MOVIDO pra notificar-pos-laudo.
  // Razão: proprietário não deve receber pedido de aceite antes de existir
  // laudo gerado pra ele ver. O frontend (diagnostico.html) chama
  // notificar-pos-laudo após AVALIADORA_V2.avaliar retornar · essa edge é
  // que cria a notificação de aceite (INSERT direto) e dispara mensagem
  // unificada (laudo + link de aceite) num só WhatsApp.
  // (Caminho B continua sem precisar disparo · proprietário acabou de
  // preencher pessoalmente · é confirmação implícita.)

  // 13) Tracking
  try {
    await adminClient.from("eventos_usuario").insert({
      usuario_id: notif.proprietario_id,
      tipo: "vinculo_socio_criado",
      entidade_tipo: objeto_tipo,
      entidade_id: objeto_id,
      meta: {
        vinculo_id: novoVinculo.id,
        vinculo_codigo: novoVinculo.codigo,
        caminho,
        socio_id: notif.socio_id_origem,
      },
    });
  } catch (e) {
    console.warn("tracking falhou:", e);
  }

  return resp(200, {
    ok: true,
    vinculo_id: novoVinculo.id,
    vinculo_codigo: novoVinculo.codigo,
    status_vinculo: novoVinculo.status,
    caminho,
  });
});
