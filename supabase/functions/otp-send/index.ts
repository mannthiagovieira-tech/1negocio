// Edge Function: otp-send
// Gera e envia OTP de 6 digitos via Z-API para autenticacao WhatsApp
// Etapa 1 - Base OTP | 1negocio.com.br
// Projeto: dbijmgqlcrgjlcfrastg

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ZAPI_INSTANCE = Deno.env.get("ZAPI_INSTANCE");
const ZAPI_TOKEN = Deno.env.get("ZAPI_TOKEN");
const ZAPI_CLIENT_TOKEN = Deno.env.get("ZAPI_CLIENT_TOKEN");

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

function validarWhatsappBR(wpp: string): boolean {
    return /^55\d{2}[6-9]\d{7,8}$/.test(wpp);
}

function gerarCodigo(): string {
    return String(Math.floor(100000 + Math.random() * 900000));
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

             const whatsapp = (body.whatsapp ?? "").trim().replace(/\D/g, "");

             if (!whatsapp) {
                   return json({ ok: false, error: "Campo whatsapp obrigatorio" }, 400);
             }

             if (!validarWhatsappBR(whatsapp)) {
                   return json(
                     { ok: false, error: "Formato invalido. Esperado: 55 + DDD + numero (ex: 5548999887766)" },
                           400
                         );
             }

             const umaHoraAtras = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: countError } = await supabase
      .from("otp_codigos")
      .select("*", { count: "exact", head: true })
      .eq("whatsapp", whatsapp)
      .gte("criado_em", umaHoraAtras);

             if (countError) {
                   console.error("[otp-send] Erro ao verificar rate limit:", countError.message);
                   return json({ ok: false, error: "Erro interno" }, 500);
             }

             if ((count ?? 0) >= 3) {
                   return json(
                     { ok: false, error: "Limite de envios atingido. Aguarde 1 hora." },
                           429
                         );
             }

             const codigo = gerarCodigo();
    const expira_em = new Date(Date.now() + 5 * 60 * 1000).toISOString();

             const { error: insertError } = await supabase.from("otp_codigos").insert({
                   whatsapp,
                   codigo,
                   expira_em,
             });

             if (insertError) {
                   console.error("[otp-send] Erro ao inserir OTP:", insertError.message);
                   return json({ ok: false, error: "Erro ao gerar codigo" }, 500);
             }

             const mensagem = "Seu codigo de acesso 1Negocio: " + codigo + ". Valido por 5 minutos. Nao compartilhe.";

             let zapiOk = false;
    let zapiErro = "";

             if (ZAPI_INSTANCE && ZAPI_TOKEN && ZAPI_CLIENT_TOKEN) {
                   try {
                           const zapiResp = await fetch(
                                     SUPABASE_URL + "/functions/v1/zapi-relay",
                             {
                                         method: "POST",
                                         headers: {
                                                       "Content-Type": "application/json",
                                                       "Authorization": "Bearer " + SUPABASE_SERVICE_ROLE_KEY,
                                         },
                                         body: JSON.stringify({ phone: whatsapp, message: mensagem }),
                             }
                                   );
                           if (zapiResp.ok) {
                                     zapiOk = true;
                           } else {
                                     const errBody = await zapiResp.text();
                                     zapiErro = "zapi-relay status " + zapiResp.status + ": " + errBody;
                                     console.warn("[otp-send] zapi-relay retornou erro:", zapiErro);
                           }
                   } catch (e: unknown) {
      zapiErro = e instanceof Error ? e.message : String(e);
                           console.warn("[otp-send] Falha ao chamar zapi-relay:", zapiErro);
                   }
             } else {
                   zapiErro = "Secrets Z-API nao configurados";
                   console.warn("[otp-send] Secrets Z-API ausentes");
             }

             if (!zapiOk) {
                   console.error("[otp-send] Z-API falhou:", zapiErro);
             }

             return json({ ok: true, expira_em });
});
