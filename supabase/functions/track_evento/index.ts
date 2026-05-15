// Edge Function: track_evento
// Recebe eventos de analytics dos anúncios e persiste em anuncio_eventos.
// Público (verify_jwt: false) — anon dispara via fetch keepalive.
// LGPD: hash SHA-256 do IP em vez de plain text.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function hashSha256(text: string): Promise<string> {
  const buffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function detectarDevice(userAgent: string): string {
  const ua = (userAgent || "").toLowerCase();
  if (/mobile|android|iphone|ipod/.test(ua) && !/ipad|tablet/.test(ua)) return "mobile";
  if (/ipad|tablet/.test(ua)) return "tablet";
  return "desktop";
}

const TIPOS_VALIDOS = new Set([
  "view_card", "click_card",
  "view_pagina",
  "click_aba_resumo", "click_aba_financeiro", "click_aba_indicadores", "click_aba_analise",
  "scroll_25", "scroll_50", "scroll_75", "scroll_100",
  "tempo_sessao",
  "click_solicitar_info", "click_compartilhar", "click_whatsapp", "click_voltar_home",
  "nda_solicitado", "nda_assinado", "mesa_aberta",
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function jsonResp(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResp({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json();
    const {
      anuncio_codigo,
      tipo,
      session_id,
      visitor_id,
      utm_source,
      utm_medium,
      utm_campaign,
      referrer,
      metadata = {},
    } = body;

    if (!anuncio_codigo || !tipo) {
      return jsonResp({ ok: false, error: "anuncio_codigo e tipo obrigatórios" }, 400);
    }
    if (!TIPOS_VALIDOS.has(tipo)) {
      return jsonResp({ ok: false, error: "tipo inválido: " + tipo }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: anuncio } = await supabase
      .from("anuncios_v2")
      .select("id")
      .eq("codigo", anuncio_codigo)
      .single();

    if (!anuncio) {
      return jsonResp({ ok: false, error: "anúncio não encontrado" }, 404);
    }

    const userAgent = req.headers.get("user-agent") || "";
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim()
      || req.headers.get("x-real-ip")
      || "unknown";
    const ipHash = ip !== "unknown" ? await hashSha256(ip) : null;
    const device = detectarDevice(userAgent);

    let origem = "direct";
    if (referrer) {
      try {
        const url = new URL(referrer);
        const host = url.hostname.toLowerCase();
        if (host.includes("google") || host.includes("bing")) origem = "organic";
        else if (utm_source) origem = utm_source;
        else origem = "referral";
      } catch {}
    }
    if (utm_source) origem = utm_source;

    const { error } = await supabase
      .from("anuncio_eventos")
      .insert({
        anuncio_id: anuncio.id,
        anuncio_codigo,
        tipo,
        session_id: session_id || null,
        visitor_id: visitor_id || null,
        origem,
        utm_source: utm_source || null,
        utm_medium: utm_medium || null,
        utm_campaign: utm_campaign || null,
        referrer: referrer || null,
        user_agent: userAgent,
        ip_hash: ipHash,
        device,
        metadata,
      });

    if (error) {
      console.error("Erro ao inserir evento:", error);
      return jsonResp({ ok: false, error: error.message }, 500);
    }

    return jsonResp({ ok: true }, 202);
  } catch (e) {
    console.error("Erro track_evento:", e);
    return jsonResp({ ok: false, error: String(e) }, 500);
  }
});
