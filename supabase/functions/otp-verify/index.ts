// otp-verify | 1negocio.com.br
// Valida código OTP via Twilio Verify Service.
// Em caso de sucesso: cria/recupera user em auth.users (via phone + senha sintética)
// e retorna access_token + refresh_token.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const OTP_INTERNAL_SECRET = Deno.env.get("OTP_INTERNAL_SECRET")!;
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")!;
const TWILIO_VERIFY_SERVICE_SID = Deno.env.get("TWILIO_VERIFY_SERVICE_SID")!;

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

function isE164SemPlus(phone: string): boolean {
        return /^55\d{10,11}$/.test(phone);
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

// Chama Twilio Verify Check
async function verifyTwilioCode(phoneE164: string, code: string): Promise<{ ok: boolean; status?: string; error?: string }> {
        const url = `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`;
        const authHeader = "Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
        const body = new URLSearchParams({
                  To: phoneE164,
                  Code: code,
        });

  try {
            const resp = await fetch(url, {
                        method: "POST",
                        headers: {
                                      "Authorization": authHeader,
                                      "Content-Type": "application/x-www-form-urlencoded",
                        },
                        body: body.toString(),
            });

          const data = await resp.json();

          if (!resp.ok) {
                      // 404 = Verification nao existe (provavelmente expirou)
              // 60200 = codigo incorreto
              console.error("[otp-verify] Twilio erro:", resp.status, data);
                      return { ok: false, error: data.message || "Codigo invalido ou expirado" };
          }

          return { ok: data.status === "approved", status: data.status };
  } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error("[otp-verify] Falha chamando Twilio:", msg);
            return { ok: false, error: "Erro de rede ao validar codigo" };
  }
}

Deno.serve(async (req: Request) => {
        if (req.method === "OPTIONS") {
                  return new Response(null, { headers: corsHeaders });
        }

             if (req.method !== "POST") {
                       return json({ ok: false, error: "Metodo nao permitido" }, 405);
             }

             let body: { whatsapp?: string; codigo?: string; nome?: string };
        try {
                  body = await req.json();
        } catch {
                  return json({ ok: false, error: "JSON invalido" }, 400);
        }

             const { whatsapp, codigo, nome } = body;

             if (!whatsapp || !codigo) {
                       return json({ ok: false, error: "whatsapp e codigo sao obrigatorios" }, 400);
             }

             const phoneSemPlus = whatsapp.replace(/^\+/, "").replace(/\D/g, "");
        const phoneComPlus = "+" + phoneSemPlus;

             if (!isE164SemPlus(phoneSemPlus)) {
                       return json({ ok: false, error: "Formato invalido. Use: 5548999999999" }, 400);
             }

             if (!/^\d{6}$/.test(codigo)) {
                       return json({ ok: false, error: "Codigo deve ter 6 digitos" }, 400);
             }

             // 1. Valida codigo via Twilio Verify
             const twilioResult = await verifyTwilioCode(phoneComPlus, codigo);

             if (!twilioResult.ok) {
                       if (twilioResult.status === "pending") {
                                   return json({ ok: false, error: "Codigo incorreto. Tente novamente." }, 400);
                       }
                       return json({ ok: false, error: twilioResult.error || "Codigo invalido ou expirado" }, 400);
             }

             // 2. Marca o registro local como usado (auditoria)
             try {
                       await adminClient
                         .from("otp_codigos")
                         .update({ usado: true })
                         .eq("whatsapp", phoneSemPlus)
                         .eq("usado", false)
                         .gt("expira_em", new Date().toISOString());
             } catch (e) {
                       // Nao-fatal; apenas auditoria
          console.warn("[otp-verify] Erro ao marcar usado (nao-fatal):", e);
             }

             // 3. Gera senha sintetica
             const syntheticPassword = await getSyntheticPassword(phoneComPlus);

             // 4. Busca ou cria user em auth.users
             const { data: userRows, error: findErr } = await adminClient
          .rpc("get_user_by_phone", { p_phone: phoneComPlus });

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
                                   phone: phoneComPlus,
                                   password: syntheticPassword,
                                   phone_confirm: true,
                                   user_metadata: { nome: nome || phoneComPlus },
                       });

          if (createErr || !newUser?.user) {
                      console.error("[otp-verify] Erro ao criar user:", createErr);
                      return json({ ok: false, error: "Erro ao criar conta" }, 500);
          }
             }

             // 5. Gera sessao
             const { data: sessionData, error: signInErr } = await anonClient.auth.signInWithPassword({
                       phone: phoneComPlus,
                       password: syntheticPassword,
             });

             if (signInErr || !sessionData?.session) {
                       console.error("[otp-verify] Erro ao fazer signIn:", signInErr);
                       return json({ ok: false, error: "Erro ao criar sessao" }, 500);
             }

             // 6. Checa admin
             const { count: adminCount } = await adminClient
          .from("admins")
          .select("id", { count: "exact", head: true })
          .eq("whatsapp", phoneSemPlus);

             const is_admin = (adminCount ?? 0) > 0;

             console.log(
                       `[otp-verify] Login OK — phone: ${mascararPhone(phoneComPlus)}, user_id: ${sessionData.user.id}, is_admin: ${is_admin}`
                     );

             return json({
                       ok: true,
                       access_token: sessionData.session.access_token,
                       refresh_token: sessionData.session.refresh_token,
                       user_id: sessionData.user.id,
                       is_admin,
             });
});
