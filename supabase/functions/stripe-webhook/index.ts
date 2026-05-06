// Edge Function: stripe-webhook
// Recebe eventos do Stripe · valida signature · roteia para 2 fluxos:
//   A) One-shot (Laudo/Guiado/Avaliação) — mantido do legado
//   B) Subscription (Venda Assessorada) — checkout.session.completed (mode=subscription),
//      invoice.paid, invoice.payment_failed, customer.subscription.deleted
//
// Auth · Stripe signature header · STRIPE_WEBHOOK_SECRET
// verify_jwt · false
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@12.0.0?target=deno";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

const ZAPI_INSTANCE = "3F0B96941C16821DCD449E74568994AE";
const ZAPI_TOKEN = "0BE4998D03035703BC118D92";
const ZAPI_CLIENT = "F547b97b8e03b4e45a4ac018295d569c1S";
const MEU_NUMERO = "5548999279320";

const PRODUTO_LAUDO     = "prod_UA5oy4N5lG3iuU";
const PRODUTO_GUIADO    = "prod_U9xFu2gWXEUOAH";
const PRODUTO_AVALIACAO = "prod_U9xFwFZxRup7ef";

async function enviarWhatsApp(telefone: string, mensagem: string): Promise<boolean> {
  const num = (telefone || "").replace(/\D/g, "");
  if (!num) return false;
  const fone = num.startsWith("55") ? num : "55" + num;
  try {
    const r = await fetch(
      `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "client-token": ZAPI_CLIENT },
        body: JSON.stringify({ phone: fone, message: mensagem }),
      }
    );
    const data = await r.json();
    console.log("Z-API:", JSON.stringify(data));
    return r.ok;
  } catch (e) {
    console.error("Erro Z-API:", e);
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
  const cliente_email = session.customer_details?.email || "";
  const cliente_nome  = session.customer_details?.name  || "";
  const produto = identificarProduto(session);

  await supabase.from("transacoes").insert({
    tipo: produto.tipo,
    negocio_id,
    valor: produto.valor,
    status: "pago",
    descricao: produto.label,
    referencia: session.id,
  });

  await supabase.from("admin_agenda").insert({
    tipo: produto.tipo,
    status: "pendente",
    nome_cliente: cliente_nome,
    email_cliente: cliente_email,
    negocio_id,
    notas: `Stripe session: ${session.id}`,
  });

  const msg =
    `💰 *Novo pagamento!*\n\n` +
    `Produto: ${produto.label}\n` +
    `Cliente: ${cliente_nome || "(sem nome)"}\n` +
    `Email: ${cliente_email || "(sem email)"}\n` +
    (negocio_id ? `Negocio: ${negocio_id}\n` : "") +
    `Session: ${session.id}`;
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
