// otp-verify | Etapa 1 - Base OTP | 1negocio.com.br

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const OTP_INTERNAL_SECRET = Deno.env.get("OTP_INTERNAL_SECRET")!;

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
});

const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
});

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
          status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

function isE164(phone: string): boolean {
    return /^\+55\d{10,11}$/.test(phone);
}

function mascararPhone(p: string): string {
    if (p.length < 8) return "***";
    return p.slice(0, 7) + "***" + p.slice(-3);
}

async function getSyntheticPassword(phone: string): Promise<string> {
    const data = new TextEncoder().encode(phone + ":" + OTP_INTERNAL_SECRET);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
          return new Response(null, { headers: corsHeaders });
    }

             if (req.method !== "POST") {
                   return json({ ok: false, error: "Método não permitido" }, 405);
             }

             let body: { whatsapp?: string; codigo?: string; nome?: string };
    try {
          body = await req.json();
    } catch {
          return json({ ok: false, error: "JSON inválido" }, 400);
    }

             const { whatsapp, codigo, nome } = body;

             if (!whatsapp || !codigo) {
                   return json({ ok: false, error: "whatsapp e codigo são obrigatórios" }, 400);
             }

             const phone = whatsapp.startsWith("+") ? whatsapp : `+${whatsapp}`;

             if (!isE164(phone)) {
                   return json({ ok: false, error: "Formato inválido. Use E.164: +5548999999999" }, 400);
             }

             if (!/^\d{6}$/.test(codigo)) {
                   return json({ ok: false, error: "Código deve ter 6 dígitos" }, 400);
             }

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
                   return json({ ok: false, error: "Erro interno" }, 500);
             }

             if (!otpRow) {
                   return json({ ok: false, error: "Código inválido ou expirado" }, 400);
             }

             const { data: updated, error: updateErr } = await adminClient
      .from("otp_codigos")
      .update({ tentativas: otpRow.tentativas + 1 })
      .eq("id", otpRow.id)
      .lt("tentativas", 5)
      .select("tentativas")
      .single();

             if (updateErr || !updated) {
                   return json({ ok: false, error: "Muitas tentativas. Solicite um novo código." }, 429);
             }

             if (otpRow.codigo !== codigo) {
                   const restantes = 5 - updated.tentativas;
                   if (restantes <= 0) {
                           return json({ ok: false, error: "Código incorreto. Limite de tentativas esgotado, solicite um novo código." }, 429);
                   }
                   return json(
                     {
                               ok: false,
                               error: `Código incorreto. ${restantes} tentativa${restantes === 1 ? "" : "s"} restante${restantes === 1 ? "" : "s"}.`,
                     },
                           400
                         );
             }

             await adminClient.from("otp_codigos").update({ usado: true }).eq("id", otpRow.id);

             const syntheticPassword = await getSyntheticPassword(phone);

             const { data: userRows, error: findErr } = await adminClient
      .rpc("get_user_by_phone", { p_phone: phone });

             if (findErr) {
                   console.error("[otp-verify] Erro ao buscar user:", findErr);
                   return json({ ok: false, error: "Erro interno" }, 500);
             }

             const existingUser = userRows?.[0] ?? null;

             if (existingUser) {
                   const currentNome = existingUser.raw_user_meta_data?.nome;
                   if (nome && nome !== currentNome) {
                           await adminClient.auth.admin.updateUserById(existingUser.id, {
                                     user_metadata: { ...existingUser.raw_user_meta_data, nome },
                           });
                   }
             } else {
                   const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
                           phone,
                           password: syntheticPassword,
                           phone_confirm: true,
                           user_metadata: { nome: nome || phone },
                   });

      if (createErr || !newUser?.user) {
              console.error("[otp-verify] Erro ao criar user:", createErr);
              return json({ ok: false, error: "Erro ao criar conta" }, 500);
      }
             }

             const { data: sessionData, error: signInErr } = await anonClient.auth.signInWithPassword({
                   phone,
                   password: syntheticPassword,
             });

             if (signInErr || !sessionData?.session) {
                   console.error("[otp-verify] Erro ao fazer signIn:", signInErr);
                   return json({ ok: false, error: "Erro ao criar sessão" }, 500);
             }

             const { count: adminCount } = await adminClient
      .from("admins")
      .select("id", { count: "exact", head: true })
      .eq("whatsapp", phone);

             const is_admin = (adminCount ?? 0) > 0;

             console.log(
                   `[otp-verify] Login OK — phone: ${mascararPhone(phone)}, user_id: ${sessionData.user.id}, is_admin: ${is_admin}`
                 );

             return json({
                   ok: true,
                   access_token: sessionData.session.access_token,
                   refresh_token: sessionData.session.refresh_token,
                   user_id: sessionData.user.id,
                   is_admin,
             });
});
