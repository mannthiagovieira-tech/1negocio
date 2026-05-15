// Edge Function: otp-send
// Envia OTP de 6 digitos via SMS usando Twilio Verify Service
// 1negocio.com.br | Projeto: dbijmgqlcrgjlcfrastg

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")!;
const TWILIO_VERIFY_SERVICE_SID = Deno.env.get("TWILIO_VERIFY_SERVICE_SID")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

// Valida formato E.164 Brasil: 55 + DDD (2 digitos) + numero (8 ou 9 digitos)
function validarWhatsappBR(wpp: string): boolean {
      return /^55\d{2}[6-9]\d{7,8}$/.test(wpp);
}

Deno.serve(async (req: Request) => {
      if (req.method === "OPTIONS") {
              return new Response(null, { headers: corsHeaders });
      }

             if (req.method !== "POST") {
                     return json({ ok: false, error: "Metodo nao permitido" }, 405);
             }

             let body: { whatsapp?: string };
      try {
              body = await req.json();
      } catch {
              return json({ ok: false, error: "Body JSON invalido" }, 400);
      }

             const whatsappSemPlus = (body.whatsapp ?? "").trim().replace(/\D/g, "");

             if (!whatsappSemPlus) {
                     return json({ ok: false, error: "Campo whatsapp obrigatorio" }, 400);
             }

             if (!validarWhatsappBR(whatsappSemPlus)) {
                     return json(
                         { ok: false, error: "Formato invalido. Esperado: 55 + DDD + numero (ex: 5548999887766)" },
                               400
                             );
             }

             // Rate limit local: max 3 envios por numero por hora
             const umaHoraAtras = new Date(Date.now() - 60 * 60 * 1000).toISOString();

             const { count, error: countError } = await supabase
        .from("otp_codigos")
        .select("*", { count: "exact", head: true })
        .eq("whatsapp", whatsappSemPlus)
        .gte("criado_em", umaHoraAtras);

             if (countError) {
                     console.error("[otp-send] Erro rate limit:", countError.message);
                     return json({ ok: false, error: "Erro interno" }, 500);
             }

             if ((count ?? 0) >= 3) {
                     return json(
                         { ok: false, error: "Limite de 3 envios por hora atingido. Aguarde antes de solicitar novo codigo." },
                               429
                             );
             }

             // Chama Twilio Verify Service para enviar SMS
             const phoneE164 = "+" + whatsappSemPlus;
      const twilioUrl = `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}/Verifications`;
      const authHeader = "Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

             const twilioBody = new URLSearchParams({
                     To: phoneE164,
                     Channel: "sms",
             });

             try {
                     const twilioResp = await fetch(twilioUrl, {
                               method: "POST",
                               headers: {
                                           "Authorization": authHeader,
                                           "Content-Type": "application/x-www-form-urlencoded",
                               },
                               body: twilioBody.toString(),
                     });

        const twilioData = await twilioResp.json();

        if (!twilioResp.ok) {
                  console.error("[otp-send] Twilio erro:", twilioResp.status, twilioData);
                  return json({
                              ok: false,
                              error: "Nao foi possivel enviar o codigo. Verifique o numero e tente novamente."
                  }, 500);
        }

        console.log("[otp-send] Twilio OK:", twilioData.sid, "status:", twilioData.status);

             } catch (e) {
                     const msg = e instanceof Error ? e.message : String(e);
                     console.error("[otp-send] Erro chamada Twilio:", msg);
                     return json({ ok: false, error: "Erro ao enviar SMS" }, 500);
             }

             // Registra envio em otp_codigos (sem o codigo — Twilio guarda)
             // Usamos 'codigo' = "TWILIO" para sinalizar que a verificacao e delegada
             const expira_em = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min (Twilio default)

             const { error: insertError } = await supabase.from("otp_codigos").insert({
                     whatsapp: whatsappSemPlus,
                     codigo: "TWILIO",
                     expira_em,
             });

             if (insertError) {
                     // Nao-fatal: log mas prossegue (SMS ja foi enviado)
        console.warn("[otp-send] Erro ao inserir marca em otp_codigos:", insertError.message);
             }

             return json({
                     ok: true,
                     expira_em,
                     canal: "sms",
             });
});
