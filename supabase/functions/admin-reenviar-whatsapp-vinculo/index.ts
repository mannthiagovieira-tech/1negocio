// admin-reenviar-whatsapp-vinculo · V8 B8.13 SUB-BLOCO D · 1Negócio
// Re-dispara WhatsApp da notificação pendente de um vínculo.
//
// POST { vinculo_id }
// → 200 { ok, message_id?, ja_decidido }
// → 403 nao_autorizado · 404 sem_notificacao_pendente

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function json(d: unknown, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function decodeJwtPayload(t: string): any | null {
  try {
    const p = t.split(".");
    if (p.length !== 3) return null;
    const b64 = p[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64 + "=".repeat((4 - b64.length % 4) % 4)));
  } catch { return null; }
}

async function gateAdmin(req: Request): Promise<{ ok: boolean; admin_id?: string | null }> {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return { ok: false };
  const token = auth.slice(7);
  if (decodeJwtPayload(token)?.role === "service_role") return { ok: true, admin_id: null };
  try {
    const { data, error } = await adminClient.auth.getUser(token);
    if (error || !data.user?.phone) return { ok: false };
    const { count } = await adminClient.from("admins").select("id", { count: "exact", head: true })
      .eq("whatsapp", data.user.phone).eq("ativo", true);
    if ((count ?? 0) > 0) return { ok: true, admin_id: data.user.id };
  } catch {}
  return { ok: false };
}

const ACOES_TEXTO: Record<string, string> = {
  aceitar_tese: "cadastrou uma tese de investimento",
  aceitar_diagnostico: "cadastrou um diagnóstico de empresa",
  aceitar_pedido_vinculo: "pediu pra ser seu sócio-assessor",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "metodo" }, 405);

  const gate = await gateAdmin(req);
  if (!gate.ok) return json({ ok: false, error: "nao_autorizado" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "json_invalido" }, 400); }
  const vinculo_id = String(body?.vinculo_id || "").trim();
  if (!vinculo_id) return json({ ok: false, error: "vinculo_id_obrigatorio" }, 400);

  // Notif pendente mais recente do vínculo
  const { data: notif } = await adminClient
    .from("notificacoes_proprietario")
    .select("*, vinculo:vinculos_socio(socio:socios(codigo, dados_cadastro))")
    .eq("vinculo_id", vinculo_id)
    .eq("status", "pendente")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!notif) {
    return json({ ok: false, error: "sem_notificacao_pendente" }, 404);
  }

  // Re-monta mensagem (idêntica ao criar-notificacao-proprietario)
  let socioNome = "Sócio-Assessor";
  let socioCodigo = "S-????";
  const socio: any = (notif as any).vinculo?.socio;
  if (socio) {
    socioCodigo = socio.codigo || socioCodigo;
    const dc = socio.dados_cadastro || {};
    socioNome = dc.nome || socioNome;
  }

  const TTL_DIAS = 30;
  const link = `https://1negocio.com.br/aceite-vinculo.html?token=${notif.deep_link_token}`;
  const acaoTxt = ACOES_TEXTO[notif.acao] || "fez uma solicitação";
  const message = `Olá · um sócio-assessor da 1Negócio ${acaoTxt} em seu nome.

Sócio: ${socioNome} (${socioCodigo})

Você precisa aceitar ou recusar:
${link}

Esse link expira em ${TTL_DIAS} dias.

1Negócio · Plataforma de compra e venda de empresas`;

  let messageId: string | null = null;
  let zapiOk = false;
  try {
    const zapiResp = await fetch(`${SUPABASE_URL}/functions/v1/zapi-relay`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ phone: notif.proprietario_phone, message }),
    });
    const zapiData = await zapiResp.json().catch(() => ({}));
    zapiOk = zapiResp.ok;
    messageId = zapiData?.messageId || zapiData?.id || zapiData?.zaapId || null;
  } catch (e) {
    console.warn("[zapi-relay throw]", (e as Error).message || e);
  }

  if (zapiOk) {
    await adminClient
      .from("notificacoes_proprietario")
      .update({
        whatsapp_enviado_em: new Date().toISOString(),
        whatsapp_message_id: messageId,
      })
      .eq("id", notif.id);
  }

  // Tracking
  try {
    await adminClient.from("eventos_usuario").insert({
      tipo: "admin_reenviou_whatsapp_vinculo",
      entidade_tipo: "vinculo_socio",
      entidade_id: vinculo_id,
      usuario_id: null,
      sessao_id: "admin-reenviar-whatsapp-edge",
      meta: { admin_id: gate.admin_id || null, notif_id: notif.id, zapi_ok: zapiOk, message_id: messageId },
    });
  } catch (e) {
    console.warn("[evento]", (e as Error).message);
  }

  return json({ ok: true, whatsapp_enviado: zapiOk, message_id: messageId });
});
