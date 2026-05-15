// Edge Function: transferir-titularidade-negocio
// Admin transfere titularidade de um negócio · vincula/cria usuário · grava histórico · notifica

import { cors, checarAdmin, svc, jsonRes } from "../_shared/admin-auth.ts";

const ADMIN_WHATSAPP = Deno.env.get("ADMIN_WHATSAPP") ?? "";
const ZAPI_INSTANCE = Deno.env.get("ZAPI_INSTANCE") ?? "";
const ZAPI_TOKEN = Deno.env.get("ZAPI_TOKEN") ?? "";
const ZAPI_CLIENT_TOKEN = Deno.env.get("ZAPI_CLIENT_TOKEN") ?? "";

function normalizarTelefone(t: string): string | null {
  const d = String(t || "").replace(/\D/g, "");
  if (d.length < 10 || d.length > 13) return null;
  return d.startsWith("55") ? d : (d.length === 10 || d.length === 11 ? "55" + d : d);
}

async function notificar(phone: string, msg: string): Promise<boolean> {
  if (!ZAPI_INSTANCE || !ZAPI_TOKEN || !phone) return false;
  const url = `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ZAPI_CLIENT_TOKEN) headers["Client-Token"] = ZAPI_CLIENT_TOKEN;
  try {
    const r = await fetch(url, { method: "POST", headers, body: JSON.stringify({ phone, message: msg }) });
    return r.ok;
  } catch (e) { console.warn("[zapi]", e); return false; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonRes({ erro: "Method not allowed" }, 405);

  const auth = await checarAdmin(req);
  if (!auth.ok) return jsonRes({ erro: auth.erro }, auth.status);

  let body: any;
  try { body = await req.json(); } catch { return jsonRes({ erro: "Invalid JSON" }, 400); }

  const { negocio_id, novo_titular_telefone, novo_titular_nome = null, novo_titular_email = null, notificar: doNotify = true, mensagem_personalizada = null } = body || {};

  if (!negocio_id) return jsonRes({ erro: "negocio_id obrigatório" }, 400);
  const tel = normalizarTelefone(novo_titular_telefone);
  if (!tel) return jsonRes({ erro: "Telefone inválido (10-13 dígitos)" }, 400);

  const sb = svc();

  const { data: neg } = await sb.from("negocios").select("id, nome, cidade, estado, vendedor_id").eq("id", negocio_id).maybeSingle();
  if (!neg) return jsonRes({ erro: "negócio não encontrado" }, 404);

  const { data: existente } = await sb.from("usuarios").select("id, nome, whatsapp, email, tipo").eq("whatsapp", tel).maybeSingle();
  let novoTitular: any = existente;
  let usuario_criado = false;
  if (!novoTitular) {
    if (!novo_titular_nome || novo_titular_nome.trim().length < 3) {
      return jsonRes({ erro: "Telefone novo · nome do titular obrigatório (3+ chars)" }, 400);
    }
    const { data: novo, error: errU } = await sb.from("usuarios").insert({
      nome: novo_titular_nome.trim(),
      whatsapp: tel,
      email: novo_titular_email || null,
      tipo: "sell",
    }).select("id, nome, whatsapp, email").single();
    if (errU) return jsonRes({ erro: "criar usuario: " + errU.message }, 500);
    novoTitular = novo;
    usuario_criado = true;
  }

  if (neg.vendedor_id === novoTitular.id) {
    return jsonRes({ erro: "Esse usuário já é o titular atual" }, 400);
  }

  const titularAnteriorId = neg.vendedor_id || null;

  const { error: errUpd } = await sb.from("negocios")
    .update({ vendedor_id: novoTitular.id, updated_at: new Date().toISOString() })
    .eq("id", negocio_id);
  if (errUpd) return jsonRes({ erro: "update negocio: " + errUpd.message }, 500);

  let notificou = false;
  let msgFinal: string | null = null;
  if (doNotify) {
    const primeiroNome = (novoTitular.nome || "").split(" ")[0] || "";
    const msgDefault = `Olá ${primeiroNome} · aqui é da 1Negócio · plataforma de compra e venda de empresas.\n\nVocê acaba de receber acesso ao anúncio do seu negócio em nossa plataforma.\n\nAcesse 1negocio.com.br fazendo login com este número de WhatsApp pra acompanhar.\n\nQualquer dúvida, é só responder.`;
    msgFinal = (mensagem_personalizada && String(mensagem_personalizada).trim()) ? String(mensagem_personalizada).trim() : msgDefault;
    notificou = await notificar(tel, msgFinal);
  }

  await sb.from("negocios_titularidade_historico").insert({
    negocio_id,
    titular_anterior_id: titularAnteriorId,
    titular_novo_id: novoTitular.id,
    transferido_por_admin_id: auth.admin!.id,
    mensagem_enviada: msgFinal,
    notificou_novo_titular: notificou,
  });

  const linkAdmin = `https://1negocio.com.br/painel-v3.html#pa-negocios?id=${negocio_id}`;
  await notificar(ADMIN_WHATSAPP, [
    `🔄 Titularidade transferida · ${neg.nome || "—"}`,
    ``,
    `Negócio: ${neg.nome || "—"} · ${neg.cidade || "—"}/${neg.estado || "—"}`,
    `Novo titular: ${novoTitular.nome || "—"} · ${tel}`,
    `Conta: ${usuario_criado ? "criada agora" : "vinculada (já existia)"}`,
    `Notificação: ${doNotify ? (notificou ? "✓ enviada" : "falhou") : "silencioso"}`,
    ``,
    `Editar: ${linkAdmin}`,
  ].join("\n"));

  return jsonRes({
    ok: true,
    negocio_id,
    novo_titular_id: novoTitular.id,
    titular_anterior_id: titularAnteriorId,
    usuario_criado,
    notificou,
  });
});
