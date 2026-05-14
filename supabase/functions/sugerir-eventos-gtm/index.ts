// sugerir-eventos-gtm · v9.34.4 · Sprint 5 batch 2
// IA sugere eventos empresariais brasileiros onde compradores dos arquétipos estariam.
// Usa Claude Sonnet + web_search · custo ~R$ 0,10/projeto.
//
// POST { originacao_id }
// Output: { ok, eventos: [{nome, data, cidade, url, relevancia, tipo}], custo_brl }
// Side effect: salva busca_config_jsonb.eventos_sugeridos

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const CUSTO_BRL = 0.10;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function resp(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extrairJson(texto: string): any | null {
  // Tenta parse direto
  try { return JSON.parse(texto); } catch {}
  // Bloco ```json ... ```
  const m1 = texto.match(/```json\s*([\s\S]*?)\s*```/);
  if (m1) { try { return JSON.parse(m1[1]); } catch {} }
  // Primeiro { ... }
  const m2 = texto.match(/\{[\s\S]*\}/);
  if (m2) { try { return JSON.parse(m2[0]); } catch {} }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return resp(405, { ok: false, erro: "metodo" });

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

  // Auth admin canônica
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return resp(401, { ok: false, erro: "sem_jwt" });
  const { data: userData, error: userErr } = await adminClient.auth.getUser(jwt);
  if (userErr || !userData?.user) return resp(401, { ok: false, erro: "jwt_invalido" });
  const { data: admin } = await adminClient
    .from("admins").select("id, ativo")
    .eq("whatsapp", userData.user.phone).eq("ativo", true).maybeSingle();
  if (!admin) return resp(403, { ok: false, erro: "nao_admin" });

  let body: any;
  try { body = await req.json(); } catch { return resp(400, { ok: false, erro: "json_invalido" }); }
  const { originacao_id } = body || {};
  if (!originacao_id) return resp(400, { ok: false, erro: "originacao_id_obrigatorio" });

  try {
    const { data: orig } = await adminClient
      .from("projetos_originacao")
      .select("id, fase_atual, briefing_jsonb, busca_config_jsonb, gasto_anthropic_mes")
      .eq("id", originacao_id).maybeSingle();
    if (!orig) return resp(404, { ok: false, erro: "originacao_nao_encontrada" });

    const negocio = orig.briefing_jsonb?.negocio || {};
    const setor = negocio.setor || "comércio";
    const subSetor = negocio.sub_setor || "";
    const cidade = negocio.cidade || "Brasil";
    const estado = negocio.estado || "";

    const { data: arquetipos } = await adminClient
      .from("arquetipos_compradores")
      .select("nome, perfil")
      .eq("originacao_id", originacao_id)
      .eq("status", "aprovado")
      .order("ordem", { ascending: true });
    const nomesArq = (arquetipos || []).map((a: any) => `- ${a.nome}${a.perfil ? ` (${a.perfil.slice(0, 80)})` : ""}`).join("\n") || "(sem arquétipos aprovados)";

    const systemPrompt = `Você é especialista em eventos empresariais brasileiros.
Dado este negócio e seus arquétipos de compradores, sugira eventos REAIS onde potenciais compradores estarão presentes.

Considere:
- Feiras nacionais do setor (ABF, ABRASEL, Fispal, etc · seja específico ao setor)
- Eventos de empreendedorismo na cidade do negócio
- Encontros de investidores anjo locais (Anjos do Brasil, capítulos regionais)
- Associações setoriais com eventos regulares

REGRAS:
- Só inclua eventos que realmente existem · NUNCA invente
- Máximo 8 eventos
- Use web_search pra confirmar data + URL
- Próximos 12 meses

Retorne SOMENTE JSON válido neste formato exato:
{ "eventos": [{ "nome": "...", "data": "mês/ano", "cidade": "...", "url": "...", "relevancia": "por que compradores desse perfil estariam lá", "tipo": "nacional" | "local" }] }`;

    const userMsg = `NEGÓCIO À VENDA
Setor: ${setor}${subSetor ? " / " + subSetor : ""}
Cidade: ${cidade}${estado ? "/" + estado : ""}

ARQUÉTIPOS DE COMPRADOR APROVADOS:
${nomesArq}

Use web_search e retorne o JSON com até 8 eventos relevantes.`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 3000,
        system: systemPrompt,
        messages: [{ role: "user", content: userMsg }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
      }),
    });

    if (!r.ok) {
      const errTxt = await r.text();
      return resp(500, { ok: false, erro: `anthropic_status_${r.status}`, detalhe: errTxt.slice(0, 300) });
    }

    const data = await r.json();
    const blocosTexto = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
    const parsed = extrairJson(blocosTexto);
    if (!parsed || !Array.isArray(parsed.eventos)) {
      return resp(500, { ok: false, erro: "json_parse_falhou", raw: blocosTexto.slice(0, 400) });
    }

    const eventos = parsed.eventos.slice(0, 8).map((e: any) => ({
      nome: String(e.nome || "").trim(),
      data: String(e.data || "").trim(),
      cidade: String(e.cidade || "").trim(),
      url: String(e.url || "").trim(),
      relevancia: String(e.relevancia || "").trim(),
      tipo: e.tipo === "nacional" ? "nacional" : "local",
    })).filter((e: any) => e.nome);

    // Salva sugeridos no busca_config_jsonb (preserva eventos_selecionados)
    const cfgAtual = orig.busca_config_jsonb || {};
    const novoCfg = {
      ...cfgAtual,
      eventos_sugeridos: eventos,
      eventos_sugeridos_em: new Date().toISOString(),
    };
    await adminClient
      .from("projetos_originacao")
      .update({
        busca_config_jsonb: novoCfg,
        gasto_anthropic_mes: Number(orig.gasto_anthropic_mes || 0) + CUSTO_BRL,
        updated_at: new Date().toISOString(),
      })
      .eq("id", originacao_id);

    return resp(200, {
      ok: true,
      eventos,
      total: eventos.length,
      custo_brl: CUSTO_BRL,
      tokens_in: data?.usage?.input_tokens ?? 0,
      tokens_out: data?.usage?.output_tokens ?? 0,
    });
  } catch (e: any) {
    console.error("[sugerir-eventos-gtm] exception", e);
    return resp(500, { ok: false, erro: "exception_raiz", detalhe: e?.message?.slice(0, 300) });
  }
});
