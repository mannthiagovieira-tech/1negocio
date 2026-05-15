// Edge Function: stripe-webhook
// Recebe eventos do Stripe · valida signature · roteia para 2 fluxos:
//   A) One-shot (Laudo/Guiado/Avaliação) — mantido do legado
//   B) Subscription (Venda Assessorada) — checkout.session.completed (mode=subscription),
//      invoice.paid, invoice.payment_failed, customer.subscription.deleted
//
// Auth · Stripe signature header · STRIPE_WEBHOOK_SECRET
// verify_jwt · false
//
// v9.15 · fix admin_agenda.notas_admin (era notas, coluna inexistente) +
// error-checking nos INSERTs + UPDATE negocios.pagamento_aprovado_em
// e .plano_comprado em pagamentos one-shot
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@12.0.0?target=deno";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

// v9.21 · Z-API via envs (Supabase secrets) · hardcode antigo revogado causava 403
const ZAPI_INSTANCE = Deno.env.get("ZAPI_INSTANCE") ?? "";
const ZAPI_TOKEN = Deno.env.get("ZAPI_TOKEN") ?? "";
const ZAPI_CLIENT = Deno.env.get("ZAPI_CLIENT_TOKEN") ?? "";
const MEU_NUMERO = "5548999279320";

const PRODUTO_LAUDO     = "prod_UA5oy4N5lG3iuU";
const PRODUTO_GUIADO    = "prod_U9xFu2gWXEUOAH";
const PRODUTO_AVALIACAO = "prod_U9xFwFZxRup7ef";

async function enviarWhatsApp(telefone: string, mensagem: string): Promise<boolean> {
  const num = (telefone || "").replace(/\D/g, "");
  if (!num) return false;
  const fone = num.startsWith("55") ? num : "55" + num;
  if (!ZAPI_INSTANCE || !ZAPI_TOKEN || !ZAPI_CLIENT) {
    console.error("[stripe-webhook] envs Z-API ausentes:", {
      tem_instance: !!ZAPI_INSTANCE,
      tem_token: !!ZAPI_TOKEN,
      tem_client: !!ZAPI_CLIENT,
    });
    return false;
  }
  try {
    const r = await fetch(
      `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "client-token": ZAPI_CLIENT },
        body: JSON.stringify({ phone: fone, message: mensagem }),
      }
    );
    if (!r.ok) {
      const txt = await r.text();
      console.error(`[stripe-webhook] Z-API falhou: ${r.status} ${txt.slice(0, 200)}`);
      return false;
    }
    const data = await r.json();
    console.log("Z-API:", JSON.stringify(data));
    return true;
  } catch (e) {
    console.error("[stripe-webhook] exception Z-API:", e);
    return false;
  }
}

function identificarProduto(session: Stripe.Checkout.Session) {
  const valor = (session.amount_total || 0) / 100;
  const prod = session.metadata?.produto_id || "";
  if (prod === PRODUTO_LAUDO || valor === 99)     return { tipo: "laudo_99",      label: "Laudo R$99",                   valor };
  if (prod === PRODUTO_GUIADO || valor === 588)   return { tipo: "guiado_588",    label: "Plano Guiado R$588",           valor };
  if (prod === PRODUTO_AVALIACAO || valor === 397) return { tipo: "avaliacao_397", label: "Avaliacao Profissional R$397", valor };
  return { tipo: "outro", label: `Pagamento R$${valor}`, valor };
}

function brl(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Handlers Subscription (Venda Assessorada) ─────────────────────────────────

async function handleSubscriptionCheckoutCompleted(supabase: any, stripe: Stripe, session: Stripe.Checkout.Session) {
  const subId = (session.subscription as string) || "";
  const customerId = (session.customer as string) || "";
  const termo_id = session.metadata?.termo_id || "";
  if (!termo_id) {
    console.error("[subscription.completed] termo_id ausente em metadata");
    return;
  }

  // Pega proximo ciclo
  let proximaCobranca: string | null = null;
  if (subId) {
    try {
      const sub = await stripe.subscriptions.retrieve(subId);
      if (sub.current_period_end) proximaCobranca = new Date(sub.current_period_end * 1000).toISOString();
    } catch (e) { console.error("[subscription.completed] retrieve sub:", e); }
  }

  const { data: termo } = await supabase.from("termos_adesao")
    .select("id, codigo, mensalidade, representante_nome, whatsapp, negocio_id")
    .eq("id", termo_id).maybeSingle();

  await supabase.from("termos_adesao").update({
    stripe_subscription_id: subId,
    stripe_customer_id: customerId,
    stripe_status: "active",
    ultimo_pagamento_em: new Date().toISOString(),
    proximo_pagamento_em: proximaCobranca,
  }).eq("id", termo_id);

  const msg =
    `✅ *Assinatura Assessorada ATIVA*\n\n` +
    `Termo: ${termo?.codigo || termo_id}\n` +
    `Cliente: ${termo?.representante_nome || "—"}\n` +
    `Mensalidade: R$ ${brl(termo?.mensalidade)}\n` +
    `Subscription: ${subId}`;
  await enviarWhatsApp(MEU_NUMERO, msg);
}

async function handleInvoicePaid(supabase: any, invoice: Stripe.Invoice) {
  const subId = (invoice.subscription as string) || "";
  if (!subId) return;
  const { data: termo } = await supabase.from("termos_adesao")
    .select("id, codigo, mensalidade, representante_nome, whatsapp, vendedor_id")
    .eq("stripe_subscription_id", subId).maybeSingle();
  if (!termo) {
    console.error("[invoice.paid] termo não encontrado pra sub", subId);
    return;
  }

  const proxima = invoice.lines?.data?.[0]?.period?.end
    ? new Date(invoice.lines.data[0].period.end * 1000).toISOString()
    : null;

  await supabase.from("termos_adesao").update({
    stripe_status: "active",
    ultimo_pagamento_em: new Date().toISOString(),
    proximo_pagamento_em: proxima,
  }).eq("id", termo.id);

  // Notifica cliente
  if (termo.whatsapp) {
    const msg =
      `✅ Pagamento confirmado · Venda Assessorada\n\n` +
      `Mensalidade: R$ ${brl(termo.mensalidade)}\n` +
      `Recebemos seu pagamento referente a este mês.\n` +
      (proxima ? `Próxima cobrança: ${new Date(proxima).toLocaleDateString("pt-BR")}\n\n` : "\n") +
      `Continuamos trabalhando na venda do seu negócio. Qualquer dúvida estou à disposição.`;
    await enviarWhatsApp(termo.whatsapp, msg);
  }
}

async function handleInvoicePaymentFailed(supabase: any, invoice: Stripe.Invoice) {
  const subId = (invoice.subscription as string) || "";
  if (!subId) return;
  const { data: termo } = await supabase.from("termos_adesao")
    .select("id, codigo, mensalidade, representante_nome, whatsapp")
    .eq("stripe_subscription_id", subId).maybeSingle();
  if (!termo) return;

  await supabase.from("termos_adesao").update({
    stripe_status: "past_due",
  }).eq("id", termo.id);

  const tentativa = invoice.attempt_count || 1;
  const msg =
    `⚠️ *PAGAMENTO FALHOU · Assessorada*\n\n` +
    `Termo: ${termo.codigo || termo.id}\n` +
    `Cliente: ${termo.representante_nome || "—"}\n` +
    `Whats: ${termo.whatsapp || "—"}\n` +
    `Mensalidade: R$ ${brl(termo.mensalidade)}\n` +
    `Tentativa: ${tentativa}\n` +
    `Stripe smart retry vai tentar de novo.`;
  await enviarWhatsApp(MEU_NUMERO, msg);
}

async function handleSubscriptionDeleted(supabase: any, sub: Stripe.Subscription) {
  const subId = sub.id;
  const { data: termo } = await supabase.from("termos_adesao")
    .select("id, codigo, representante_nome, whatsapp")
    .eq("stripe_subscription_id", subId).maybeSingle();
  if (!termo) return;

  await supabase.from("termos_adesao").update({
    stripe_status: "canceled",
  }).eq("id", termo.id);

  const msg =
    `🛑 *Assinatura CANCELADA · Assessorada*\n\n` +
    `Termo: ${termo.codigo || termo.id}\n` +
    `Cliente: ${termo.representante_nome || "—"}\n` +
    `Whats: ${termo.whatsapp || "—"}\n` +
    `Subscription: ${subId}\n` +
    `Motivo: ${sub.cancellation_details?.reason || sub.status}`;
  await enviarWhatsApp(MEU_NUMERO, msg);
}

// ─── Handler legado (one-shot) ─────────────────────────────────────────────────

async function handleOneShotCheckoutCompleted(supabase: any, session: Stripe.Checkout.Session) {
  const negocio_id    = session.client_reference_id || session.metadata?.negocio_id || null;
  const usuario_id    = session.metadata?.usuario_id || null;
  const plano_meta    = session.metadata?.plano || "";
  const cliente_email = session.customer_details?.email || "";
  const cliente_nome  = session.customer_details?.name  || "";
  const produto = identificarProduto(session);

  // v9.27 · lookup auxiliar pra guiado_direto · popula whatsapp_cliente
  // em admin_agenda e enriquece notificação WhatsApp do operador.
  let cliente_whatsapp = "";
  let negocio_nome = session.metadata?.nome_negocio || "";
  let negocio_cidade = "";
  let negocio_codigo = "";
  let cliente_nome_lookup = cliente_nome;

  if (plano_meta === "guiado_direto" && negocio_id) {
    try {
      const { data: neg } = await supabase
        .from("negocios")
        .select("nome, nome_negocio, cidade, codigo, usuarios(nome, whatsapp, email)")
        .eq("id", negocio_id)
        .maybeSingle();
      if (neg) {
        negocio_nome = neg.nome_negocio || neg.nome || negocio_nome;
        negocio_cidade = neg.cidade || "";
        negocio_codigo = neg.codigo || "";
        const u = (neg as any).usuarios;
        if (u) {
          cliente_whatsapp = u.whatsapp || "";
          cliente_nome_lookup = u.nome || cliente_nome;
        }
      }
    } catch (e) {
      console.error("[stripe-webhook] lookup guiado_direto falhou:", e);
    }
  }

  const { error: errTx } = await supabase.from("transacoes").insert({
    tipo: produto.tipo,
    negocio_id,
    usuario_id,
    valor: produto.valor,
    status: "pago",
    descricao: produto.label,
    referencia: session.id,
  });
  if (errTx) console.error("[stripe-webhook] erro INSERT transacoes:", errTx.message);

  const { error: errAgenda } = await supabase.from("admin_agenda").insert({
    tipo: produto.tipo,
    status: "pendente",
    nome_cliente: cliente_nome_lookup,
    email_cliente: cliente_email,
    whatsapp_cliente: cliente_whatsapp || null,
    usuario_id,
    negocio_id,
    pagamento_id: session.id,
    pagamento_valor: produto.valor,
    pagamento_status: "pago",
    notas_admin: `Stripe session: ${session.id}${plano_meta === "guiado_direto" ? " · Plano Guiado direto (sem diagnóstico prévio)" : ""}`,
  });
  if (errAgenda) console.error("[stripe-webhook] erro INSERT admin_agenda:", errAgenda.message);

  // v9.15 · atualiza negócio com pagamento aprovado (one-shot: laudo/guiado/avaliacao)
  if (negocio_id && (produto.tipo === "laudo_99" || produto.tipo === "guiado_588" || produto.tipo === "avaliacao_397")) {
    const { error: errNeg } = await supabase.from("negocios")
      .update({
        pagamento_aprovado_em: new Date().toISOString(),
        plano_comprado: produto.tipo,
        stripe_session_id: session.id,
      })
      .eq("id", negocio_id);
    if (errNeg) console.error("[stripe-webhook] erro UPDATE negocios:", errNeg.message);
  }

  // v9.27 · mensagem WhatsApp formatada quando vier do checkout direto Guiado
  let msg: string;
  if (plano_meta === "guiado_direto") {
    msg =
      `💰 *R$ 588 PAGO · Plano Guiado*\n\n` +
      `Cliente: ${cliente_nome_lookup || "(sem nome)"}\n` +
      `WhatsApp: ${cliente_whatsapp || "(não informado)"}\n` +
      `Negócio: ${negocio_nome || "(sem nome)"} · ${negocio_cidade || "(sem cidade)"}\n` +
      `Código: ${negocio_codigo || "(sem código)"}\n\n` +
      `URL: https://1negocio.com.br/painel-v3.html#negocio/${negocio_id}\n\n` +
      `➤ Agendar call e preencher dados`;
  } else {
    msg =
      `💰 *Novo pagamento!*\n\n` +
      `Produto: ${produto.label}\n` +
      `Cliente: ${cliente_nome || "(sem nome)"}\n` +
      `Email: ${cliente_email || "(sem email)"}\n` +
      (negocio_id ? `Negocio: ${negocio_id}\n` : "") +
      `Session: ${session.id}`;
  }
  await enviarWhatsApp(MEU_NUMERO, msg);

  if (produto.tipo === "laudo_99" && negocio_id) {
    try {
      const { data: neg } = await supabase
        .from("negocios")
        .select("usuarios(whatsapp, nome)")
        .eq("id", negocio_id)
        .single();
      const wpp  = (neg as any)?.usuarios?.whatsapp;
      const nome = (neg as any)?.usuarios?.nome || cliente_nome;
      if (wpp) {
        const laudoUrl = `https://1negocio.com.br/laudo-pago.html?id=${negocio_id}`;
        await enviarWhatsApp(wpp,
          `Ola ${(nome || "").split(" ")[0]}!\n\nSeu laudo esta pronto:\n${laudoUrl}\n\n_Documento confidencial_`);
      }
    } catch (e) {
      console.error("Erro ao enviar laudo ao vendedor:", e);
    }
  }
}

// ─── Entry point ───────────────────────────────────────────────────────────────

serve(async (req) => {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature") ?? "";
  const stripe = new Stripe(STRIPE_SECRET, { apiVersion: "2023-10-16" });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Signature invalida:", err);
    return new Response("Signature invalida", { status: 400 });
  }

  const supabase = createClient(SB_URL, SB_SERVICE);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "subscription" && session.metadata?.produto === "assessorada_mensal") {
          await handleSubscriptionCheckoutCompleted(supabase, stripe, session);
        } else {
          await handleOneShotCheckoutCompleted(supabase, session);
        }
        break;
      }
      case "invoice.paid": {
        await handleInvoicePaid(supabase, event.data.object as Stripe.Invoice);
        break;
      }
      case "invoice.payment_failed": {
        await handleInvoicePaymentFailed(supabase, event.data.object as Stripe.Invoice);
        break;
      }
      case "customer.subscription.deleted": {
        await handleSubscriptionDeleted(supabase, event.data.object as Stripe.Subscription);
        break;
      }
      default:
        console.log("[stripe-webhook] ignorado:", event.type);
    }
  } catch (e) {
    console.error("[stripe-webhook] handler exception:", e);
  }

  return new Response(JSON.stringify({ ok: true, type: event.type }), {
    headers: { "Content-Type": "application/json" },
  });
});
