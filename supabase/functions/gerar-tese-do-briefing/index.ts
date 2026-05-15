// ⚠️ DEPRECATED v9.32 · tese narrativa removida da Originação
// Originação foca em arquétipos · não em peças de comunicação
// Se precisar de tese narrativa no futuro · vira ferramenta separada
// (Anúncios · Propostas) · não bloqueia fluxo de Originação
//
// gerar-tese-do-briefing · v9.31
// Redige tese narrativa profissional a partir do briefing aprovado.
//
// POST body: { originacao_id: uuid, projeto_id: uuid }
// Output: { ok, originacao_id, tese_gerada, tokens, duracao }

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
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return resp(405, { ok: false, erro: "metodo" });

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

  // Gate admin
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
  const { originacao_id, projeto_id } = body;
  if (!originacao_id) return resp(400, { ok: false, erro: "originacao_id_obrigatorio" });

  const { data: origRow, error: errOrig } = await adminClient
    .from("projetos_originacao").select("*").eq("id", originacao_id).maybeSingle();
  if (errOrig || !origRow) return resp(404, { ok: false, erro: "originacao_nao_encontrada" });
  if (!origRow.briefing_jsonb || Object.keys(origRow.briefing_jsonb).length === 0) {
    return resp(400, { ok: false, erro: "briefing_vazio", detalhe: "Briefing precisa ser gerado e revisado antes" });
  }

  const promptGerar = `Use o briefing aprovado abaixo pra redigir a TESE DE INVESTIMENTO em formato narrativo profissional.

Regras:
- 4-6 parágrafos
- Sem markdown headers · sem bullet points
- Linguagem profissional · concreta · sem exageros comerciais
- Use os números e dados específicos do briefing
- Estrutura sugerida:
  Parágrafo 1: o que é o negócio (identidade + economics)
  Parágrafo 2-3: diferenciais + momento de mercado
  Parágrafo 4: riscos (honesto)
  Parágrafo 5: motivo da venda + tipo de comprador esperado

BRIEFING:
${JSON.stringify(origRow.briefing_jsonb, null, 2)}

Retorne APENAS o texto da tese.`;

  const inicio = Date.now();
  try {
    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        messages: [{ role: "user", content: promptGerar }],
      }),
    });
    if (!claudeResp.ok) {
      const errTxt = await claudeResp.text();
      return resp(500, { ok: false, erro: "claude_api_falhou", detalhe: errTxt.slice(0, 500) });
    }
    const claudeData = await claudeResp.json();
    const textBlocks = (claudeData.content || []).filter((b: any) => b.type === "text");
    const teseGerada = textBlocks.map((b: any) => b.text).join("").trim();
    if (!teseGerada) return resp(500, { ok: false, erro: "resposta_vazia" });

    const { error: errUpd } = await adminClient
      .from("projetos_originacao")
      .update({ tese_texto: teseGerada, updated_at: new Date().toISOString() })
      .eq("id", origRow.id);
    if (errUpd) return resp(500, { ok: false, erro: "erro_update", detalhe: errUpd.message });

    const usage = claudeData.usage || {};
    return resp(200, {
      ok: true,
      originacao_id: origRow.id,
      tese_gerada: teseGerada,
      tokens_in: usage.input_tokens || 0,
      tokens_out: usage.output_tokens || 0,
      duracao_ms: Date.now() - inicio,
    });
  } catch (e: any) {
    return resp(500, { ok: false, erro: "exception", detalhe: e.message });
  }
});
