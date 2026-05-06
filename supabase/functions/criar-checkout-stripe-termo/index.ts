// Edge Function: criar-checkout-stripe-termo
// Admin gera Stripe Checkout Session em modo subscription para um Termo de Adesão Assessorada.
// Valor da mensalidade vem de termos_adesao.mensalidade · cobrança imediata · 1 cobrança/mês · BRL.
//
// Auth · admin via checarAdmin (whatsapp = JWT phone)
// Body · { termo_id: uuid }
// Saída · { ok, checkout_url, session_id }

import { cors, checarAdmin, svc, jsonRes } from "../_shared/admin-auth.ts";
import Stripe from "https://esm.sh/stripe@12.0.0?target=deno";

const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY")!;
const SITE_BASE = "https://1negocio.com.br";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonRes({ ok: false, erro: "Method not allowed" }, 405);

  const auth = await checarAdmin(req);
  if (!auth.ok) return jsonRes({ ok: false, erro: auth.erro }, auth.status);

  let body: any;
  try { body = await req.json(); } catch { return jsonRes({ ok: false, erro: "Invalid JSON" }, 400); }
  const termo_id = String(body?.termo_id || "").trim();
  if (!termo_id) return jsonRes({ ok: false, erro: "termo_id obrigatório" }, 400);

  const sb = svc();

  // 1. Carrega termo
  const { data: termo, error: terr } = await sb
    .from("termos_adesao")
    .select("id, codigo, plano, status, negocio_id, vendedor_id, mensalidade, email, whatsapp, representante_nome, razao_social, stripe_customer_id, stripe_subscription_id, stripe_checkout_session_id")
    .eq("id", termo_id)
    .maybeSingle();
  if (terr || !termo) return jsonRes({ ok: false, erro: "termo não encontrado" }, 404);
  if (termo.plano !== "assessorada") return jsonRes({ ok: false, erro: "termo não é Assessorada" }, 400);
  if (!["assinado", "ativo"].includes(termo.status)) return jsonRes({ ok: false, erro: `status inválido (${termo.status}) — precisa estar assinado` }, 400);
  if (termo.stripe_subscription_id) return jsonRes({ ok: false, erro: "subscription Stripe já existe pra este termo" }, 409);
  const mensalidade = Number(termo.mensalidade || 0);
  if (mensalidade <= 0) return jsonRes({ ok: false, erro: "mensalidade inválida no termo" }, 400);

  // 2. Carrega negócio + vendedor
  let negocioNome = "";
  let vendedorEmail = termo.email || "";
  let vendedorNome = termo.representante_nome || termo.razao_social || "";
  let vendedorWhats = termo.whatsapp || "";
  if (termo.negocio_id) {
    const { data: neg } = await sb.from("negocios").select("id, nome, codigo_diagnostico, vendedor_id").eq("id", termo.negocio_id).maybeSingle();
    if (neg) negocioNome = neg.nome || neg.codigo_diagnostico || "";
  }
  if ((!vendedorEmail || !vendedorNome) && termo.vendedor_id) {
    const { data: u } = await sb.from("usuarios").select("nome, email, whatsapp").eq("id", termo.vendedor_id).maybeSingle();
    if (u) {
      vendedorEmail = vendedorEmail || u.email || "";
      vendedorNome = vendedorNome || u.nome || "";
      vendedorWhats = vendedorWhats || u.whatsapp || "";
    }
  }

  const stripe = new Stripe(STRIPE_SECRET, { apiVersion: "2023-10-16" });

  // 3. Cria ou reusa Customer
  let customerId = termo.stripe_customer_id || "";
  try {
    if (!customerId && vendedorEmail) {
      const found = await stripe.customers.list({ email: vendedorEmail, limit: 1 });
      if (found.data.length > 0) customerId = found.data[0].id;
    }
    if (!customerId) {
      const created = await stripe.customers.create({
        email: vendedorEmail || undefined,
        name: vendedorNome || undefined,
        phone: vendedorWhats || undefined,
        metadata: {
          termo_id: termo.id,
          termo_codigo: termo.codigo || "",
          negocio_id: termo.negocio_id || "",
          vendedor_id: termo.vendedor_id || "",
        },
      });
      customerId = created.id;
    }
  } catch (e) {
    return jsonRes({ ok: false, erro: "Stripe customer: " + (e as Error).message }, 500);
  }

  // 4. Cria Checkout Session em modo subscription
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "brl",
          unit_amount: Math.round(mensalidade * 100),
          recurring: { interval: "month" },
          product_data: {
            name: "Venda Assessorada · " + (negocioNome || termo.codigo || ""),
          },
        },
      }],
      metadata: {
        termo_id: termo.id,
        termo_codigo: termo.codigo || "",
        negocio_id: termo.negocio_id || "",
        vendedor_id: termo.vendedor_id || "",
        produto: "assessorada_mensal",
      },
      subscription_data: {
        metadata: {
          termo_id: termo.id,
          termo_codigo: termo.codigo || "",
          negocio_id: termo.negocio_id || "",
          vendedor_id: termo.vendedor_id || "",
          produto: "assessorada_mensal",
        },
      },
      success_url: `${SITE_BASE}/meu-anuncio.html?id=${termo.negocio_id || ""}&pagamento=ok`,
      cancel_url: `${SITE_BASE}/meu-anuncio.html?id=${termo.negocio_id || ""}&pagamento=cancelado`,
      client_reference_id: termo.negocio_id || undefined,
    });
  } catch (e) {
    return jsonRes({ ok: false, erro: "Stripe session: " + (e as Error).message }, 500);
  }

  // 5. Persiste IDs no termo
  await sb.from("termos_adesao").update({
    stripe_customer_id: customerId,
    stripe_checkout_session_id: session.id,
  }).eq("id", termo.id);

  return jsonRes({ ok: true, checkout_url: session.url, session_id: session.id, customer_id: customerId, mensalidade });
});
