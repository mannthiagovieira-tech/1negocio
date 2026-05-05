// Edge Function: criar-negocio-procuracao
// Admin cria negócio em nome do dono · sem OTP · vincula ao telefone

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

  const {
    dono_nome, dono_telefone, dono_email = null,
    nome_negocio, setor = null, cidade = null, estado = null, bairro = null,
    fat_mensal = 0, descricao = null, tipo_negocio = null,
    extra_dados = null,
    notificar_dono = true, mensagem_dono = null,
  } = body || {};

  if (!dono_nome || dono_nome.trim().length < 3) return jsonRes({ erro: "Nome do dono obrigatório (3+ chars)" }, 400);
  const tel = normalizarTelefone(dono_telefone);
  if (!tel) return jsonRes({ erro: "Telefone do dono inválido (10-13 dígitos)" }, 400);
  if (!nome_negocio || nome_negocio.trim().length < 2) return jsonRes({ erro: "Nome do negócio obrigatório" }, 400);

  const sb = svc();

  // 1. Resolver/criar usuário
  const { data: existente } = await sb.from("usuarios").select("id, nome, whatsapp, email, tipo").eq("whatsapp", tel).maybeSingle();
  let usuario: any = existente;
  let usuario_criado = false;
  if (!usuario) {
    const { data: novo, error: errU } = await sb.from("usuarios").insert({
      nome: dono_nome.trim(),
      whatsapp: tel,
      email: dono_email || null,
      tipo: "sell",
    }).select("id, nome, whatsapp, email, tipo").single();
    if (errU) return jsonRes({ erro: "criar usuario: " + errU.message }, 500);
    usuario = novo;
    usuario_criado = true;
  }

  // 2. Gerar codigo_diagnostico
  const codigo = "1N-" + Date.now().toString(36).toUpperCase();
  const fatAnual = Number(fat_mensal || 0) * 12;

  const dadosJson: any = {
    nome_negocio: nome_negocio.trim(),
    setor, cidade, estado, bairro,
    fat_mensal: Number(fat_mensal || 0),
    descricao,
    tipo_negocio,
    google_user_id: usuario.id,
    procuracao: { dono_nome, dono_telefone: tel, dono_email, criado_por_admin: auth.admin!.id, criado_em: new Date().toISOString() },
    ...(extra_dados && typeof extra_dados === "object" ? extra_dados : {}),
  };

  // 3. Insert negócio
  const { data: neg, error: errN } = await sb.from("negocios").insert({
    slug: codigo,
    codigo_diagnostico: codigo,
    nome: nome_negocio.trim(),
    setor: setor || "Outros",
    categoria: setor || "Outros",
    cidade: cidade || null,
    estado: estado || null,
    bairro: bairro && String(bairro).trim() ? String(bairro).trim() : null,
    descricao: descricao || null,
    faturamento_anual: fatAnual,
    tipo_negocio: tipo_negocio || null,
    status: "em_avaliacao",
    plano: "gratuito",
    vendedor_id: usuario.id,
    dados_json: dadosJson,
    criado_por_procuracao: true,
    criado_por_admin: auth.admin!.id,
  }).select("id, nome, codigo_diagnostico, cidade, estado").single();
  if (errN) return jsonRes({ erro: "insert negocio: " + errN.message }, 500);

  // 4. Notificar dono (opt-in)
  let dono_notificado = false;
  if (notificar_dono) {
    const msgDefault = `Olá ${dono_nome.split(" ")[0]} · aqui é da 1Negócio · plataforma de compra e venda de empresas.\n\nConforme combinamos, registrei o diagnóstico do seu negócio em nossa plataforma.\n\nVocê pode acessar a qualquer momento em 1negocio.com.br usando este número de WhatsApp pra fazer login.\n\nQualquer dúvida, é só responder.`;
    const msgFinal = (mensagem_dono && String(mensagem_dono).trim()) ? String(mensagem_dono).trim() : msgDefault;
    dono_notificado = await notificar(tel, msgFinal);
  }

  // 5. Notifica admin sempre
  const linkAdmin = `https://1negocio.com.br/painel-v3.html#op-anuncios?id=${neg.id}`;
  await notificar(ADMIN_WHATSAPP, [
    `🆕 Diagnóstico por procuração · ${neg.codigo_diagnostico}`,
    ``,
    `Negócio: ${neg.nome} · ${neg.cidade || "—"}/${neg.estado || "—"}`,
    `Dono: ${dono_nome} · ${tel}`,
    `Conta: ${usuario_criado ? "criada agora" : "vinculada (já existia)"}`,
    `Notificação ao dono: ${notificar_dono ? (dono_notificado ? "✓ enviada" : "falhou") : "silencioso"}`,
    ``,
    `Editar: ${linkAdmin}`,
  ].join("\n"));

  return jsonRes({
    ok: true,
    negocio_id: neg.id,
    codigo_diagnostico: neg.codigo_diagnostico,
    usuario_id: usuario.id,
    usuario_criado,
    dono_notificado,
    link_editar: linkAdmin,
  });
});
