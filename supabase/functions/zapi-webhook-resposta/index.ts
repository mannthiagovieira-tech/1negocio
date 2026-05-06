// Edge Function: zapi-webhook-resposta
// Webhook do Z-API · recebe respostas do lead · classifica via Haiku 4.5 · marca quente
// verify_jwt: false · query param ?telefone_id=<uuid>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const VALID_CATS = ["interesse_alto", "interesse_medio", "duvida", "recusa", "off_topic"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function normTel(s: any): string {
  return String(s || "").replace(/\D/g, "");
}

function extractText(payload: any): string {
  // Z-API formats variam · suporta common shapes
  return (
    payload?.text?.message ||
    payload?.text?.body ||
    payload?.message?.text ||
    payload?.message?.conversation ||
    payload?.body ||
    payload?.text ||
    ""
  );
}

function extractRemetente(payload: any): string {
  return normTel(
    payload?.phone ||
    payload?.from ||
    payload?.sender ||
    payload?.message?.from ||
    payload?.contact?.phone ||
    ""
  );
}

function isFromBot(payload: any): boolean {
  return !!(payload?.fromMe || payload?.from_me || payload?.message?.fromMe);
}

async function classificarHaiku(texto: string): Promise<string> {
  if (!ANTHROPIC_API_KEY) return "off_topic";
  const prompt = `Classifique esta resposta de WhatsApp em UMA destas 5 categorias:
- interesse_alto: cliente quer saber mais sobre o serviço
- interesse_medio: cliente faz pergunta sobre o produto
- duvida: cliente faz pergunta lateral (preço · prazo)
- recusa: cliente diz que não tem interesse
- off_topic: mensagem não relacionada

Resposta: '${(texto || "").slice(0, 800)}'

Retorne APENAS a categoria · sem explicação.`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 20,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) {
      console.error("[zapi-webhook-resposta] Anthropic", r.status);
      return "off_topic";
    }
    const j = await r.json();
    const out = String(j?.content?.[0]?.text || "").trim().toLowerCase().replace(/[^a-z_]/g, "");
    return VALID_CATS.includes(out) ? out : "off_topic";
  } catch (e) {
    console.error("[zapi-webhook-resposta] classifier exception:", e);
    return "off_topic";
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const telefone_id = url.searchParams.get("telefone_id") || "";
  if (!telefone_id) {
    return new Response(JSON.stringify({ ok: false, erro: "telefone_id ausente" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  let payload: any = {};
  try { payload = await req.json(); } catch {}

  // Filtros
  if (isFromBot(payload)) {
    return new Response(JSON.stringify({ ok: true, ignorado: "fromMe" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const texto = extractText(payload);
  const remetente = extractRemetente(payload);
  if (!texto || !remetente) {
    return new Response(JSON.stringify({ ok: true, ignorado: "sem texto/remetente" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const sb = createClient(SB_URL, SB_SERVICE);

  // Identifica envio correspondente: lead_telefone match (fuzzy match com normalização) E status=enviado E sem resposta · campanha desse telefone
  // Usa LIKE com últimos 9 dígitos pra reduzir false negatives de DDD/55
  const tail = remetente.slice(-9);
  const { data: candidatos } = await sb.from("disparador_envios")
    .select("id, campanha_id, lead_id, lead_telefone, mensagem_enviada, enviado_em, campanha:disparador_campanhas!campanha_id(id, zapi_telefone_id, total_respondidos, total_quentes)")
    .eq("status", "enviado")
    .is("resposta_em", null)
    .ilike("lead_telefone", `%${tail}`)
    .order("enviado_em", { ascending: false })
    .limit(5);

  // Filtra match pelo telefone Z-API correto
  const env = (candidatos || []).find((e: any) => e?.campanha?.zapi_telefone_id === telefone_id);
  if (!env) {
    return new Response(JSON.stringify({ ok: true, ignorado: "sem envio matchando", remetente, telefone_id }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Classifica
  const cat = await classificarHaiku(texto);
  const quente = ["interesse_alto", "interesse_medio"].includes(cat);
  const nowIso = new Date().toISOString();

  await sb.from("disparador_envios").update({
    resposta_em: nowIso,
    resposta_texto: (texto || "").slice(0, 2000),
    status: "respondido",
    classificacao_ia: cat,
    quente,
  }).eq("id", env.id);

  const camp: any = env.campanha;
  await sb.from("disparador_campanhas").update({
    total_respondidos: (camp?.total_respondidos || 0) + 1,
    total_quentes: (camp?.total_quentes || 0) + (quente ? 1 : 0),
  }).eq("id", env.campanha_id);

  // Atualiza lead com tema_conversa pra triagem futura (não-bloqueante)
  if (env.lead_id) {
    sb.from("leads_google").update({
      tema_conversa: cat,
      ultima_mensagem_recebida: nowIso,
      resposta_em: nowIso,
    }).eq("id", env.lead_id).then(() => {}).catch(() => {});
  }

  return new Response(JSON.stringify({ ok: true, classificacao: cat, quente, envio_id: env.id }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
