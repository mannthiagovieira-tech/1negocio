// otp-verify | Etapa 1 - Base OTP | 1negocio.com.br
// Valida código OTP WhatsApp, cria/recupera user em auth.users via phone,
// retorna access_token + refresh_token usando signInWithPassword com senha sintética.
//
// Requer secrets da Edge Function:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, OTP_INTERNAL_SECRET
//
// Requer no Supabase Dashboard:
//   Authentication → Sign In / Providers → Phone → habilitado

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY         = Deno.env.get("SUPABASE_ANON_KEY")!;
const OTP_INTERNAL_SECRET       = Deno.env.get("OTP_INTERNAL_SECRET")!;

// Clients declarados no escopo global (fora do handler) para reutilização em warm containers.
// Seguro porque persistSession: false garante que signInWithPassword não armazena
// nenhum estado de sessão no client — sem memória compartilhada entre requests.
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isE164(phone: string): boolean {
  return /^\+55\d{10,11}$/.test(phone);
}

// Mascara phone para logs: +5548999279320 → +5548999***320
function mascararPhone(p: string): string {
  if (p.length < 8) return "***";
  return p.slice(0, 7) + "***" + p.slice(-3);
}

// Senha sintética determinística: SHA-256(phone + ":" + OTP_INTERNAL_SECRET)
// Nunca armazenada. Recalculável a partir do phone sempre que necessário.
// TODO BACKLOG: rotação de OTP_INTERNAL_SECRET requer auto-heal (updateUserById + retry)
async function getSyntheticPassword(phone: string): Promise<string> {
  const data = new TextEncoder().encode(phone + ":" + OTP_INTERNAL_SECRET);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ ok: false, error: "Método não permitido" }, { status: 405 });
  }

  let body: { whatsapp?: string; codigo?: string; nome?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  const { whatsapp, codigo, nome } = body;

  // ── 1. Validação de entrada ────────────────────────────────────────────────
  if (!whatsapp || !codigo) {
    return Response.json(
      { ok: false, error: "whatsapp e codigo são obrigatórios" },
      { status: 400 }
    );
  }

  const phone = whatsapp.startsWith("+") ? whatsapp : `+${whatsapp}`;
  if (!isE164(phone)) {
    return Response.json(
      { ok: false, error: "Formato inválido. Use E.164: +5548999999999" },
      { status: 400 }
    );
  }

  if (!/^\d{6}$/.test(codigo)) {
    return Response.json(
      { ok: false, error: "Código deve ter 6 dígitos" },
      { status: 400 }
    );
  }

  // ── 2. Buscar OTP válido ───────────────────────────────────────────────────
  const now = new Date().toISOString();

  const { data: otpRow, error: otpErr } = await adminClient
    .from("otp_codigos")
    .select("id, codigo, tentativas, usado")
    .eq("whatsapp", phone)
    .eq("usado", false)
    .gt("expira_em", now)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (otpErr) {
    console.error("[otp-verify] Erro ao buscar OTP:", otpErr);
    return Response.json({ ok: false, error: "Erro interno" }, { status: 500 });
  }

  if (!otpRow) {
    return Response.json(
      { ok: false, error: "Código inválido ou expirado" },
      { status: 400 }
    );
  }

  // ── 3. Incremento atômico de tentativas ───────────────────────────────────
  // Atualiza tentativas SOMENTE se ainda < 5.
  // Se retornar vazio, limite já atingido (evita race condition SELECT→UPDATE).
  const { data: updated, error: updateErr } = await adminClient
    .from("otp_codigos")
    .update({ tentativas: otpRow.tentativas + 1 })
    .eq("id", otpRow.id)
    .lt("tentativas", 5)
    .select("tentativas")
    .single();

  if (updateErr || !updated) {
    return Response.json(
      { ok: false, error: "Muitas tentativas. Solicite um novo código." },
      { status: 429 }
    );
  }

  // ── 4. Validar código ──────────────────────────────────────────────────────
  if (otpRow.codigo !== codigo) {
    const restantes = 5 - updated.tentativas;
    if (restantes <= 0) {
      return Response.json(
        { ok: false, error: "Código incorreto. Limite de tentativas esgotado, solicite um novo código." },
        { status: 429 }
      );
    }
    return Response.json(
      {
        ok: false,
        error: `Código incorreto. ${restantes} tentativa${restantes === 1 ? "" : "s"} restante${restantes === 1 ? "" : "s"}.`,
      },
      { status: 400 }
    );
  }

  // ── 5. Marcar OTP como usado ───────────────────────────────────────────────
  await adminClient
    .from("otp_codigos")
    .update({ usado: true })
    .eq("id", otpRow.id);

  // ── 6. Gerar senha sintética ───────────────────────────────────────────────
  const syntheticPassword = await getSyntheticPassword(phone);

  // ── 7. Criar ou recuperar user — RPC get_user_by_phone ────────────────────
  // Usa função SQL SECURITY DEFINER no schema public para acessar auth.users.
  // PostgREST não expõe o schema auth diretamente (PGRST106).
  const { data: userRows, error: findErr } = await adminClient
    .rpc("get_user_by_phone", { p_phone: phone });

  if (findErr) {
    console.error("[otp-verify] Erro ao buscar user:", findErr);
    return Response.json({ ok: false, error: "Erro interno" }, { status: 500 });
  }

  const existingUser = userRows?.[0] ?? null;

  if (existingUser) {
    // Atualiza nome se fornecido e diferente do atual
    const currentNome = existingUser.raw_user_meta_data?.nome;
    if (nome && nome !== currentNome) {
      await adminClient.auth.admin.updateUserById(existingUser.id, {
        user_metadata: { ...existingUser.raw_user_meta_data, nome },
      });
    }
  } else {
    // Novo user — apenas phone + senha sintética, sem email
    const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
      phone,
      password: syntheticPassword,
      phone_confirm: true,
      user_metadata: { nome: nome || phone },
    });

    if (createErr || !newUser?.user) {
      console.error("[otp-verify] Erro ao criar user:", createErr);
      return Response.json({ ok: false, error: "Erro ao criar conta" }, { status: 500 });
    }
  }

  // ── 8. Gerar sessão via signInWithPassword ─────────────────────────────────
  // anonClient retorna tokens válidos (access_token + refresh_token).
  const { data: sessionData, error: signInErr } = await anonClient.auth.signInWithPassword({
    phone,
    password: syntheticPassword,
  });

  if (signInErr || !sessionData?.session) {
    console.error("[otp-verify] Erro ao fazer signIn:", signInErr);
    return Response.json({ ok: false, error: "Erro ao criar sessão" }, { status: 500 });
  }

  // ── 9. Checar admin ────────────────────────────────────────────────────────
  const { count: adminCount } = await adminClient
    .from("admins")
    .select("id", { count: "exact", head: true })
    .eq("whatsapp", phone);

  const is_admin = (adminCount ?? 0) > 0;

  console.log(
    `[otp-verify] Login OK — phone: ${mascararPhone(phone)}, user_id: ${sessionData.user.id}, is_admin: ${is_admin}`
  );

  return Response.json({
    ok: true,
    access_token: sessionData.session.access_token,
    refresh_token: sessionData.session.refresh_token,
    user_id: sessionData.user.id,
    is_admin,
  });
});
