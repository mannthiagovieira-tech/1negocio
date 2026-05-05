// Edge Function: solicitar-assessorado
// Fase 1 · Plano Assessorado · recebe form do laudo-completo.html
// Salva em solicitacoes_assessorado · dispara WhatsApp pro admin

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_WHATSAPP = Deno.env.get("ADMIN_WHATSAPP") ?? "";
const ZAPI_INSTANCE = Deno.env.get("ZAPI_INSTANCE") ?? "";
const ZAPI_TOKEN = Deno.env.get("ZAPI_TOKEN") ?? "";
const ZAPI_CLIENT_TOKEN = Deno.env.get("ZAPI_CLIENT_TOKEN") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function normalizarTelefone(t: string): string | null {
  const dig = String(t || "").replace(/\D/g, "");
  if (dig.length < 10 || dig.length > 13) return null;
  return dig.startsWith("55") ? dig : (dig.length === 10 || dig.length === 11 ? "55" + dig : dig);
}

async function notificarAdmin(p: { nome: string; telefone: string; negocio: string; mensagem: string }): Promise<void> {
  if (!ADMIN_WHATSAPP || !ZAPI_INSTANCE || !ZAPI_TOKEN) return;
  const tel = p.telefone.replace(/\D/g, "");
  const msg = [
    "🔥🔥 LEAD ASSESSORADO · " + (p.nome || "sem nome"),
    "📱 https://wa.me/" + tel,
    "🏢 Negócio: " + (p.negocio || "—"),
    p.mensagem ? "💬 \"" + p.mensagem.replace(/[\n\r]+/g, " ").slice(0, 80) + "\"" : "",
    "",
    "Cockpit: https://1negocio.com.br/painel-v3.html#cockpit",
  ].filter(Boolean).join("\n");
  const url = `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ZAPI_CLIENT_TOKEN) headers["Client-Token"] = ZAPI_CLIENT_TOKEN;
  try {
    await fetch(url, { method: "POST", headers, body: JSON.stringify({ phone: ADMIN_WHATSAPP, message: msg }) });
  } catch (e) { console.warn("[zapi]", e); }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));
    const { usuario_id, diagnostico_id, nome, telefone, nome_negocio, mensagem, pagina_origem } = body || {};

    if (!nome || !telefone) {
      return new Response(JSON.stringify({ ok: false, erro: "nome e telefone obrigatórios" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    }
    const telNorm = normalizarTelefone(telefone);
    if (!telNorm) {
      return new Response(JSON.stringify({ ok: false, erro: "telefone inválido (precisa 10-13 dígitos)" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const payload = {
      usuario_id: usuario_id || null,
      diagnostico_id: diagnostico_id || null,
      nome_solicitante: String(nome).trim().slice(0, 200),
      telefone: telNorm,
      nome_negocio: nome_negocio ? String(nome_negocio).trim().slice(0, 200) : null,
      mensagem_livre: mensagem ? String(mensagem).trim().slice(0, 1000) : null,
      pagina_origem: pagina_origem || null,
      status: "aguardando",
    };

    const { data: nova, error } = await supabase.from("solicitacoes_assessorado").insert(payload).select("id").single();
    if (error) return new Response(JSON.stringify({ ok: false, erro: "insert: " + error.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });

    // Sincroniza com leads_google · dedup por telefone
    try {
      const { data: existente } = await supabase.from("leads_google").select("id, tags, fontes, tipo_plano").eq("telefone", telNorm).maybeSingle();
      if (existente) {
        const tags = Array.from(new Set([...(existente.tags || []), "lead_assessorado", "lead_quente"]));
        const fontes = Array.from(new Set([...(existente.fontes || []), "solicitacao_assessorado"]));
        await supabase.from("leads_google").update({
          tags, fontes,
          tipo_plano: "assessorado",
          classificacao_ia: "empresario_alvo",
          duplicado_em: new Date().toISOString(),
          nome: existente.nome || payload.nome_solicitante,
        }).eq("id", existente.id);
      } else {
        await supabase.from("leads_google").insert({
          nome: payload.nome_solicitante,
          telefone: telNorm,
          telefone_formatado: "+" + telNorm,
          origem: "solicitacao_assessorado",
          fontes: ["solicitacao_assessorado"],
          tags: ["lead_assessorado", "lead_quente"],
          classificacao_ia: "empresario_alvo",
          classificado_em: new Date().toISOString(),
          tipo_plano: "assessorado",
          status: "novo",
          campanha: "plano_assessorado_2026_05",
          notas: `[Assessorado] negócio: ${payload.nome_negocio || "—"}\nmensagem: ${payload.mensagem_livre || "—"}`,
        });
      }
    } catch (e) { console.warn("[sync leads_google]", e); }

    notificarAdmin({
      nome: payload.nome_solicitante,
      telefone: telNorm,
      negocio: payload.nome_negocio || "",
      mensagem: payload.mensagem_livre || "",
    }).catch(() => {});

    return new Response(JSON.stringify({ ok: true, id: nova.id }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, erro: String((e as Error).message) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
