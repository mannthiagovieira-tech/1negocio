// supabase/functions/socio-pedir-vinculo/index.ts
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

function gerarIniciais(nome: string | null): string {
  if (!nome) return "?.?.";
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?.?.";
  if (partes.length === 1) return partes[0][0].toUpperCase() + ".";
  return (partes[0][0] + "." + partes[partes.length - 1][0] + ".").toUpperCase();
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
    .select("id, codigo, status")
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
      mensagem: `Status do sócio: ${socio.status}.`,
    });
  }

  // 3) Parse e valida formato do código
  let body: any;
  try { body = await req.json(); } catch {
    return resp(400, { ok: false, erro: "json_invalido", mensagem: "JSON inválido" });
  }

  const codigoRaw = String(body?.codigo || "").trim().toUpperCase();
  if (!codigoRaw) {
    return resp(400, { ok: false, erro: "codigo_invalido", mensagem: "Código obrigatório" });
  }

  // Detecção explícita de código PÚBLICO (anúncio) · rejeita
  const ehAnuncioPublico = /^1N-\d{1,}$/.test(codigoRaw);
  if (ehAnuncioPublico) {
    return resp(400, {
      ok: false,
      erro: "codigo_publico_rejeitado",
      mensagem: "Esse é um código público de anúncio. Use o código privado da tese (T-XXXX) ou do diagnóstico (1N-TXXXXXX) que o proprietário compartilhou com você.",
    });
  }

  const ehTese = /^T-\d{4,}$/.test(codigoRaw);
  const ehDiagnostico = /^1N-T[A-Z0-9]{6,}$/.test(codigoRaw);

  if (!ehTese && !ehDiagnostico) {
    return resp(400, {
      ok: false,
      erro: "codigo_invalido",
      mensagem: "Formato inválido. Use T-XXXX (tese) ou 1N-TXXXXXX (diagnóstico).",
    });
  }

  // 4) Resolve o objeto
  let objeto_id: string | null = null;
  let objeto_dono_id: string | null = null;
  let objeto_dono_nome: string | null = null;
  let objeto_dono_phone: string | null = null;
  let objeto_titulo: string | null = null;
  const tipo = ehTese ? "tese" : "diagnostico";

  if (ehTese) {
    const { data: tese } = await adminClient
      .from("teses_investimento")
      .select("id, usuario_id, titulo")
      .eq("codigo", codigoRaw)
      .maybeSingle();
    if (tese) {
      objeto_id = tese.id;
      objeto_dono_id = tese.usuario_id;
      objeto_titulo = tese.titulo;
    }
  } else {
    const { data: negocio } = await adminClient
      .from("negocios")
      .select("id, vendedor_id, nome_negocio")
      .eq("codigo_diagnostico", codigoRaw)
      .maybeSingle();
    if (negocio) {
      objeto_id = negocio.id;
      objeto_dono_id = negocio.vendedor_id;
      objeto_titulo = negocio.nome_negocio;
    }
  }

  if (!objeto_id || !objeto_dono_id) {
    return resp(404, {
      ok: false,
      erro: "codigo_nao_encontrado",
      mensagem: "Código não encontrado.",
    });
  }

  // 4.1) Busca dados do dono pra mascarar iniciais e disparar WhatsApp
  const { data: donoUsuario } = await adminClient
    .from("usuarios")
    .select("nome, whatsapp")
    .eq("id", objeto_dono_id)
    .maybeSingle();

  if (donoUsuario) {
    objeto_dono_nome = donoUsuario.nome || null;
    objeto_dono_phone = donoUsuario.whatsapp || null;
  }

  // 5) Verifica unicidade · 1 sócio ativo por objeto
  const { data: vincExistente } = await adminClient
    .from("vinculos_socio")
    .select("id, status")
    .or(
      ehTese
        ? `tese_id.eq.${objeto_id}`
        : `diagnostico_id.eq.${objeto_id}`,
    )
    .in("status", ["aguardando_aceite_proprietario", "aguardando_admin", "ativo"])
    .maybeSingle();

  if (vincExistente) {
    return resp(409, {
      ok: false,
      erro: "ja_tem_socio",
      mensagem: "Este código já tem sócio vinculado · não disponível.",
    });
  }

  // 6) Gera código V-XXXX
  const { data: codigoData, error: codigoErr } = await adminClient
    .rpc("gerar_codigo_vinculo");
  if (codigoErr || !codigoData) {
    console.error("erro rpc gerar_codigo_vinculo:", codigoErr);
    return resp(500, { ok: false, erro: "erro_interno", mensagem: "Falha ao gerar código de vínculo" });
  }
  const vinculoCodigo = codigoData as string;

  // 7) INSERT vínculo
  const { data: novoVinculo, error: insertErr } = await adminClient
    .from("vinculos_socio")
    .insert({
      codigo: vinculoCodigo,
      socio_id: socio.id,
      tese_id: ehTese ? objeto_id : null,
      diagnostico_id: ehDiagnostico ? objeto_id : null,
      origem: "pedido_aprovado",     // valor canônico que JÁ existe no CHECK
      status: "aguardando_aceite_proprietario",
    })
    .select("id, codigo, status")
    .single();

  if (insertErr || !novoVinculo) {
    console.error("erro insert vinculo:", insertErr);
    return resp(500, { ok: false, erro: "erro_interno", mensagem: "Falha ao criar vínculo" });
  }

  // 8) Dispara notificação pro proprietário aceitar
  if (objeto_dono_phone) {
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/criar-notificacao-proprietario`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify({
          vinculo_id: novoVinculo.id,
          proprietario_id: objeto_dono_id,
          proprietario_phone: objeto_dono_phone,
          acao: "aceitar_pedido_vinculo",
        }),
      });
    } catch (e) {
      console.error("falha disparar notif:", e);
      // Não bloqueia · vínculo criado · admin pode reenviar
    }
  } else {
    console.warn("dono sem phone · não foi possível disparar notif", { objeto_dono_id });
  }

  // 9) Tracking
  try {
    await adminClient.from("eventos_usuario").insert({
      usuario_id: auth_uid,
      tipo: "socio_pediu_vinculo",
      entidade_tipo: tipo,
      entidade_id: objeto_id,
      meta: {
        socio_codigo: socio.codigo,
        codigo_objeto: codigoRaw,
        vinculo_id: novoVinculo.id,
      },
    });
  } catch (e) {
    console.warn("tracking falhou:", e);
  }

  // 10) Resposta com iniciais mascaradas
  return resp(200, {
    ok: true,
    vinculo_id: novoVinculo.id,
    vinculo_codigo: novoVinculo.codigo,
    tipo,
    proprietario_iniciais: gerarIniciais(objeto_dono_nome),
  });
});
