// gerar-sugestoes-dono · v9.35.0 · IA com web_search → eventos/grupos/associações reais.
// Salva em projeto_sugestoes_dono (delete + insert idempotente para gerado_por_ia=true)
//
// POST body: { projeto_metadata_id, originacao_id }
// Output: { ok, total, sugestoes }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function resp(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return resp(405, { ok: false, erro: "metodo" });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return resp(401, { ok: false, erro: "sem_jwt" });
  const { data: userData, error: userErr } = await sb.auth.getUser(jwt);
  if (userErr || !userData?.user) return resp(401, { ok: false, erro: "jwt_invalido" });
  const { data: admin } = await sb.from("admins").select("id, ativo").eq("whatsapp", userData.user.phone).eq("ativo", true).maybeSingle();
  if (!admin) return resp(403, { ok: false, erro: "nao_admin" });

  let body: any;
  try { body = await req.json(); } catch { return resp(400, { ok: false, erro: "json_invalido" }); }
  const { projeto_metadata_id, originacao_id } = body || {};
  if (!projeto_metadata_id) return resp(400, { ok: false, erro: "projeto_metadata_id_obrigatorio" });

  // Carrega contexto
  let briefing: any = {};
  let arqs: any[] = [];
  if (originacao_id) {
    const { data: orig } = await sb.from("projetos_originacao").select("briefing_jsonb, tese_jsonb").eq("id", originacao_id).maybeSingle();
    briefing = orig?.briefing_jsonb || {};
    const { data: a } = await sb.from("arquetipos_compradores").select("nome,tipo,vetor,motivacao").eq("originacao_id", originacao_id).eq("status", "aprovado");
    arqs = a || [];
  }
  const setor = briefing?.negocio?.setor || "geral";
  const cidade = briefing?.negocio?.cidade || "Brasil";

  const userMsg = `Negócio: ${setor} em ${cidade}.
Arquétipos de compradores potenciais: ${JSON.stringify(arqs.map((x: any) => x.nome))}.
Sugira eventos, grupos online e associações reais e verificáveis onde o DONO deveria aparecer.`;

  let texto = "";
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2500,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
        system: `Você é um especialista em redes de negócios e prospecção indireta no Brasil.
Dado um negócio à venda, sugira ONDE O DONO DO NEGÓCIO deveria frequentar para encontrar potenciais compradores de forma orgânica.
O dono vai a esses lugares sem revelar que está vendendo — apenas para construir relacionamento.

Retorne APENAS JSON válido (sem texto fora do JSON), no formato:
{
  "eventos": [{"nome":"...","quando":"...","cidade":"...","url":"...","motivo":"...","tipo":"local|nacional"}],
  "grupos": [{"nome":"...","plataforma":"facebook|linkedin|whatsapp","url":"...","motivo":"...","membros_estimados":0}],
  "associacoes": [{"nome":"...","url":"...","motivo":"...","beneficio":"..."}]
}
Máximo: 5 eventos, 5 grupos, 3 associações. Apenas reais e verificáveis · use web_search.`,
        messages: [{ role: "user", content: userMsg }],
      }),
    });
    const data = await r.json();
    texto = (data.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
  } catch (e: any) {
    return resp(500, { ok: false, erro: "anthropic_fail", detalhe: e?.message });
  }

  let sugestoes: any = { eventos: [], grupos: [], associacoes: [] };
  try {
    const m = texto.match(/\{[\s\S]*\}/);
    if (m) sugestoes = JSON.parse(m[0]);
  } catch (_) { /* keep empty */ }

  const inserts = [
    ...(sugestoes.eventos || []).map((e: any) => ({ tipo: "evento", projeto_metadata_id, nome: e.nome, descricao: e.motivo || null, url: e.url || null, cidade: e.cidade || null, motivo: e.motivo || null, data_evento: e.quando && /^\d{4}-\d{2}-\d{2}$/.test(e.quando) ? e.quando : null, gerado_por_ia: true })),
    ...(sugestoes.grupos || []).map((g: any) => ({ tipo: "grupo", projeto_metadata_id, nome: g.nome, descricao: g.motivo || null, url: g.url || null, plataforma: g.plataforma || null, motivo: g.motivo || null, membros_estimados: g.membros_estimados || null, gerado_por_ia: true })),
    ...(sugestoes.associacoes || []).map((a: any) => ({ tipo: "associacao", projeto_metadata_id, nome: a.nome, descricao: a.beneficio || a.motivo || null, url: a.url || null, motivo: a.motivo || null, gerado_por_ia: true })),
  ];

  if (inserts.length > 0) {
    await sb.from("projeto_sugestoes_dono").delete().eq("projeto_metadata_id", projeto_metadata_id).eq("gerado_por_ia", true);
    const { error } = await sb.from("projeto_sugestoes_dono").insert(inserts);
    if (error) return resp(500, { ok: false, erro: "insert_fail", detalhe: error.message });
  }

  return resp(200, { ok: true, total: inserts.length, sugestoes });
});
