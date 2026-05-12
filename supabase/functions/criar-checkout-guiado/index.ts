// Edge Function: criar-checkout-guiado
// Cria negócio rascunho + Stripe Checkout Session R$ 588 (Plano Guiado).
// v9.27-checkout · contratação direta sem fricção de diagnóstico prévio.
//
// Auth · JWT do otp-verify (verify_jwt=true · valida assinatura)
// Body · { nome_negocio: string, cidade: string, estado?: string }
// Saída · { ok, checkout_url, negocio_id, codigo }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@12.0.0?target=deno";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Aceita STRIPE_SECRET_KEY ou STRIPE_API_KEY (alguns projetos usam o nome alternativo).
// Validação de prefixo abaixo evita usar STRIPE_WEBHOOK_SECRET (whsec_) por engano.
const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY") || Deno.env.get("STRIPE_API_KEY") || "";

const SITE_BASE = "https://1negocio.com.br";
const PRODUTO_GUIADO = "prod_U9xFu2gWXEUOAH";
const VALOR_CENTAVOS = 58800;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonRes(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonRes({ ok: false, erro: "Method not allowed" }, 405);

  // 0. Valida configuração de STRIPE_SECRET_KEY antes de qualquer side effect.
  // Aceita sk_live_/sk_test_ (chave padrão) e rk_live_/rk_test_ (chave restrita ·
  // Stripe Restricted Key gera Checkout Sessions normalmente). Bloqueia whsec_
  // (webhook secret) e vazio.
  const validPrefixes = ["sk_live_", "sk_test_", "rk_live_", "rk_test_"];
  if (!STRIPE_SECRET || !validPrefixes.some(p => STRIPE_SECRET.startsWith(p))) {
    const prefix = STRIPE_SECRET ? STRIPE_SECRET.slice(0, 8) : "(vazio)";
    console.error(`[criar-checkout-guiado] STRIPE_SECRET_KEY inválida · prefixo: ${prefix}`);
    return jsonRes({
      ok: false,
      erro: "Configuração de pagamento indisponível. Fale com a equipe pra reativar.",
      erro_debug: `STRIPE_SECRET_KEY prefix inesperado: ${prefix} · esperado sk_live_ · sk_test_ · rk_live_ · rk_test_`,
    }, 503);
  }

  // 1. Valida JWT
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonRes({ ok: false, erro: "Missing authorization token" }, 401);
  }
  const accessToken = authHeader.replace("Bearer ", "").trim();

  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: userData, error: userErr } = await anonClient.auth.getUser(accessToken);
  if (userErr || !userData?.user) {
    return jsonRes({ ok: false, erro: "Invalid or expired token" }, 401);
  }
  const userId = userData.user.id;

  // 2. Parse + valida body
  let body: { nome_negocio?: string; cidade?: string; estado?: string };
  try {
    body = await req.json();
  } catch {
    return jsonRes({ ok: false, erro: "Invalid JSON body" }, 400);
  }

  const nome_negocio = String(body.nome_negocio || "").trim();
  const cidade = String(body.cidade || "").trim();
  const estado = body.estado ? String(body.estado).trim().toUpperCase().slice(0, 2) : null;

  if (!nome_negocio) return jsonRes({ ok: false, erro: "nome_negocio obrigatório" }, 400);
  if (!cidade) return jsonRes({ ok: false, erro: "cidade obrigatória" }, 400);

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // 3. Lookup usuario (nome, email, whatsapp)
  const { data: usuario, error: uerr } = await sb
    .from("usuarios")
    .select("id, nome, email, whatsapp, tipo")
    .eq("id", userId)
    .maybeSingle();
  if (uerr) {
    console.error("[criar-checkout-guiado] erro lookup usuario:", uerr.message);
    return jsonRes({ ok: false, erro: "Erro ao buscar usuário" }, 500);
  }
  if (!usuario) {
    return jsonRes({ ok: false, erro: "Usuário não encontrado · refaça o OTP" }, 404);
  }

  // 4. INSERT negocio rascunho (trigger gera codigo='1N-XXXX')
  const { data: negocio, error: negErr } = await sb
    .from("negocios")
    .insert({
      vendedor_id: userId,
      nome: nome_negocio,
      nome_negocio,
      cidade,
      estado,
      status: "rascunho",
      origem: "checkout_guiado_direto",
    })
    .select("id, codigo")
    .single();

  if (negErr || !negocio) {
    console.error("[criar-checkout-guiado] erro INSERT negocios:", negErr?.message);
    return jsonRes({ ok: false, erro: "Erro ao criar rascunho do negócio" }, 500);
  }

  // 5. Promove usuarios.tipo='buy' → 'sell' (não-fatal)
  if (usuario.tipo === "buy") {
    const { error: updTipoErr } = await sb
      .from("usuarios")
      .update({ tipo: "sell" })
      .eq("id", userId)
      .eq("tipo", "buy");
    if (updTipoErr) console.warn("[criar-checkout-guiado] não-fatal: update tipo falhou:", updTipoErr.message);
  }

  // 6. Cria Stripe Checkout Session
  const stripe = new Stripe(STRIPE_SECRET, { apiVersion: "2023-10-16" });

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "brl",
          unit_amount: VALOR_CENTAVOS,
          product: PRODUTO_GUIADO,
        },
      }],
      client_reference_id: negocio.id,
      metadata: {
        negocio_id: negocio.id,
        usuario_id: userId,
        produto_id: PRODUTO_GUIADO,
        plano: "guiado_direto",
        nome_negocio,
        origem: "checkout_guiado_direto",
      },
      success_url: `${SITE_BASE}/vender-guiado.html?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_BASE}/vender-guiado.html?canceled=true&negocio_id=${negocio.id}`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[criar-checkout-guiado] Stripe session erro:", msg);
    // Marca negócio com observação · não deleta (admin pode retomar)
    // Sanitiza pra não vazar segredo em notas_admin (msg pode ecoar a key)
    const safeMsg = msg.replace(/whsec_[A-Za-z0-9]+/g, "whsec_***").replace(/sk_[a-z]+_[A-Za-z0-9]+/g, "sk_***");
    await sb.from("negocios").update({
      notas_admin: `Stripe Checkout falhou: ${safeMsg.slice(0, 200)} · ${new Date().toISOString()}`,
    }).eq("id", negocio.id);
    return jsonRes({
      ok: false,
      erro: "Erro ao criar sessão de pagamento",
      erro_debug: safeMsg.slice(0, 200),
      negocio_id: negocio.id,
    }, 500);
  }

  // 7. Persiste stripe_session_id no negócio (não-fatal · webhook vai sobrescrever ao confirmar pagamento)
  await sb.from("negocios").update({
    stripe_session_id: session.id,
  }).eq("id", negocio.id);

  console.log(`[criar-checkout-guiado] negocio=${negocio.id} codigo=${negocio.codigo} session=${session.id}`);

  return jsonRes({
    ok: true,
    checkout_url: session.url,
    negocio_id: negocio.id,
    codigo: negocio.codigo,
  });
});
